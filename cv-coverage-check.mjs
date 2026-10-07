#!/usr/bin/env node
// cv-coverage-check.mjs — does the tailored CV still carry the evidence cv.md has?
//
// Tailoring a CV is subtraction under a page constraint: something has to go to
// make room for role-specific framing. That makes every tailoring pass a chance
// to quietly drop a load-bearing claim, and the failure is invisible in every
// metric the pipeline already reports — page count, ATS score and keyword
// coverage ALL improve when evidence leaves the page. This project has the
// receipts: across the Netic CV, 15 claims were cut to hit a page target over
// three separate rounds, while every automated check stayed green
// (reports/001-netic-2026-09-21.md, steps 2, 3, 7 and 9).
//
// So this check asks the one question none of the others do: which claims in
// cv.md no longer appear in the rendered CV? A drop is not automatically wrong
// — cutting wrong-domain material is the correct first move to reach one page
// (see modes/_custom.md) — but it must be a decision someone made on purpose,
// not a side effect. Every drop therefore has to be named in --allow, which
// turns a silent deletion into a recorded one.
//
// Read-only. Never edits a CV, never edits cv.md.
//
// Usage:
//   node cv-coverage-check.mjs <tailored.pdf|.html> [--source cv.md]
//        [--allow "3D asset" --allow "GLB"] [--threshold 0.6] [--json] [--self-test]
//
// Exit 0 when every cv.md claim is either present or explicitly allowed to be
// absent; exit 1 when a claim went missing without being named.

import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { isMainModule } from './lib/is-main-module.mjs';

const DEFAULT_THRESHOLD = 0.6;

/** Tokens that carry meaning for matching — long words and anything with a digit. */
export function contentTokens(text) {
  const out = new Set();
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9+#./-]+/i)) {
    const w = raw.replace(/^[.\-/]+|[.\-/]+$/g, '');
    if (!w) continue;
    if (w.length > 4 || /\d/.test(w)) out.add(w);
  }
  return out;
}

/**
 * Claim-level lines from a markdown CV: the bullets. A bullet is the unit a
 * human would call "a thing I did", which is also the unit that goes missing.
 */
export function claimsFromMarkdown(md) {
  const claims = [];
  for (const line of String(md).split('\n')) {
    const m = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    const text = m[1].replace(/\*\*/g, '').trim();
    // Skip the Skills section's category lines: they are inventories, not
    // claims, and are checked as a set by verify-ats/keyword coverage instead.
    if (/^(languages|frameworks|tools\s*&\s*platforms|libraries\s*&\s*apis)\s*:/i.test(text)) continue;
    if (contentTokens(text).size < 4) continue;
    claims.push(text);
  }
  return claims;
}

/** Best token-overlap score of `claim` against any part of the rendered text. */
export function coverageScore(claim, haystackTokens) {
  const want = contentTokens(claim);
  if (want.size === 0) return 1;
  let hit = 0;
  for (const t of want) if (haystackTokens.has(t)) hit++;
  return hit / want.size;
}

