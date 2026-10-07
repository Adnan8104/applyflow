// tests/providers/freehire.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — freehire');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/freehire.mjs')).href);
  const freehire = mod.default;
  const { buildQuery, normalizeFreehireJob } = mod;

  if (freehire.id === 'freehire') pass('freehire.id is "freehire"');
  else fail(`freehire.id is ${JSON.stringify(freehire.id)}`);

  // detect() is explicit-only.
  if (freehire.detect({ provider: 'freehire' })?.url && freehire.detect({ careers_url: 'https://freehire.me/jobs/x' }) === null) {
    pass('freehire.detect() is explicit-only (provider: "freehire")');
  } else {
    fail(`freehire.detect() = ${JSON.stringify({ explicit: freehire.detect({ provider: 'freehire' }), byUrl: freehire.detect({ careers_url: 'https://freehire.me/jobs/x' }) })}`);
  }
  if (freehire.detect({}) === null && freehire.detect(null) === null) pass('freehire.detect() returns null on no match / null entry, never throws');
  else fail('freehire.detect() should return null for a non-matching entry');

  // buildQuery — parameter construction.
  const q1 = buildQuery({ keywords: 'platform engineer', remote: 'remote', countries: ['United States'], posted_within_days: 14 }, 1);
  if (q1.get('q') === 'platform engineer' && q1.get('work_mode') === 'remote'
      && q1.getAll('countries').join(',') === 'us' && q1.get('posted_within_days') === '14'
      && q1.get('limit') === '50' && q1.get('offset') === '0'
      && q1.get('include_description') === 'true' && q1.get('description_format') === 'text') {
    pass('buildQuery encodes keywords/work_mode/countries/posted_within_days and always requests text descriptions');
  } else {
    fail(`buildQuery page 1 = ${q1.toString()}`);
  }
  const q2 = buildQuery({}, 2);
  if (q2.get('offset') === '50' && !q2.has('q') && !q2.has('work_mode') && !q2.has('posted_within_days')) {
    pass('buildQuery advances offset by page size and omits unset optional params');
  } else {
    fail(`buildQuery page 2 = ${q2.toString()}`);
  }
  const qBadRemote = buildQuery({ remote: 'onsite-ish' }, 1);
  if (!qBadRemote.has('work_mode')) pass('buildQuery drops an unrecognized remote value rather than passing it through');
  else fail(`buildQuery should reject an unrecognized remote value, got work_mode=${qBadRemote.get('work_mode')}`);

  // countries: the API's facet takes lowercase codes ("us"), not human names —
  // verified live 2026-09-21 ("United States" silently returns zero results,
  // no error). Common full names are normalized; an already-correct or
  // unrecognized code passes through lowercased, unmodified.
  const qCountries = buildQuery({ countries: ['United States', 'Germany', 'xx'] }, 1);
  if (qCountries.getAll('countries').join(',') === 'us,de,xx') {
    pass('buildQuery normalizes common country names to the API\'s lowercase codes, passing unknown values through lowercased');
  } else {
    fail(`buildQuery countries = ${qCountries.getAll('countries').join(',')}`);
  }

  // normalizeFreehireJob — field mapping.
  const full = normalizeFreehireJob({
    public_slug: 'acme-staff-ai-engineer', title: '  Staff AI Engineer  ', company: ' Acme Co ',
    location: 'Remote', url: 'https://freehire.me/jobs/acme-staff-ai-engineer',
    description: 'Build things &amp; ship them.', posted_at: '2026-09-01T00:00:00Z',
  });
  if (full && full.title === 'Staff AI Engineer' && full.company === 'Acme Co' && full.location === 'Remote'
      && full.url === 'https://freehire.me/jobs/acme-staff-ai-engineer'
      && full.description === 'Build things & ship them.'
      && full.postedAt === Date.parse('2026-09-01T00:00:00Z')) {
    pass('normalizeFreehireJob maps + trims fields, decodes description entities, and converts posted_at to epoch ms');
  } else {
    fail(`normalizeFreehireJob full row = ${JSON.stringify(full)}`);
  }

  const noDesc = normalizeFreehireJob({ title: 'T', url: 'https://freehire.me/jobs/x' });
  if (noDesc && !('description' in noDesc) && !('postedAt' in noDesc)) {
    pass('normalizeFreehireJob omits description/postedAt when absent, rather than inventing empty values');
  } else {
    fail(`normalizeFreehireJob sparse row = ${JSON.stringify(noDesc)}`);
  }

  const drops = [
    normalizeFreehireJob({ title: '', url: 'https://freehire.me/jobs/d1' }),
    normalizeFreehireJob({ title: 'No URL' }),
    normalizeFreehireJob({ title: 'Bad URL', url: 'not-a-url' }),
    normalizeFreehireJob({ title: 'Insecure', url: 'http://freehire.me/jobs/d3' }),
    normalizeFreehireJob(null),
  ];
  if (drops.every(r => r === null)) pass('normalizeFreehireJob drops empty-title / no-url / malformed-url / non-https / non-object');
  else fail(`normalizeFreehireJob drops = ${JSON.stringify(drops)}`);

  // fetch() — pagination, redirect:'error', dedup stop, max_pages / ctx.maxPages cap.
  const mkJob = (i) => ({ title: `Role ${i}`, url: `https://freehire.me/jobs/role-${i}`, company: `Co ${i}` });
  const page1 = Array.from({ length: 50 }, (_, i) => mkJob(i));
  const page2 = [mkJob(50), mkJob(51), { title: '', url: 'https://freehire.me/jobs/bad' }]; // short page (3 < 50) → stop; 1 drop
  const requested = [];
  const mockFetchJson = async (url, opts) => {
    requested.push({ url, redirect: opts?.redirect });
    const offset = Number(new URL(url).searchParams.get('offset'));
    if (offset === 0) return { data: page1, meta: { total: 52 } };
    if (offset === 50) return { data: page2, meta: { total: 52 } };
    return { data: [], meta: { total: 52 } };
  };

  const jobs = await freehire.fetch({ keywords: 'engineer' }, { fetchJson: mockFetchJson, sleep: async () => {} });
  if (requested.length === 2 && requested.every(r => r.redirect === 'error')) {
    pass('freehire.fetch() passes redirect:"error" on every page (SSRF guard)');
  } else {
    fail(`freehire.fetch() redirect opts = ${JSON.stringify(requested.map(r => r.redirect))}`);
  }
  if (jobs.length === 52) pass('freehire.fetch() aggregates valid jobs across pages (50 + 2, dropping the empty-title row)');
  else fail(`freehire.fetch() returned ${jobs.length} jobs (expected 52)`);

  // max_pages cap: only the first page is requested even though it is full.
  const capRequested = [];
  await freehire.fetch(
    { max_pages: 1 },
    { fetchJson: async (url) => { capRequested.push(url); return { data: page1 }; }, sleep: async () => {} },
  );
  if (capRequested.length === 1) pass('freehire.fetch() honors max_pages (stops at the cap even on a full page)');
  else fail(`freehire.fetch() max_pages:1 requested ${capRequested.length} times`);

  // ctx.maxPages caps the walk regardless of entry.max_pages.
  const probeRequested = [];
  await freehire.fetch(
    { max_pages: 5 },
    { fetchJson: async (url) => { probeRequested.push(url); return { data: page1 }; }, maxPages: 1, sleep: async () => {} },
  );
  if (probeRequested.length === 1) pass('freehire.fetch() honors ctx.maxPages even when entry.max_pages allows more');
  else fail(`freehire.fetch() with ctx.maxPages:1 made ${probeRequested.length} requests`);

  // unexpected API response shape → throws (a real API error already throws inside
  // fetchJson itself on a non-2xx; this covers a 2xx body that isn't the documented shape).
  let badThrew = false;
  try {
    await freehire.fetch({}, { fetchJson: async () => ({ wrong: true }), sleep: async () => {} });
  } catch (e) {
    badThrew = /unexpected API response/.test(e.message);
  }
  if (badThrew) pass('freehire.fetch() throws on an unexpected API response shape');
  else fail('freehire.fetch() should throw when data is not an array');

} catch (e) {
  fail(`freehire provider tests crashed: ${e.message}`);
}
