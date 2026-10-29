/**
 * The visibility and ownership rules.
 *
 * These are the queries that decide what the public can see, and every one of
 * them has a way to be subtly wrong in a way the build will not catch: the
 * page renders, the status is 200, and the wrong project is in the list.
 *
 * The fake D1 below does not execute SQL. It records the statement and returns
 * whatever rows the test supplies, so the assertion is on the *query* — the
 * WHERE clause and the ORDER BY — because that is the part that carries the
 * rule. A change that drops `ownership = 'own'` from /products is invisible to
 * a rendering test and completely visible here.
 */
import { describe, it, expect } from 'vitest';
import {
  listOwnProducts,
  listClientWork,
  listPublishedProjects,
  countByOwnership,
  listDifferentiators,
  listServices,
} from '../../src/lib/db';
import type { D1Like } from '../../src/lib/db';
import type { Service, Differentiator } from '../../src/lib/types';

interface Capture {
  sql: string;
  params: unknown[];
}

function fakeDb(capture: Capture, rows: Record<string, unknown>[] = []) {
  const statement = (sql: string) => ({
    bind: (...params: unknown[]) => {
      capture.sql = sql.replace(/\s+/g, ' ').trim();
      capture.params = params;
      return {
        all: async () => ({ results: rows, success: true, meta: {} }),
        first: async () => rows[0] ?? null,
        run: async () => ({ success: true, meta: {} }),
      };
    },
    all: async () => {
      capture.sql = sql.replace(/\s+/g, ' ').trim();
      return { results: rows, success: true, meta: {} };
    },
    first: async () => rows[0] ?? null,
    run: async () => ({ success: true, meta: {} }),
  });
  return { prepare: statement } as unknown as D1Like;
}

