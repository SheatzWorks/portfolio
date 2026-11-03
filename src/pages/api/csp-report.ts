/**
 * CSP Report endpoint.
 *
 * Receives CSP violation reports and logs them. Does not expose any sensitive
 * information in responses.
 */
import type { APIRoute } from 'astro';
import { getEnv } from '~/lib/env';

export const prerender = false;

interface CSPReport {
  'csp-report': {
    'document-uri': string;
    referrer: string;
    'violated-directive': string;
    'effective-directive': string;
    'original-policy': string;
    'disposition': 'enforce' | 'report';
    'blocked-uri': string;
    'line-number': number;
    'column-number': number;
    'source-file': string;
    'script-sample': string;
  };
}

export const POST: APIRoute = async ({ request }) => {
  const env = await getEnv();

  try {
    const contentType = request.headers.get('content-type') ?? '';
    let report: CSPReport | null = null;

    if (contentType.includes('application/json')) {
      report = (await request.json()) as CSPReport;
    } else if (contentType.includes('application/csp-report')) {
      // Parse the deprecated format
      const text = await request.text();
      try {
        report = JSON.parse(text) as CSPReport;
      } catch {
        // Ignore parse errors
      }
    }

    if (report?.['csp-report']) {
      const r = report['csp-report'];
      console.warn(
        JSON.stringify({
          event: 'csp.violation',
          directive: r['violated-directive'],
          blocked: r['blocked-uri'],
          document: r['document-uri'].slice(0, 200),
          line: r['line-number'],
          column: r['column-number'],
          sample: r['script-sample']?.slice(0, 100),
        }),
      );
    }
  } catch {
    // Swallow errors - reporting must never break the page
  }

  // Always return 204 No Content
  return new Response(null, { status: 204 });
};