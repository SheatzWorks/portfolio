/**
 * Contact form endpoint.
 *
 * Returns the same JSON shape for every failure mode on purpose: a distinct
 * error per condition tells a prober which check they tripped. The client
 * shows a generic message; the specific reason is logged server-side without
 * any personal data attached.
 */
import type { APIRoute } from 'astro';
import { getEnv, getDb } from '~/lib/env';
import { studio } from '~/config/site';
import {
  checkRateLimit,
  recordAttempt,
  verifyTurnstile,
  clientIp,
  hashIdentifier,
  MIN_FILL_MS,
} from '~/lib/rate-limit';
import { getProjectBySlug } from '~/lib/db';

export const prerender = false;

const MAX = { name: 120, email: 200, message: 5000, company: 200 } as const;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isEmail(value: string): boolean {
  // Deliberately conservative: one @, no whitespace, a dotted domain. Anything
  // stricter rejects valid addresses; anything looser accepts injected text.
  return /^[^\s@,;:<>()[\]\\]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) && value.length <= MAX.email;
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = await getEnv(locals);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Could not read the submission.' }, 400);
  }

  // ---- 1. Honeypot ------------------------------------------------------
  // A real person never sees this field. A naive bot fills every input.
  if (str(form.get('company_website'), 200)) {
    console.log(JSON.stringify({ event: 'contact.honeypot', outcome: 'dropped' }));
    return json({ ok: true, message: 'Thanks — your message has been sent.' }, 200);
  }

  const name = str(form.get('name'), MAX.name);
  const email = str(form.get('email'), MAX.email);
  const message = str(form.get('message'), MAX.message);
  const company = str(form.get('company'), MAX.company);
  const projectType = str(form.get('project_type'), 80);
  const budget = str(form.get('budget'), 80);
  const timeline = str(form.get('timeline'), 80);

  // ---- Field validation (the only specific errors we surface) ----------
  const errors: Record<string, string> = {};
  if (name.length < 2) errors.name = 'Please add your name.';
  if (!isEmail(email)) errors.email = 'Please add an email address we can reply to.';
  if (message.length < 20) errors.message = 'Please add a little more detail — 20 characters or more.';

  if (Object.keys(errors).length > 0) {
    return json({ ok: false, error: 'Please check the highlighted fields.', errors }, 422);
  }

  // ---- 2. Minimum fill time --------------------------------------------
  /*
   * After validation, deliberately. A submission that is both instant and
   * incomplete is much more likely a person with browser autofill than a bot,
   * and the answer to that person cannot be "sent" while the enquiry is thrown
   * away. A bot that fills everything correctly in under two seconds is still
   * dropped here, before the rate-limit write or any Turnstile call.
   */
  const renderedAt = Number(str(form.get('rendered_at'), 20));
  if (Number.isFinite(renderedAt) && renderedAt > 0 && Date.now() - renderedAt < MIN_FILL_MS) {
    console.log(JSON.stringify({ event: 'contact.too_fast', outcome: 'dropped' }));
    return json({ ok: true, message: 'Thanks — your message has been sent.' }, 200);
  }

  // ---- 3. Rate limit ----------------------------------------------------
  const ip = clientIp(request);
  const identifier = await hashIdentifier(ip, env.RATE_LIMIT_SALT ?? 'no-salt-configured');

  const db = getDb(env);
  const limit = await checkRateLimit(db as never, identifier);
  if (!limit.allowed) {
    console.log(JSON.stringify({ event: 'contact.rate_limited', outcome: 'rejected' }));
    return json(
      { ok: false, error: 'That is several submissions in a short window. Please email us instead.' },
      429,
    );
  }

  // ---- 4. Turnstile (only reached by a plausible submission) -----------
  if (env.TURNSTILE_SECRET_KEY) {
    const token = str(form.get('cf-turnstile-response'), 2048);
    const expectedHost = env.PUBLIC_SITE_URL ? new URL(env.PUBLIC_SITE_URL).hostname : undefined;
    const verdict = await verifyTurnstile(token, ip, env.TURNSTILE_SECRET_KEY, expectedHost);
    if (!verdict.success) {
      console.log(JSON.stringify({ event: 'contact.turnstile_failed', codes: verdict.codes }));
      return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);
    }
  }

  // Count the attempt only once it has passed every check, so a user who
  // mistypes an email is not charged against their own quota.
  await recordAttempt(db as never, identifier);

  // ---- Persist first, deliver second -----------------------------------
  // A lead must never be lost because an email provider had a bad day.

  /*
   * Which product the enquiry is about, when the visitor came from a product
   * page. The submitted value is a slug, never free text: it is looked up in
   * D1 and only a published own-product's stored title is kept, so a client
   * that posts an arbitrary `product` value contributes nothing to the email.
   * An unrecognised slug is dropped silently — the enquiry is still real.
   */
  const productSlug = str(form.get('product'), 80).toLowerCase();
  let productTitle: string | null = null;
  if (/^[a-z0-9][a-z0-9-]{0,79}$/.test(productSlug)) {
    const match = await getProjectBySlug(db as never, productSlug).catch(() => null);
    if (match?.published && match.ownership === 'own') productTitle = match.title;
  }

  const context = JSON.stringify({
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300),
    referer: (request.headers.get('referer') ?? '').slice(0, 300),
    ...(productTitle ? { product: productTitle } : {}),
  });
  // Set by the deliver step below: which stored enquiry reached your inbox,
  // so the admin can show the difference between "saved" and "emailed".
  let enquiryId: number | null = null;

  try {
    const result = await db
      .prepare(
        `INSERT INTO enquiries (name, email, company, project_type, budget, timeline, message, context)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(name, email, company, projectType, budget, timeline, message, context)
      .run();
    // Used by the admin to show which enquiries also reached your inbox.
    enquiryId = result?.meta?.last_row_id ?? null;
  } catch (err) {
    console.error(JSON.stringify({ event: 'contact.store_failed', error: String(err) }));
    return json({ ok: false, error: 'Something went wrong on our side. Please email us directly.' }, 500);
  }

  // ---- Deliver ----------------------------------------------------------
  /*
   * Where the enquiry goes.
   *
   * `CONTACT_TO_EMAIL` wins when it is set, so a staging deployment can point
   * somewhere else without touching the code. With no secret set, the studio
   * mailbox in src/config/site.ts is the destination — the same address the
   * contact page publishes, so there is one inbox and one place to change it.
   */
  const recipient = (env.CONTACT_TO_EMAIL ?? studio.email).trim();

  /* Whether this enquiry actually left the building as an email. The visitor
     is told the truth about it: "sent" means sent, "with us" means it is
     stored and waiting to be read. */
  let delivered = false;

  if (env.RESEND_API_KEY && recipient && env.CONTACT_FROM_EMAIL) {
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(env.RESEND_API_KEY);

      const rowOf = (label: string, value: string) =>
        value ? `<tr><td style="padding:4px 12px 4px 0;color:#576176;font:12px monospace">${label}</td><td style="padding:4px 0;color:#141a26;font:14px sans-serif">${escapeHtml(value)}</td></tr>` : '';

      await resend.emails.send({
        from: env.CONTACT_FROM_EMAIL,
        to: recipient,
        // Reply goes to the sender, not to the studio's own inbox.
        replyTo: email,
        subject: `New enquiry${productTitle ? ` about ${productTitle}` : ''} — ${name}${projectType ? ` (${projectType})` : ''}`,
        // Idempotency key: a double-submit cannot produce two emails.
        headers: { 'Idempotency-Key': `enquiry-${Date.now()}-${identifier.slice(0, 12)}` },
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          productTitle ? `About: ${productTitle}` : '',
          company ? `Company: ${company}` : '',
          projectType ? `Project type: ${projectType}` : '',
          budget ? `Budget: ${budget}` : '',
          timeline ? `Timeline: ${timeline}` : '',
          '',
          message,
        ]
          .filter(Boolean)
          .join('\n'),
        html: `<div style="font:14px/1.6 system-ui,sans-serif;color:#242c3d;background:#f2f5fb;padding:24px;border:1px solid #d3d9e6">
  <p style="margin:0 0 16px;font-size:18px;color:#141a26">New enquiry from ${escapeHtml(name)}</p>
  <table style="border-collapse:collapse;margin-bottom:16px">
    ${rowOf('Email', email)}
    ${rowOf('About', productTitle ?? '')}
    ${rowOf('Company', company)}
    ${rowOf('Type', projectType)}
    ${rowOf('Budget', budget)}
    ${rowOf('Timeline', timeline)}
  </table>
  <p style="margin:0;white-space:pre-wrap">${escapeHtml(message)}</p>
</div>`,
      });

      // The email went out. Mark the row so /admin can distinguish "stored"
      // from "emailed". Never allowed to fail the request: the lead is safe
      // either way, worst case the badge is momentarily wrong.
      delivered = true;
      if (enquiryId !== null) {
        void db
          .prepare('UPDATE enquiries SET delivered = 1 WHERE id = ?1')
          .bind(enquiryId)
          .run()
          .catch(() => undefined);
      }
    } catch (err) {
      // The enquiry is safely stored, so this is a degraded notification, not
      // a lost lead. Say so in the log and still confirm to the user.
      console.error(JSON.stringify({ event: 'contact.email_failed', error: String(err) }));
    }
  } else {
    /*
     * No email provider configured. The enquiry is stored and will be read in
     * /admin, so the lead is not lost — but the visitor is not told it was
     * emailed, because it was not.
     */
    console.log(
      JSON.stringify({
        event: 'contact.stored_only',
        reason: !env.RESEND_API_KEY
          ? 'resend_api_key_missing'
          : !env.CONTACT_FROM_EMAIL
            ? 'contact_from_email_missing'
            : 'no_recipient',
      }),
    );
  }

  return json(
    {
      ok: true,
      message: delivered
        ? 'Thanks — your message has been sent. We reply to everything.'
        : 'Thanks — your message is with us. We reply to everything.',
    },
    200,
  );
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Any other method is not supported. */
export const ALL: APIRoute = () => json({ ok: false, error: 'Method not allowed.' }, 405);
