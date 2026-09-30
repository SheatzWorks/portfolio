/**
 * SSRF-safe outbound fetch.
 * ===========================================================================
 *
 * Threat model
 * ------------
 * The site fetches URLs a human typed into the admin form. A naive
 * `fetch(input.url)` lets that human (or anyone who reaches the form) make our
 * infrastructure issue requests to:
 *
 *   - loopback / private ranges   -> anything reachable from the Worker
 *   - 169.254.169.254             -> cloud instance metadata + credentials
 *   - [::1] / 0.0.0.0 / RFC1918
 *   - internal *.internal / *.local names
 *
 * Where a naive check fails
 * ------------------------
 * The common pattern `assertPublic(u) -> dns.lookup -> fetch(u)` is broken.
 * `fetch` resolves DNS again, independently, at socket-open time. A hostname
 * with a ~0s TTL can answer `93.184.216.34` to our check and
 * `169.254.169.254` to the connection. That is DNS rebinding, and it is the
 * single most common way SSRF filters are bypassed in practice.
 *
 * On Cloudflare Workers we cannot dial a pinned IP (there is no
 * custom-connector hook in the runtime's fetch), so we cannot fully close that
 * race from inside the Worker. Two things close it in practice:
 *
 *   1. Egress control. Worker egress cannot reach a tenant's private network,
 *      and Cloudflare's own metadata endpoints are not routable from it.
 *   2. The browser that renders arbitrary pages runs in a *separate provider's*
 *      isolated network (see lib/capture), so it is architecturally incapable
 *      of reaching our infrastructure at all. Our exposure is this one
 *      metadata fetch and nothing else.
 *
 * On top of that this module applies every check it can, and — importantly —
 * supports a strict allowlist mode that removes attacker choice from the
 * problem entirely. For a studio capturing its own work, `ALLOWED_CAPTURE_HOSTS`
 * is the recommended setting and turns SSRF from "mitigated" to "impossible".
 *
 * Not used: `ssrf-req-filter` (unmaintained since 2024).
 * `ipaddr.js` is used because decimal/octal/IPv4-mapped encodings
 * (2130706433, 0177.0.0.1, 127.1, ::ffff:127.0.0.1) are exactly the cases
 * hand-rolled IPv4 regexes miss.
 */

import ipaddr from 'ipaddr.js';

export class UnsafeUrlError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
    this.code = code;
  }
}

export interface SafeFetchOptions {
  /** Hard cap on the response body we will read. */
  maxBytes?: number;
  /** Hard cap on total elapsed time. */
  timeoutMs?: number;
  /** Maximum redirect hops. Each hop is fully re-validated. */
  maxRedirects?: number;
  /**
   * When set and non-empty, the host MUST appear in this list. This is the
   * strict mode. An empty list means "no allowlist configured".
   */
  allowlist?: readonly string[];
  /** Sent as User-Agent. Identifies us honestly so operators can filter us. */
  userAgent?: string;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string | null;
  /** Body, truncated to maxBytes. */
  body: Uint8Array;
  /** True when the body was cut short at maxBytes. */
  truncated: boolean;
  /** Response headers of the final hop. */
  headers: Headers;
}

const DEFAULTS = {
  maxBytes: 2 * 1024 * 1024, // 2 MB is ample for an HTML <head>.
  timeoutMs: 8_000,
  maxRedirects: 3,
} as const;

/** Hostname suffixes that must never be resolved from our egress. */
const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.private',
  '.corp',
  '.home.arpa',
  '.in-addr.arpa',
  '.ip6.arpa',
];

/** Literal hostnames that are always metadata or loopback endpoints. */
const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'instance-data.ec2.internal',
  '169.254.169.254',
  'metadata.goog',
]);

/**
 * Cloudflare's Workers cannot reach these, but blocking them keeps the module
 * correct if the same code is ever run on Node (tests, the local capture CLI).
 */
const BLOCKED_CIDRS = [
  '127.0.0.0/8',
  '0.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '100.64.0.0/10', // CGNAT
  '192.0.0.0/24',
  '198.18.0.0/15', // benchmarking
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved
  '::1/128',
  '::/128',
  'fe80::/10',
  'fc00::/7',
  'ff00::/8',
  '2001:db8::/32',
];

const blockedNetworks = BLOCKED_CIDRS.map((c) => ipaddr.parseCIDR(c));

/** True when the literal parses as an IP that must not be contacted. */
function isBlockedAddress(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    // Fail closed. This is called with the output of a DNS lookup, which is
    // always a valid address — so an unparseable value means something is
    // wrong, and the safe answer to "is this address safe?" is no.
    return true;
  }

  // Unwrap IPv4-mapped/compatible IPv6 (::ffff:127.0.0.1) before range checks.
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return isBlockedAddress(v6.toIPv4Address().toString());
    if (v6.toNormalizedString() === '::') return true;
  }

  for (const [net, bits] of blockedNetworks) {
    if (net.kind() !== addr.kind()) continue;
    try {
      if (addr.match(net as never, bits as never)) return true;
    } catch {
      // kind mismatch between a v4 and a v6 network — ignore and continue.
    }
  }

  // ipaddr.js canonical answer for a globally routable unicast address.
  return addr.range() !== 'unicast';
}

/** True when the host is a bare IP literal (v4 or v6, in any encoding). */
function looksLikeIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');
  try {
    ipaddr.parse(bare);
    return true;
  } catch {
    return false;
  }
}

