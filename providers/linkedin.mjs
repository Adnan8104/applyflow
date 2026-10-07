// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// LinkedIn provider — reads LinkedIn's public, unauthenticated "jobs-guest"
// search endpoint (the same one LinkedIn itself serves to logged-out visitors
// and to search-engine crawlers). No login, no cookies, no API key.
//
// Wire in via a `job_boards:` entry with `provider: linkedin` — there is no
// per-entry `careers_url`/`api` for this one (LinkedIn is a query-scoped
// aggregator, not a single employer's board), so detect() is explicit-only:
//
//   - job_boards:
//       - name: LinkedIn — AI Engineer (US)
//         provider: linkedin
//         keywords: "AI engineer"
//         location: "United States"
//         remote: remote            # remote | hybrid | onsite (optional)
//         posted_within_days: 7     # optional
//
// Ported from the linkedin-search skill in MadsLorentzen/ai-job-search
// (MIT-licensed), which parses the same endpoint with the same regex
// approach — LinkedIn's guest markup is shallow and stable enough that a
// full DOM parser is unneeded. Adapted to this project's provider contract:
// shared HTTP transport (ctx.fetchText, retry, redirect:'error'), the shared
// entity decoder, an absolute page ceiling, and ctx.maxPages probe
// cooperation, none of which the source skill needed since it's a one-shot
// CLI, not a provider a health probe walks defensively.
//
// UNVERIFIED AGAINST A LIVE RUN. Unlike the other providers in this
// directory (which document a specific "measured live on {date}" check),
// this one has not been probed against LinkedIn in this environment. The
// card markup below matches ai-job-search's own working implementation as of
// its last commit, but LinkedIn changes this markup without notice more
// often than a single-employer ATS does — if `scan.mjs --company` (or a
// `--verify` run) on a `linkedin` entry parses zero jobs, check
// `assertLikelyBlocked` first (a WAF/consent-wall response looks different
// from a genuinely empty search) before assuming the regexes drifted.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const TRUSTED_HOST = 'www.linkedin.com';
const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

/** This endpoint pages in fixed increments of 10 (`start=(page-1)*10`). */
const PER_PAGE = 10;

/** 10 pages = 100 postings — generous for a single scan.mjs sweep of one saved search. */
const DEFAULT_MAX_PAGES = 10;
/** Hard ceiling even for an explicit `max_pages` override. */
const MAX_PAGES_CAP = 40;

// No 429 has been observed live (see the "unverified" note above), but this
// guest endpoint is one of the most heavily scraped on the public internet,
// so pace conservatively rather than find out the hard way mid-sweep.
const INTER_PAGE_DELAY_MS = 800;

/** @param {any} ctx @param {number} ms */
function sleep(ctx, ms) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string} url */
function assertLinkedInUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`linkedin: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`linkedin: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`linkedin: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** epoch-ms conversion that never lets a NaN parse pass as a real date. */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Workplace-type filter flag: onsite=1, remote=2, hybrid=3. */
function workTypeFlag(mode) {
  switch (String(mode ?? '').toLowerCase()) {
    case 'remote': return '2';
    case 'hybrid': return '3';
    case 'onsite':
    case 'on-site': return '1';
    default: return null;
  }
}

/** `posted_within_days` → LinkedIn's f_TPR seconds-ago filter value. */
function daysToTPR(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0 || n >= 9999) return null;
  return `r${Math.round(n * 86400)}`;
}

/**
 * Build one search-results page URL.
 * @param {{ keywords?: string, location?: string, remote?: string, posted_within_days?: number }} entry
 * @param {number} page
 */
export function buildSearchUrl(entry, page) {
  const params = new URLSearchParams();
  const keywords = String(entry?.keywords ?? '').trim();
  const location = String(entry?.location ?? '').trim();
  if (keywords) params.set('keywords', keywords);
  if (location) params.set('location', location);
  const tpr = daysToTPR(entry?.posted_within_days);
  if (tpr) params.set('f_TPR', tpr);
  const wt = workTypeFlag(entry?.remote);
  if (wt) params.set('f_WT', wt);
  params.set('start', String((page - 1) * PER_PAGE));
  return `${SEARCH_URL}?${params.toString()}`;
}

/**
 * A response that never mentions a job posting at all — no result card, no
 * "no matching jobs" copy — reads as a consent wall or a challenge page
 * rather than a genuinely empty search. A truly empty LinkedIn search still
 * renders its (empty) results list markup; a block page renders neither.
 * Heuristic, not verified against a live block response — see the file
 * header. Kept permissive on purpose: it only fires when NONE of these
 * markers are present, so it should never misfire on a real empty page.
 * @param {string} html
 */
export function looksBlocked(html) {
  const text = String(html ?? '');
  if (text.length < 200) return true; // a real guest page is never this short
  return !/data-entity-urn="urn:li:jobPosting:|jobs-search__results-list|base-search-card|no matching jobs|no results/i.test(text);
}

/**
 * Parse the search response into job cards. Cards are split on the
 * `data-entity-urn="urn:li:jobPosting:` marker so one malformed chunk cannot
 * corrupt its neighbours.
 * @param {string} html
 * @returns {{title: string, url: string, company: string, location: string, postedAt?: number}[]}
 */
