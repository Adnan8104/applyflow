// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// freehire.me provider — the freehire.me public REST API (JSON, no auth, no
// API key). Ported from the freehire-search skill in
// MadsLorentzen/ai-job-search (MIT-licensed), which reads the same "agent"
// search endpoint — the one variant of freehire's search that returns each
// hit's full description inline instead of a truncated preview, so this
// provider gets `Job.description` for free (no per-posting request) without
// violating the "zero-token list fetch" rule in ADDING_A_PROVIDER.md.
//
// Wire in via a `job_boards:` entry with `provider: freehire`:
//
//   - job_boards:
//       - name: freehire — Platform Engineer
//         provider: freehire
//         keywords: "platform engineer"
//         remote: remote            # remote | hybrid | onsite (optional)
//         countries: ["United States"]   # common names normalized to API codes (also: regions, cities — raw API codes only, e.g. "north_america", "eu")
//         posted_within_days: 14    # optional
//
// Simplification vs. the source skill: the base URL is a fixed literal
// (https://freehire.me) rather than the skill's FREEHIRE_API_URL
// self-host override. Per ADDING_A_PROVIDER.md's SSRF section, a fixed
// literal host needs no allowlist check; adding a configurable base URL
// would reopen that guard for a use case (self-hosted freehire instances)
// this project has no other reason to support.

import { fetchJsonWithRetry } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const BASE_URL = 'https://freehire.me';
const SEARCH_PATH = '/api/v1/agent/jobs/search';

/** Postings per page. freehire's own default cap is higher; this keeps one page light. */
const PAGE_SIZE = 50;
/** 10 pages = 500 postings — generous for one saved search per sweep. */
const DEFAULT_MAX_PAGES = 10;
/** Hard ceiling even for an explicit `max_pages` override. */
const MAX_PAGES_CAP = 40;

// No rate limiting observed in the source skill's own notes; still pace
// between pages rather than assume none exists.
const INTER_PAGE_DELAY_MS = 300;

/** @param {any} ctx @param {number} ms */
function sleep(ctx, ms) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((r) => setTimeout(r, ms));
}

function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function workModeParam(mode) {
  const v = String(mode ?? '').toLowerCase();
  return v === 'remote' || v === 'hybrid' || v === 'onsite' ? v : null;
}

// The countries/regions/cities facets take the API's own lowercase codes
// (verified live 2026-09-21: `countries=us` returns results, `countries=United
// States` silently returns zero — no error, no ignored_params warning, just an
// empty page), not the human-readable names a portals.yml author would type
// first. This maps the common full names people actually write; anything not
// in the map passes through lowercased as-is, so a correct raw code (or one
// this map doesn't yet cover) still works unmodified.
const COUNTRY_CODES = {
  'united states': 'us', usa: 'us', 'u.s.': 'us', 'u.s.a.': 'us',
  'united kingdom': 'gb', uk: 'gb',
  canada: 'ca', germany: 'de', france: 'fr', netherlands: 'nl',
  india: 'in', australia: 'au', spain: 'es', ireland: 'ie',
};

function normalizeCountry(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return COUNTRY_CODES[v] ?? v;
}

/**
 * Build the query string for one page.
 * @param {{ keywords?: string, remote?: string, countries?: string[], regions?: string[],
 *   cities?: string[], posted_within_days?: number }} entry
 * @param {number} page
 */
export function buildQuery(entry, page) {
  const p = new URLSearchParams();
  const keywords = String(entry?.keywords ?? '').trim();
  if (keywords) p.set('q', keywords);
  p.set('limit', String(PAGE_SIZE));
  p.set('offset', String((page - 1) * PAGE_SIZE));
  p.set('semantic_ratio', '0'); // keyword search — the semantic index is opt-in on freehire's own UI
  p.set('include_description', 'true'); // the list payload carries it for free on this endpoint
  p.set('description_format', 'text'); // avoids needing HTML→text cleanup below
  const days = Number(entry?.posted_within_days);
  if (Number.isFinite(days) && days > 0 && days < 9999) p.set('posted_within_days', String(days));
  const wt = workModeParam(entry?.remote);
  if (wt) p.set('work_mode', wt);
  if (Array.isArray(entry?.countries)) {
    for (const v of entry.countries) if (v) p.append('countries', normalizeCountry(v));
  }
  for (const [param, values] of [
    ['regions', entry?.regions],
    ['cities', entry?.cities],
  ]) {
    if (Array.isArray(values)) for (const v of values) if (v) p.append(param, String(v));
  }
  return p;
}

/**
 * Normalize one freehire job record into the provider Job shape.
 * @param {any} j
 */
export function normalizeFreehireJob(j) {
  if (!j || typeof j !== 'object') return null;
  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

  let url = '';
  const rawUrl = typeof j.url === 'string' ? j.url.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:') url = parsed.href;
    } catch {
      // malformed → dropped below
    }
  }
  if (!url) return null;

  const company = typeof j.company === 'string' ? j.company.trim() : '';
  const location = typeof j.location === 'string' ? j.location.trim() : '';
  // description_format=text should need no entity decoding, but decode
  // defensively — a source-side rendering quirk should not leak a literal
  // "&amp;" into the tracker (never write a local decoder — see
  // _html-entities.mjs's own history of that exact bug being reintroduced).
  const description = typeof j.description === 'string' && j.description.trim()
    ? decodeEntities(j.description).trim()
    : undefined;
  const postedAt = toEpochMs(j.posted_at ?? j.created_at);

  return {
    title,
    url,
    company,
    location,
    ...(description !== undefined ? { description } : {}),
    ...(postedAt !== undefined ? { postedAt } : {}),
  };
}

/** @type {Provider} */
export default {
  id: 'freehire',

  detect(entry) {
    return entry?.provider === 'freehire' ? { url: `${BASE_URL}${SEARCH_PATH}` } : null;
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

      const url = `${BASE_URL}${SEARCH_PATH}?${buildQuery(entry, page).toString()}`;
      // redirect:'error' prevents SSRF via a server-side redirect; BASE_URL is
      // a fixed literal so no hostname allowlist check is needed (see header).
      const json = await fetchJsonWithRetry(ctx, url, { redirect: 'error' });

      if (!json || !Array.isArray(json.data)) {
        throw new Error(
          `freehire: unexpected API response on page ${page} — expected { data: [...] }, got keys: [${json && typeof json === 'object' ? Object.keys(json).join(', ') : String(json)}]`,
        );
      }

      const before = seen.size;
      for (const raw of json.data) {
        const normalized = normalizeFreehireJob(raw);
        if (!normalized || seen.has(normalized.url)) continue;
        seen.add(normalized.url);
        jobs.push(normalized);
      }
      if (seen.size === before) break; // page added nothing new → stop
      if (json.data.length < PAGE_SIZE) break; // short page → last page reached
    }

    return jobs;
  },
};