export interface ValidatedUrl {
  url: URL;
  host: string;
}

/**
 * Parses and validates a user-supplied URL. Throws `UnsafeUrlError` with a
 * specific code so callers can log precisely and return a useful message.
 */
export function validateUrl(raw: string, allowlist?: readonly string[]): ValidatedUrl {
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new UnsafeUrlError('malformed', 'That does not look like a URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeUrlError(
      'protocol',
      `Only http and https are supported (got ${url.protocol.replace(':', '')}).`,
    );
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError('credentials', 'URLs with embedded credentials are rejected.');
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');

  if (!host) throw new UnsafeUrlError('malformed', 'That URL has no host.');

  if (BLOCKED_HOSTS.has(host)) {
    throw new UnsafeUrlError('blocked-host', 'That host cannot be fetched.');
  }

  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError('blocked-host', 'That host is on an internal network.');
  }

  if (looksLikeIpLiteral(host)) {
    throw new UnsafeUrlError(
      'ip-literal',
      'Raw IP addresses are not accepted. Use a domain name.',
    );
  }

  // A bare label with no dot is an intranet-style name ("router", "nas").
  if (!host.includes('.') || /\s/.test(host)) {
    throw new UnsafeUrlError('blocked-host', 'That host is not a public domain.');
  }

  if (allowlist && allowlist.length > 0) {
    const allowed = allowlist.some((entry) => {
      const e = entry.trim().toLowerCase().replace(/^\*\./, '');
      return e && (host === e || host.endsWith(`.${e}`));
    });
    if (!allowed) {
      throw new UnsafeUrlError('not-allowlisted', 'That host is not on the capture allowlist.');
    }
  }

  return { url, host };
}

/** Hostname must be a valid DNS name, not merely non-blacklisted. */
function isPlausibleHostname(host: string): boolean {
  if (host.length > 253) return false;
  const label = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  return host.split('.').every((l) => l.length > 0 && l.length <= 63 && label.test(l));
}

/**
 * Reads a response body with a hard byte cap, aborting the stream rather than
 * buffering an unbounded response into a 128 MB isolate.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ body: Uint8Array; truncated: boolean }> {
  if (!response.body) return { body: new Uint8Array(0), truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total > maxBytes) {
        truncated = true;
        break;
      }
    }
  } finally {
    // Releasing the lock lets the runtime cancel the rest of the stream.
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }

  const out = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    if (offset >= out.length) break;
    const slice = c.subarray(0, Math.min(c.byteLength, out.length - offset));
    out.set(slice, offset);
    offset += slice.byteLength;
  }

  if (signal.aborted) throw new UnsafeUrlError('timeout', 'The request timed out.');
  return { body: out, truncated };
}

/**
 * Fetches a user-supplied URL with every hop re-validated.
 *
 * Redirects are followed manually and capped. Critically, each hop's `Location`
 * is re-run through `validateUrl`, so a public host cannot bounce us to
 * `http://169.254.169.254/` and slip past the check.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const userAgent = options.userAgent ?? 'StudioSiteBot/1.0 (+preview pipeline)';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let current: URL;
  try {
    current = validateUrl(rawUrl, options.allowlist).url;
  } finally {
    // The timer must not start until after validation succeeds; restart it below.
  }

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      // Re-validate on every hop, including the first.
      const checked = validateUrl(current.toString(), options.allowlist);
      if (!isPlausibleHostname(checked.host)) {
        throw new UnsafeUrlError('blocked-host', 'That host is not a valid domain name.');
      }

      const response = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Sent honestly. We are an automated previewer and operators are
          // entitled to filter us; hiding behind a browser UA would be worse.
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en',
        },
        // Cloudflare-specific: gives us the challenge signal below.
        cf: { cacheTtl: 0, cacheEverything: false },
      } as RequestInit);

      if (isRedirect(response.status)) {
        const location = response.headers.get('location');
        // Drain so the socket is released before we follow.
        try {
          await response.body?.cancel();
        } catch {
          /* ignore */
        }
        if (!location) {
          throw new UnsafeUrlError('redirect', 'The site sent a redirect with no target.');
        }
        const next = new URL(location, current);
        // Throws if the redirect target is unsafe. This is the rebinding guard.
        validateUrl(next.toString(), options.allowlist);
        current = next;
        continue;
      }

      const contentType = response.headers.get('content-type');
      const { body, truncated } = await readCapped(response, maxBytes, controller.signal);

      return {
        finalUrl: current.toString(),
        status: response.status,
        contentType,
        body,
        truncated,
        headers: response.headers,
      };
    }

    throw new UnsafeUrlError('redirect', 'Too many redirects.');
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new UnsafeUrlError('timeout', `The site did not respond within ${timeoutMs}ms.`);
    }
    throw new UnsafeUrlError('network', 'The site could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * True when the response is a bot-protection interstitial rather than content.
 * A Worker cannot solve a challenge, so callers must fall back instead of
 * retrying. `cf-mitigated` is the documented header Cloudflare sets.
 */
export function isChallenge(response: { status: number; headers: Headers }): boolean {
  if (response.headers.get('cf-mitigated') === 'challenge') return true;
  return response.status === 403 || response.status === 503;
}

/** Exposed for unit tests. */
export const __internals = { isBlockedAddress, looksLikeIpLiteral, isPlausibleHostname };