/** Extract plain text from a .pdf (via pdftotext/pypdf) or .html/.md file. */
export function extractText(file) {
  if (!existsSync(file)) throw new Error(`no such file: ${file}`);
  if (/\.pdf$/i.test(file)) {
    for (const [cmd, args] of [
      ['pdftotext', [file, '-']],
      ['python3', ['-c', 'import sys;from pypdf import PdfReader;print(" ".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages))', file]],
    ]) {
      try {
        const out = execFileSync(cmd, args, { encoding: 'utf-8', timeout: 60_000 });
        if (out && out.trim()) return out;
      } catch { /* try the next extractor */ }
    }
    throw new Error(`could not extract text from ${file} (need pdftotext or python3+pypdf)`);
  }
  const raw = readFileSync(file, 'utf-8');
  if (/\.html?$/i.test(file)) {
    return raw
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  return raw;
}

/**
 * Compare a rendered CV against the claims in a source CV.
 * @returns {{present:object[], missing:object[], allowed:object[], verdict:string}}
 */
export function checkCoverage(renderedText, sourceMarkdown, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const allow = (opts.allow || []).map(a => String(a).toLowerCase());
  const hay = contentTokens(renderedText);
  const present = [], missing = [], allowed = [];

  for (const claim of claimsFromMarkdown(sourceMarkdown)) {
    const score = coverageScore(claim, hay);
    const row = { claim, score: Number(score.toFixed(3)) };
    if (score >= threshold) { present.push(row); continue; }
    const hit = allow.find(a => claim.toLowerCase().includes(a));
    if (hit) { allowed.push({ ...row, allowedBy: hit }); continue; }
    missing.push(row);
  }
  return {
    present, missing, allowed,
    verdict: missing.length === 0 ? 'pass' : 'fail',
    threshold,
  };
}

function runSelfTest() {
  let pass = 0, fail = 0;
  const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log(`  FAIL: ${label}`); } };

  const source = [
    '# CV',
    '## Experience',
    '- Built parallel multi-agent execution for an internal agentic coding CLI using isolated git worktrees.',
    '- Automated 3D asset optimization compressing GLB model size 64% and load time from 8.2s to 3.4s.',
    '- **Languages:** Python, Java, C++, Swift, SQL',
    '- tiny one',
  ].join('\n');

  ok('skills category lines are not treated as claims',
    !claimsFromMarkdown(source).some(c => /^Languages:/i.test(c)));
  ok('very short lines are not treated as claims',
    !claimsFromMarkdown(source).some(c => c === 'tiny one'));
  ok('real bullets are claims', claimsFromMarkdown(source).length === 2);

  // A CV that kept both claims passes.
  const full = 'Built parallel multi-agent execution for an internal agentic coding CLI using isolated git worktrees. '
    + 'Automated 3D asset optimization compressing GLB model size 64% and load time from 8.2s to 3.4s.';
  ok('a CV retaining every claim passes', checkCoverage(full, source).verdict === 'pass');

  // Dropping the 3D bullet fails — loudly — unless it is named.
  const trimmed = 'Built parallel multi-agent execution for an internal agentic coding CLI using isolated git worktrees.';
  const dropped = checkCoverage(trimmed, source);
  ok('a dropped claim fails the check', dropped.verdict === 'fail');
  ok('the dropped claim is named in the report', dropped.missing.some(m => /3D asset/i.test(m.claim)));

  const excused = checkCoverage(trimmed, source, { allow: ['3D asset'] });
  ok('an explicitly allowed drop passes', excused.verdict === 'pass');
  ok('an allowed drop is still reported, not hidden', excused.allowed.length === 1);

  // Rewording must not count as a loss — tailoring legitimately rephrases.
  const reworded = 'Built parallel multi-agent execution for an internal agentic coding CLI, running subtasks in isolated git worktrees. '
    + 'Automated 3D asset optimization, compressing GLB model size 64% and cutting load time from 8.2s to 3.4s.';
  ok('rewording a claim still counts as present', checkCoverage(reworded, source).verdict === 'pass');

  // HTML entity/tag stripping.
  ok('html tags and entities are stripped',
    /Sammy's/.test(extractTextFromHtmlString('<div class="job">Sammy&#39;s Nutri Haus</div>')));

  console.log(`\ncv-coverage-check self-test: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

function extractTextFromHtmlString(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'");
}

function printHuman(result, file, source) {
  console.log(`CV coverage: ${file}`);
  console.log(`Source of truth: ${source}`);
  console.log(`Claims in source: ${result.present.length + result.missing.length + result.allowed.length}`);
  console.log(`  present: ${result.present.length}   allowed-absent: ${result.allowed.length}   MISSING: ${result.missing.length}\n`);
  for (const a of result.allowed) {
    console.log(`  [allowed: "${a.allowedBy}"]  ${a.claim.slice(0, 110)}`);
  }
  if (result.missing.length) {
    console.log('Claims in the source CV that did NOT survive tailoring:\n');
    for (const m of result.missing) {
      console.log(`  [${Math.round(m.score * 100)}% of its distinctive words present]`);
      console.log(`  ${m.claim.slice(0, 160)}\n`);
    }
    console.log('Each of these is either a mistake, or a cut you should make on purpose.');
    console.log('If it is deliberate, re-run naming it, e.g.  --allow "3D asset"');
    console.log('Never drop a claim just to reach a page count — see modes/_custom.md.');
  } else {
    console.log('✅ Every claim in the source CV survived tailoring.');
  }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) { runSelfTest(); }
  else if (!args.length || args.includes('--help')) {
    console.log(`Usage: node cv-coverage-check.mjs <tailored.pdf|.html> [--source cv.md] [--allow "text"]... [--threshold 0.6] [--json]

Flags a claim present in the source CV that no longer appears in the tailored one.
Page count, ATS score and keyword coverage all IMPROVE when evidence is cut, so
none of them can catch this; that is why this check exists. Exits 1 on an
unexplained drop.`);
  } else {
    let file = '', source = 'cv.md', threshold = DEFAULT_THRESHOLD, json = false;
    const allow = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--source') source = args[++i];
      else if (a === '--allow') allow.push(args[++i]);
      else if (a === '--threshold') threshold = Number(args[++i]);
      else if (a === '--json') json = true;
      else if (!a.startsWith('--')) file = a;
    }
    if (!file) { console.error('ERROR: no CV file given'); process.exit(2); }
    if (!existsSync(source)) { console.error(`ERROR: source CV not found: ${source}`); process.exit(2); }

    const result = checkCoverage(extractText(file), readFileSync(source, 'utf-8'), { allow, threshold });
    if (json) console.log(JSON.stringify({ file, source, ...result }, null, 2));
    else printHuman(result, file, source);
    process.exit(result.verdict === 'pass' ? 0 : 1);
  }
}
