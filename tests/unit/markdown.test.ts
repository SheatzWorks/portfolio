/**
 * Markdown rendering — the XSS boundary.
 *
 * Case-study copy is author-entered, but it is still untrusted by the time it
 * reaches a page, and it is injected with set:html. Every assertion here exists
 * to prove there is no path from input to live markup.
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown, escapeHtml } from '../../src/lib/markdown';

describe('escaping', () => {
  it('escapes every dangerous character', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('neutralises a script tag in paragraph text', () => {
    const out = renderMarkdown('Hello <script>alert(1)</script> world');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('neutralises an img onerror payload', () => {
    const out = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('&lt;img');
  });

  it('neutralises an injected closing script tag', () => {
    const out = renderMarkdown('</script><script>alert(1)</script>');
    expect(out).not.toContain('</script>');
  });

  it('neutralises an event handler in a heading', () => {
    const out = renderMarkdown('# Title <svg onload=alert(1)>');
    expect(out).not.toContain('<svg');
  });
});

describe('link safety', () => {
  it('renders ordinary links, opening external ones safely', () => {
    const out = renderMarkdown('[Example](https://example.com)');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('keeps internal links in the same tab', () => {
    const out = renderMarkdown('[Creations](/creations)');
    expect(out).toContain('href="/creations"');
    expect(out).not.toContain('target="_blank"');
  });

  it('degrades a javascript: link to plain text rather than emitting it', () => {
    const out = renderMarkdown('[click](javascript:alert(1))');
    expect(out).not.toContain('href');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
  });

  it('rejects a scheme obfuscated with control characters', () => {
    const out = renderMarkdown('[x](java\nscript:alert(1))');
    expect(out).not.toContain('href');
  });

  it('rejects data: and vbscript: schemes', () => {
    expect(renderMarkdown('[x](data:text/html,<script>)')).not.toContain('href');
    expect(renderMarkdown('[x](vbscript:msgbox)')).not.toContain('href');
  });

  it('allows mailto', () => {
    expect(renderMarkdown('[mail](mailto:a@b.com)')).toContain('mailto:a@b.com');
  });
});

describe('block grammar', () => {
  it('renders headings at the supported levels only', () => {
    expect(renderMarkdown('# One')).toContain('<h2>One</h2>');
    // `##` used to render as <h3>, putting every section one level too deep.
    // The ceiling is h2 because an h1 would compete with the page's own h1.
    expect(renderMarkdown('## Two')).toContain('<h2>Two</h2>');
    expect(renderMarkdown('### Three')).toContain('<h3>Three</h3>');
    expect(renderMarkdown('#### Four')).toContain('<h3>Four</h3>');
    // No depth may ever produce an h1 in body copy.
    for (const depth of ['#', '##', '###', '####', '#####', '######']) {
      expect(renderMarkdown(`${depth} Heading`), depth).not.toContain('<h1>');
    }
  });

  it('renders both list kinds', () => {
    expect(renderMarkdown('- a\n- b')).toContain('<li>a</li>');
    expect(renderMarkdown('1. a\n2. b')).toContain('<ol>');
  });

  it('renders blockquotes', () => {
    expect(renderMarkdown('> quoted')).toContain('<blockquote>');
  });

  it('renders fenced code without executing anything', () => {
    const out = renderMarkdown('```js\nconst a = "<b>";\n```');
    expect(out).toContain('<pre><code>');
    expect(out).toContain('&lt;b&gt;');
  });

  it('renders emphasis and inline code', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('*em*')).toContain('<em>em</em>');
    expect(renderMarkdown('`code`')).toContain('<code>code</code>');
  });

  it('does not interpret markup inside inline code', () => {
    const out = renderMarkdown('`**not bold**`');
    expect(out).toContain('<code>**not bold**</code>');
    expect(out).not.toContain('<strong>');
  });

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });

  it('handles a large document without pathological output', () => {
    const out = renderMarkdown(Array.from({ length: 500 }, (_, i) => `Paragraph ${i}`).join('\n\n'));
    expect(out.match(/<p>/g)!.length).toBe(500);
  });
});
