// tests/providers/linkedin.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — linkedin');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/linkedin.mjs')).href);
  const linkedin = mod.default;
  const { buildSearchUrl, parseJobCards, looksBlocked } = mod;

  if (linkedin.id === 'linkedin') pass('linkedin.id is "linkedin"');
  else fail(`linkedin.id is ${JSON.stringify(linkedin.id)}`);

  // detect() is explicit-only — LinkedIn is a query-scoped aggregator, not a
  // per-entry careers_url host to pattern-match.
  if (linkedin.detect({ provider: 'linkedin' })?.url && linkedin.detect({ careers_url: 'https://www.linkedin.com/jobs/x' }) === null) {
    pass('linkedin.detect() is explicit-only (provider: "linkedin"), never matches a bare careers_url');
  } else {
    fail(`linkedin.detect() = ${JSON.stringify({ explicit: linkedin.detect({ provider: 'linkedin' }), byUrl: linkedin.detect({ careers_url: 'https://www.linkedin.com/jobs/x' }) })}`);
  }
  if (linkedin.detect({}) === null && linkedin.detect(null) === null) pass('linkedin.detect() returns null on no provider / null entry, never throws');
  else fail('linkedin.detect() should return null for an entry with no matching provider field');

  // buildSearchUrl — query construction.
  const url1 = buildSearchUrl({ keywords: 'AI engineer', location: 'United States', remote: 'remote', posted_within_days: 7 }, 1);
  const u1 = new URL(url1);
  if (u1.searchParams.get('keywords') === 'AI engineer'
      && u1.searchParams.get('location') === 'United States'
      && u1.searchParams.get('f_WT') === '2'
      && u1.searchParams.get('f_TPR') === 'r604800'
      && u1.searchParams.get('start') === '0') {
    pass('buildSearchUrl encodes keywords/location/remote/posted_within_days and start=0 on page 1');
  } else {
    fail(`buildSearchUrl page 1 = ${url1}`);
  }
  const url3 = buildSearchUrl({}, 3);
  if (new URL(url3).searchParams.get('start') === '20') pass('buildSearchUrl increments start by 10 per page');
  else fail(`buildSearchUrl page 3 = ${url3}`);
  if (!new URL(buildSearchUrl({}, 1)).searchParams.has('f_TPR') && !new URL(buildSearchUrl({ posted_within_days: 0 }, 1)).searchParams.has('f_TPR')) {
    pass('buildSearchUrl omits f_TPR when posted_within_days is absent or 0');
  } else {
    fail('buildSearchUrl should omit f_TPR when posted_within_days is unset/zero');
  }

  // parseJobCards — a realistic two-card fixture.
  const fixture = `
    <li>
    <div class="base-card" data-entity-urn="urn:li:jobPosting:1111111111">
      <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/1111111111/?trk=xyz">link</a>
      <h3 class="base-search-card__title">Staff AI Engineer</h3>
      <h4 class="base-search-card__subtitle"><a href="https://www.linkedin.com/company/acme">Acme &amp; Co</a></h4>
      <span class="job-search-card__location">Remote</span>
      <time class="job-search-card__listdate" datetime="2026-09-01">2 weeks ago</time>
    </div>
    </li>
    <li>
    <div class="base-card" data-entity-urn="urn:li:jobPosting:2222222222">
      <span class="sr-only">Platform Engineer</span>
      <h4 class="base-search-card__subtitle">BigCo</h4>
      <span class="job-search-card__location">New York, NY</span>
    </div>
    </li>
  `;
  const cards = parseJobCards(fixture);
  if (cards.length === 2) pass('parseJobCards finds both cards, split on data-entity-urn');
  else fail(`parseJobCards found ${cards.length} cards (expected 2)`);

  const [c1, c2] = cards;
  if (c1?.title === 'Staff AI Engineer' && c1.url === 'https://www.linkedin.com/jobs/view/1111111111'
      && c1.company === 'Acme & Co' && c1.location === 'Remote' && c1.postedAt === Date.parse('2026-09-01')) {
    pass('parseJobCards reads title/url/company(decoded entity)/location/postedAt from the full-link card, dropping tracking params');
  } else {
    fail(`parseJobCards card 1 = ${JSON.stringify(c1)}`);
  }
  if (c2?.title === 'Platform Engineer' && c2.url === 'https://www.linkedin.com/jobs/view/2222222222' && c2.company === 'BigCo') {
    pass('parseJobCards falls back to the sr-only span for title and to a canonical URL from the id when full-link is absent');
  } else {
    fail(`parseJobCards card 2 = ${JSON.stringify(c2)}`);
  }

  // A card with neither a title heading nor an sr-only span is dropped, not fatal.
  const noTitle = parseJobCards('<div data-entity-urn="urn:li:jobPosting:3333333333"><span class="job-search-card__location">Remote</span></div>');
  if (noTitle.length === 0) pass('parseJobCards drops a card with no recoverable title');
  else fail(`parseJobCards should drop a titleless card, got ${JSON.stringify(noTitle)}`);

  // An off-host full-link href is untrusted — fall back to the canonical URL.
  const offHost = parseJobCards(`
    <div data-entity-urn="urn:li:jobPosting:4444444444">
      <a class="base-card__full-link" href="https://evil.example/steal">link</a>
      <h3 class="base-search-card__title">Off-host test</h3>
    </div>
  `);
  if (offHost[0]?.url === 'https://www.linkedin.com/jobs/view/4444444444') {
    pass('parseJobCards ignores an off-host full-link href and falls back to the canonical linkedin.com URL');
  } else {
    fail(`parseJobCards off-host fallback = ${JSON.stringify(offHost)}`);
  }

  // looksBlocked — genuinely empty search vs. a consent/challenge page.
  if (looksBlocked('<html><body>tiny</body></html>') === true) pass('looksBlocked flags a short/markerless body');
  else fail('looksBlocked should flag a body with no job-search markers as likely blocked');
  if (looksBlocked(`<html>${'x'.repeat(300)}<ul class="jobs-search__results-list"></ul></html>`) === false) {
    pass('looksBlocked does not flag a real (even empty) results-list container');
  } else {
    fail('looksBlocked should not flag a page carrying the results-list marker');
  }

  // fetch() — pagination, redirect:'error', ctx.maxPages, dedup stop.
  const mkCard = (id) => `<div data-entity-urn="urn:li:jobPosting:${id}"><h3 class="base-search-card__title">Role ${id}</h3></div>`;
  const page1Html = Array.from({ length: 10 }, (_, i) => mkCard(1000 + i)).join('\n');
  const page2Html = Array.from({ length: 3 }, (_, i) => mkCard(2000 + i)).join('\n'); // short page → stop
  const requested = [];
  const mockFetchText = async (url, opts) => {
    requested.push({ url, redirect: opts?.redirect });
    const start = new URL(url).searchParams.get('start');
    if (start === '0') return page1Html;
    if (start === '10') return page2Html;
    return '<ul class="jobs-search__results-list"></ul>'; // empty, marker present
  };

  const jobs = await linkedin.fetch({ keywords: 'engineer' }, { fetchText: mockFetchText, sleep: async () => {} });
  if (requested.length === 2 && requested.every(r => r.redirect === 'error')) {
    pass('linkedin.fetch() passes redirect:"error" on every request (SSRF guard)');
  } else {
    fail(`linkedin.fetch() redirect opts = ${JSON.stringify(requested.map(r => r.redirect))}`);
  }
  if (jobs.length === 13) pass('linkedin.fetch() aggregates across pages and stops on a short page (10 + 3)');
  else fail(`linkedin.fetch() returned ${jobs.length} jobs (expected 13)`);

  // ctx.maxPages caps the walk regardless of entry.max_pages.
  const probeRequested = [];
  await linkedin.fetch(
    { keywords: 'engineer', max_pages: 5 },
    { fetchText: async (url) => { probeRequested.push(url); return page1Html; }, maxPages: 1, sleep: async () => {} },
  );
  if (probeRequested.length === 1) pass('linkedin.fetch() honors ctx.maxPages even when entry.max_pages allows more');
  else fail(`linkedin.fetch() with ctx.maxPages:1 made ${probeRequested.length} requests`);

  // A blocked-looking first page throws rather than reporting a silent empty board.
  let threw = false;
  try {
    await linkedin.fetch({}, { fetchText: async () => 'tiny', sleep: async () => {} });
  } catch (e) {
    threw = /likely blocked/.test(e.message);
  }
  if (threw) pass('linkedin.fetch() throws on a first page that looks blocked rather than returning []');
  else fail('linkedin.fetch() should throw when looksBlocked() is true on page 1');

  // A genuinely empty (but not blocked-looking) first page returns [].
  const emptyButNotBlocked = await linkedin.fetch(
    {},
    { fetchText: async () => `<html>${'x'.repeat(300)}<ul class="jobs-search__results-list"></ul></html>`, sleep: async () => {} },
  );
  if (Array.isArray(emptyButNotBlocked) && emptyButNotBlocked.length === 0) {
    pass('linkedin.fetch() returns [] for a genuinely empty (marker-bearing) search result');
  } else {
    fail(`linkedin.fetch() empty-search result = ${JSON.stringify(emptyButNotBlocked)}`);
  }

} catch (e) {
  fail(`linkedin provider tests crashed: ${e.message}`);
}
