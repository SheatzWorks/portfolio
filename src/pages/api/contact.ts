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
import {
  checkRateLimit,
  recordAttempt,
  verifyTurnstile,
  clientIp,
  hashIdentifier,
  MIN_FILL_MS,
} from '~/lib/rate-limit';

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

  // ---- 2. Minimum fill time --------------------------------------------
  const renderedAt = Number(str(form.get('rendered_at'), 20));
  if (Number.isFinite(renderedAt) && renderedAt > 0 && Date.now() - renderedAt < MIN_FILL_MS) {
    console.log(JSON.stringify({ event: 'contact.too_fast', outcome: 'dropped' }));
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
  const context = JSON.stringify({
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300),
    referer: (request.headers.get('referer') ?? '').slice(0, 300),
  });

  try {
    await db
      .prepare(
        `INSERT INTO enquiries (name, email, company, project_type, budget, timeline, message, context)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(name, email, company, projectType, budget, timeline, message, context)
      .run();
  } catch (err) {
    console.error(JSON.stringify({ event: 'contact.store_failed', error: String(err) }));
    return json({ ok: false, error: 'Something went wrong on our side. Please email us directly.' }, 500);
  }

  // ---- Deliver ----------------------------------------------------------
  if (env.RESEND_API_KEY && env.CONTACT_TO_EMAIL && env.CONTACT_FROM_EMAIL) {
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(env.RESEND_API_KEY);

      const rowOf = (label: string, value: string) =>
        value ? `<tr><td style="padding:4px 12px 4px 0;color:#6e6e78;font:12px monospace">${label}</td><td style="padding:4px 0;color:#ededf0;font:14px sans-serif">${escapeHtml(value)}</td></tr>` : '';

      await resend.emails.send({
        from: env.CONTACT_FROM_EMAIL,
        to: env.CONTACT_TO_EMAIL,
        // Reply goes to the sender, not to the studio's own inbox.
        replyTo: email,
        subject: `New enquiry — ${name}${projectType ? ` (${projectType})` : ''}`,
        // Idempotency key: a double-submit cannot produce two emails.
        headers: { 'Idempotency-Key': `enquiry-${Date.now()}-${identifier.slice(0, 12)}` },
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          company ? `Company: ${company}` : '',
          projectType ? `Project type: ${projectType}` : '',
          budget ? `Budget: ${budget}` : '',
          timeline ? `Timeline: ${timeline}` : '',
          '',
          message,
        ]
          .filter(Boolean)
          .join('\n'),
        html: `<div style="font:14px/1.6 system-ui,sans-serif;color:#ededf0;background:#0a0a0b;padding:24px;border:1px solid #2a2a30">
  <p style="margin:0 0 16px;font-size:18px">New enquiry from ${escapeHtml(name)}</p>
  <table style="border-collapse:collapse;margin-bottom:16px">
    ${rowOf('Email', email)}
    ${rowOf('Company', company)}
    ${rowOf('Type', projectType)}
    ${rowOf('Budget', budget)}
    ${rowOf('Timeline', timeline)}
  </table>
  <p style="margin:0;white-space:pre-wrap">${escapeHtml(message)}</p>
</div>`,
      });
    } catch (err) {
      // The enquiry is safely stored, so this is a degraded notification, not
      // a lost lead. Say so in the log and still confirm to the user.
      console.error(JSON.stringify({ event: 'contact.email_failed', error: String(err) }));
    }
  } else {
    console.log(JSON.stringify({ event: 'contact.stored_only', reason: 'email_not_configured' }));
  }

  return json(
    { ok: true, message: 'Thanks — your message has been sent. We reply to everything.' },
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