export function parseJobCards(html) {
  const source = String(html ?? '');
  const chunks = source.split('data-entity-urn="urn:li:jobPosting:').slice(1);
  const out = [];

  for (const chunk of chunks) {
    const idMatch = /^(\d+)/.exec(chunk);
    if (!idMatch) continue;
    const id = idMatch[1];

    const linkMatch = /class="base-card__full-link[^"]*"[^>]*href="([^"]+)"/i.exec(chunk);
    let url = '';
    if (linkMatch) {
      try {
        const resolved = new URL(decodeEntities(linkMatch[1]).split('?')[0], `https://${TRUSTED_HOST}`);
        if (resolved.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(resolved.hostname)) {
          // Strip one trailing slash so a card's own href and the id-built
          // fallback below always normalize to the same dedup key.
          url = resolved.toString().replace(/\/$/, '');
        }
      } catch {
        // malformed href → fall back to the canonical URL built from id below
      }
    }
    if (!url) url = `https://${TRUSTED_HOST}/jobs/view/${id}`;

    let title = '';
    const h3 = /class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>/i.exec(chunk);
    if (h3) title = decodeEntities(h3[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!title) {
      const sr = /class="sr-only"[^>]*>([\s\S]*?)<\/span>/i.exec(chunk);
      if (sr) title = decodeEntities(sr[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    }
    if (!title) continue; // no recoverable title → drop this card, not the page

    let company = '';
    const sub = /class="base-search-card__subtitle"[^>]*>([\s\S]*?)<\/h4>/i.exec(chunk);
    if (sub) company = decodeEntities(sub[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

    let location = '';
    const loc = /class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>/i.exec(chunk);
    if (loc) location = decodeEntities(loc[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

    const dt = /class="job-search-card__listdate[^"]*"[^>]*datetime="([^"]+)"/i.exec(chunk);
    const postedAt = dt ? toEpochMs(dt[1]) : undefined;

    out.push({ title, url, company, location, ...(postedAt !== undefined ? { postedAt } : {}) });
  }

  return out;
}

/** @type {Provider} */
export default {
  id: 'linkedin',

  detect(entry) {
    return entry?.provider === 'linkedin' ? { url: SEARCH_URL } : null;
  },

  async fetch(entry, ctx) {
    const entryMaxPages = Number.isInteger(entry?.max_pages) && entry.max_pages > 0
      ? Math.min(entry.max_pages, MAX_PAGES_CAP)
      : DEFAULT_MAX_PAGES;
    const maxPages = Math.min(
      entryMaxPages,
      Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity,
    );

    const jobs = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(ctx, INTER_PAGE_DELAY_MS);

      const url = assertLinkedInUrl(buildSearchUrl(entry, page));
      const html = await fetchTextWithRetry(ctx, url, {
        headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT },
        redirect: 'error',
      });

      const parsed = parseJobCards(html);
      if (parsed.length === 0) {
        if (page === 1 && looksBlocked(html)) {
          throw new Error(
            `linkedin: ${url} returned no recognizable job markup — likely blocked, consent-walled, or the markup changed`,
          );
        }
        break; // a later empty page (or a genuinely empty search) is just the end
      }

      const before = seen.size;
      for (const job of parsed) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      if (seen.size === before) break; // no new postings → stop rather than loop on stale duplicates
      if (parsed.length < PER_PAGE) break; // short page → last page reached
    }

    return jobs;
  },
};