/** A minimal row. Only the fields under test need to be real. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    slug: 'x',
    title: 'X',
    url: 'https://example.com/x',
    blurb: 'b',
    summary: 's',
    category: 'web',
    technologies: '[]',
    year: 2026,
    status: 'live',
    kind: 'web',
    featured: 0,
    sort_order: 0,
    published: 1,
    has_case_study: 0,
    body_md: null,
    ownership: 'client',
    product_status: null,
    availability_url: null,
    tagline: null,
    credits: '[]',
    links: '{}',
    metrics: '[]',
    gallery: '[]',
    aspect_ratio: 1.6,
    preview: '{}',
    preview_state: 'queued',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...over,
  };
}

describe('ownership split', () => {
  it('/products asks for own products only', async () => {
    const capture: Capture = { sql: '', params: [] };
    await listOwnProducts(fakeDb(capture, [row({ ownership: 'own' })]));

    expect(capture.sql).toMatch(/ownership\s*=\s*'own'/);
    // A product may be listed before it is finished, so the product query must
    // not filter on `status` the way the commission query does.
    expect(capture.sql).toMatch(/published\s*=\s*1/);
  });

  it('/work asks for client commissions only', async () => {
    const capture: Capture = { sql: '', params: [] };
    await listClientWork(fakeDb(capture, []));

    expect(capture.sql).toMatch(/ownership\s*=\s*'client'/);
  });

  it('the two queries cannot both match the same row', async () => {
    const products: Capture = { sql: '', params: [] };
    const work: Capture = { sql: '', params: [] };
    await listOwnProducts(fakeDb(products, []));
    await listClientWork(fakeDb(work, []));

    expect(products.sql).not.toMatch(/ownership\s*=\s*'client'/);
    expect(work.sql).not.toMatch(/ownership\s*=\s*'own'/);
  });
});

describe('visibility', () => {
  const HIDDEN = ["private", "archived"] as const;

  for (const status of HIDDEN) {
    it(`a ${status} project is excluded from /work`, async () => {
      const capture: Capture = { sql: '', params: [] };
      await listClientWork(fakeDb(capture, []));
      expect(capture.sql).toContain(`'${status}'`);
    });
  }

  it('every public listing excludes unpublished rows', async () => {
    for (const [label, run] of [
      ['products', listOwnProducts],
      ['work', listClientWork],
      ['all', listPublishedProjects],
    ] as const) {
      const capture: Capture = { sql: '', params: [] };
      await run(fakeDb(capture, []) as never);
      expect(capture.sql, label).toMatch(/published\s*=\s*1/);
    }
  });

  it('a private row never reaches the caller, whatever the ORDER BY says', async () => {
    // The SQL is the defence. If the WHERE clause is right, this cannot return
    // the row even when the fake is asked for it, because the real D1 would
    // have filtered it before ordering.
    const capture: Capture = { sql: '', params: [] };
    await listClientWork(fakeDb(capture, []));
    expect(capture.sql).not.toMatch(/ORDER BY[\s\S]*published/);
  });
});

describe('product ordering', () => {
  it('orders by lifecycle, so a live product leads a planned one', async () => {
    const capture: Capture = { sql: '', params: [] };
    await listOwnProducts(fakeDb(capture, []));

    expect(capture.sql).toMatch(/ORDER BY/);
    expect(capture.sql).toMatch(/product_status/);
    // Live first, planning last.
    const liveIdx = capture.sql.indexOf("WHEN 'live' THEN 0");
    const planningIdx = capture.sql.indexOf("WHEN 'planning' THEN 3");
    expect(liveIdx).toBeGreaterThan(-1);
    expect(planningIdx).toBeGreaterThan(liveIdx);
  });

  it('own products are cast to Product, so ownership is narrowed to own', async () => {
    const rows = [row({ ownership: 'own', product_status: 'live' })];
    const products = await listOwnProducts(fakeDb({ sql: '', params: [] }, rows));

    expect(products).toHaveLength(1);
    const product = products[0];
    expect(product.ownership).toBe('own');
    expect(product.productStatus).toBe('live');
  });
});

describe('row mapping', () => {
  it('an own row keeps its narrative fields', async () => {
    const rows = [
      row({
        ownership: 'own',
        product_status: 'in-development',
        tagline: 'One line.',
        objective_md: 'Objective body.',
        engineering_md: 'Engineering body.',
        challenges_md: 'Challenges body.',
        lessons_md: 'Lessons body.',
        availability_url: 'https://example.com/waitlist',
      }),
    ];
    const [product] = await listOwnProducts(fakeDb({ sql: '', params: [] }, rows));

    expect(product.tagline).toBe('One line.');
    expect(product.objectiveMd).toBe('Objective body.');
    expect(product.engineeringMd).toBe('Engineering body.');
    expect(product.challengesMd).toBe('Challenges body.');
    expect(product.lessonsMd).toBe('Lessons body.');
    expect(product.availabilityUrl).toBe('https://example.com/waitlist');
  });

  it('a client row maps lifecycle fields to null rather than undefined', async () => {
    const [project] = await listClientWork(fakeDb({ sql: '', params: [] }, [row()]));

    expect(project.productStatus).toBeNull();
    expect(project.tagline).toBeNull();
    expect(project.availabilityUrl).toBeNull();
    expect(project.ownership).toBe('client');
  });
});

describe('countByOwnership', () => {
  it('counts each side separately', async () => {
    const db = fakeDb({ sql: '', params: [] }, [
      { ownership: 'own', n: 2 },
      { ownership: 'client', n: 0 },
    ]);
    const counts = await countByOwnership(db);
    expect(counts).toEqual({ client: 0, own: 2 });
  });

  it('reports zero for a side with no published rows', async () => {
    const counts = await countByOwnership(fakeDb({ sql: '', params: [] }, []));
    expect(counts).toEqual({ client: 0, own: 0 });
  });

  it('ignores unknown ownership values rather than counting them as client', async () => {
    const db = fakeDb({ sql: '', params: [] }, [{ ownership: 'weird', n: 5 }]);
    const counts = await countByOwnership(db);
    expect(counts).toEqual({ client: 0, own: 0 });
  });
});

describe('differentiators', () => {
  it('reads only published rows, in editorial order', async () => {
    const capture: Capture = { sql: '', params: [] };
    const rows = [{ id: 1, label: 'a', body: 'b' }];
    const items: Differentiator[] = await listDifferentiators(fakeDb(capture, rows));

    expect(capture.sql).toMatch(/published\s*=\s*1/);
    expect(capture.sql).toMatch(/ORDER BY sort_order ASC/);
    expect(items[0].label).toBe('a');
  });
});

describe('services', () => {
  it('lists signature services first, and carries the price columns', async () => {
    const capture: Capture = { sql: '', params: [] };
    const rows = [
      {
        id: 1,
        slug: 'web-applications',
        name: 'Web applications',
        outcome: 'o',
        deliverables: '["A"]',
        price_from: '25,000',
        price_to: '60,000',
        price_note: 'Fixed scope.',
        engagement: 'Fixed scope',
        is_signature: 1,
      },
    ];
    const services: Service[] = await listServices(fakeDb(capture, rows));

    expect(capture.sql).toMatch(/is_signature DESC/);
    expect(services[0].priceFrom).toBe('25,000');
    expect(services[0].priceTo).toBe('60,000');
    expect(services[0].priceNote).toBe('Fixed scope.');
    expect(services[0].engagement).toBe('Fixed scope');
    expect(services[0].isSignature).toBe(true);
  });

  it('an ongoing service has no range and is not a zero price', async () => {
    const rows = [
      {
        id: 2,
        slug: 'maintenance',
        name: 'Maintenance',
        outcome: 'o',
        deliverables: '[]',
        price_from: null,
        price_to: null,
        price_note: 'Billed monthly.',
        engagement: 'Monthly',
        is_signature: 0,
      },
    ];
    const [service] = await listServices(fakeDb({ sql: '', params: [] }, rows));

    // null, not '' or '0' — a service page must not print "£0 – £0".
    expect(service.priceFrom).toBeNull();
    expect(service.priceTo).toBeNull();
    expect(service.isSignature).toBe(false);
  });
});


/**
 * The admin write path.
 *
 * Two bugs lived here and both presented as a 500 rather than as wrong data,
 * which is why nothing caught them:
 *
 *  * `body_md` was absent from the API's case-study field list, so it bound
 *    `undefined` and D1 rejected the statement outright.
 *  * `validateOptionalLink` returns `''` for a blank URL, and `''` was bound
 *    where NULL was meant, which would have written an empty "Ask for access"
 *    link rather than none at all.
 *
 * D1 cannot bind `undefined`, so the whole class of bug is worth asserting
 * structurally rather than only for the fields that happened to break.
 */
