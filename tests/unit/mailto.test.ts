/**
 * The composed mail link.
 *
 * `mailto:` looks trivial and is not: the encoders that are easy to reach for
 * produce a subject line containing a literal `+`, a single `\n` body renders
 * as one long line in several clients, and an unencoded `&` in a subject lets
 * the text that follows become a different parameter. All three are asserted
 * here rather than trusted.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { studio, publishableEmail, mailtoHref, enquiryDraft } from '~/config/site';

describe('mailtoHref', () => {
  const configured = studio.email;
  afterEach(() => {
    studio.email = configured;
  });

  it('suppression of a placeholder mailbox suppresses the whole link', () => {
    studio.email = 'PLACEHOLDER@example.com';
    expect(publishableEmail()).toBeNull();
    expect(mailtoHref(enquiryDraft('New project enquiry'))).toBeNull();
  });

  it('an address with nothing to say stays a bare mailto', () => {
    studio.email = 'studio@sheatz.work';
    expect(mailtoHref()).toBe('mailto:studio@sheatz.work');
    expect(mailtoHref({})).toBe('mailto:studio@sheatz.work');
  });

  it('a space becomes %20, never a plus', () => {
    studio.email = 'studio@sheatz.work';
    const href = mailtoHref({ subject: 'Enquiry about Ember Studio' });
    expect(href).toContain('subject=Enquiry%20about%20Ember%20Studio');
    expect(href).not.toContain('+');
  });

  it('a body on one line is a body with no paragraphs', () => {
    studio.email = 'studio@sheatz.work';
    const href = mailtoHref(enquiryDraft('New project enquiry'));
    expect(href).toContain('%0D%0A');
    expect(href, 'no line feed arrives without its return').not.toMatch(/(?<!%0D)%0A/);
    // Round-trips back to the draft, with the line endings this function
    // deliberately rewrote to CRLF.
    const body = new URLSearchParams(href!.split('?')[1]).get('body');
    expect(body).toBe(enquiryDraft('New project enquiry').body.replace(/\n/g, '\r\n'));
  });

  it('a subject cannot smuggle in a second parameter', () => {
    studio.email = 'studio@sheatz.work';
    const href = mailtoHref({ subject: 'Enquiry about X&body=Priceless', body: 'real body' });
    expect(href!.split('?')).toHaveLength(2);
    expect(href).toContain('%26body%3DPriceless');
    const params = new URLSearchParams(href!.split('?')[1]);
    expect(params.get('subject')).toBe('Enquiry about X&body=Priceless');
    expect(params.get('body')).toBe('real body');
  });

  it('the product draft names the product it came from', () => {
    studio.email = 'studio@sheatz.work';
    const href = mailtoHref(enquiryDraft('Enquiry about Ember'));
    expect(href).toContain('subject=Enquiry%20about%20Ember');
  });
});

describe('enquiryDraft', () => {
  it('asks the visitor three questions and writes nothing for them', () => {
    const draft = enquiryDraft('New project enquiry');
    expect(draft.subject).toBe('New project enquiry');
    expect(draft.body).toContain('What you want built:');
    expect(draft.body).toContain('When you want it live:');
    expect(draft.body).toContain('Anything already in place (repo, design, users):');
    expect(draft.body.split('\n').filter((line) => line.trim()).length).toBeLessThanOrEqual(5);
  });
});