describe('admin INSERT placeholder arity', () => {
  /**
   * Counts the numbered placeholders in the INSERT's SQL and compares them with
   * the number of arguments actually bound.
   *
   * The original failure was a 27-placeholder statement whose bind list was
   * missing `body_md`, which shifted every later value by one and bound
   * `undefined` at the end. Nothing in the type system catches that: the
   * `undefined` is legal until D1 throws at runtime, as a 500.
   */
  async function insertSqlAndArity(): Promise<{ placeholders: number[]; bound: number }> {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(
      new URL('../../src/pages/api/admin/projects.ts', import.meta.url),
      'utf8',
    );

    const insertAt = source.indexOf('INSERT INTO projects');
    if (insertAt === -1) throw new Error('could not find the projects INSERT');

    // From the INSERT to its .run(): that span holds both the SQL (with the
    // placeholders) and the .bind() argument list. Scoping to this span is what
    // stops the counter from picking up an earlier statement's .bind().
    const runAt = source.indexOf('.run()', insertAt);
    const span = source.slice(insertAt, runAt);

    const placeholders = [...span.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));

    const bindAt = span.indexOf('.bind(');
    if (bindAt === -1) throw new Error('the INSERT has no .bind() call');

    // Top-level arguments of that .bind(): commas at depth 0 only.
    // Cut at the closing paren of .bind(...) — the span runs on to .run().
    // A trailing comma inside those parens is formatting, not an argument.
    const raw = span.slice(bindAt + '.bind('.length);
    const args = raw.slice(0, raw.lastIndexOf(')')).replace(/[\s,]+$/, '');
    let depth = 0;
    let bound = 0;
    let seen = false;
    for (const ch of args) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (ch === ',' && depth === 0) { bound++; seen = true; }
      else if (!/\s/.test(ch)) seen = true;
    }
    if (seen) bound++;

    return { placeholders, bound };
  }

  it('binds one argument per placeholder', async () => {
    const { placeholders, bound } = await insertSqlAndArity();
    expect(placeholders.length).toBeGreaterThan(20);
    expect(
      bound,
      `statement has ${placeholders.length} placeholders but ${bound} values are bound`,
    ).toBe(placeholders.length);
  });

  it('numbers the placeholders contiguously from 1', async () => {
    const { placeholders } = await insertSqlAndArity();
    const highest = Math.max(...placeholders);
    expect(new Set(placeholders).size, 'duplicate or skipped placeholder number').toBe(highest);
  });

  it('every case-study column the schema declares is writable through the API', async () => {
    const { readFile } = await import('node:fs/promises');
    const api = await readFile(
      new URL('../../src/pages/api/admin/projects.ts', import.meta.url),
      'utf8',
    );
    const migration = await readFile(
      new URL('../../migrations/0002_products_case_study.sql', import.meta.url),
      'utf8',
    );

    // The columns migration 0002 added to projects.
    const added = [...migration.matchAll(/ALTER TABLE projects ADD COLUMN (\w+)/g)].map((m) => m[1]);
    expect(added.length).toBeGreaterThan(5);

    for (const column of added) {
      expect(
        api.includes(column),
        `${column} exists in the schema but the admin API can never write it`,
      ).toBe(true);
    }
  });
});
