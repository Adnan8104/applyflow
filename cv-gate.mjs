#!/usr/bin/env node
// cv-gate.mjs — structural and evidence checks every tailored CV must pass
// before generate-pdf.mjs will render it.
//
// Why this exists: across the first two tailored CVs in this fork, the same
// defects came back round after round — evidence cut to reach one page, the
// current role listed below older ones, project bullets flattened into a
// paragraph, a "tailored" CV that was 92% a copy of the previous one — and
// every metric the pipeline did check (page count, ATS score, keyword %)
// improved while the document got worse. The rules that would have caught
// them were written down as prose in modes/_custom.md, which an agent has to
// remember to follow. This module turns them into a gate the render cannot
// skip: generate-pdf.mjs calls assertCvGate() before writing any PDF.
//
// Checks (all block, except report-link which warns):
//   evidence     every claim bullet in cv.md survives, unless allowed
//   chronology   experience entries are reverse-chronological by start date
//   structure    a multi-bullet cv.md entry still renders as bullets
//   weak-starts  no bullet opens with helped/assisted/responsible for/...
//   sibling      not a near-copy of another tailored CV in output/
//   report-link  a CV for a tracked company is rendered with --report=N
//
// Standing exceptions live in config/cv-gate.json (user layer), e.g.
//   { "allow_missing": ["3D asset"], "sibling_threshold": 0.85 }
//
// Usage:
//   node cv-gate.mjs <cv.html> [--allow "text"]... [--report N] [--json]
//   node cv-gate.mjs --self-test

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve, basename } from 'path';
import { checkCoverage } from './cv-coverage-check.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';

// User-layer files (cv.md, config/, output/, the tracker) resolve through the
// data root, which CAREER_OPS_ROOT or a .career-ops-data marker can relocate.
const DATA_ROOT = getCareerOpsRoot();
const DEFAULT_SIBLING_THRESHOLD = 0.85;
const WEAK_START_RE = /^(?:helped|assisted|responsible for|worked on|participated in)\b/i;

// ── text helpers ─────────────────────────────────────────────────────────

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** Visible text of an HTML fragment: tags stripped, entities and bold markers removed. */
export function textOf(fragment) {
  return decodeEntities(String(fragment).replace(/<[^>]+>/g, ' '))
    .replace(/\*\*/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normKey(s) {
  return textOf(s).toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim();
}

function stripNonContent(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ');
}

/**
 * Every `<div class="…name…">` block in document order, with balanced-div
 * matching so nested divs (job-header, job-subheader) stay inside their block.
 */
export function divBlocks(html, className) {
  const src = stripNonContent(html);
  const openRe = new RegExp(`<div\\b[^>]*class\\s*=\\s*["'](?:[^"']*\\s)?${className}(?:\\s[^"']*)?["'][^>]*>`, 'gi');
  const blocks = [];
  let m;
  while ((m = openRe.exec(src))) {
    let depth = 1;
    const tagRe = /<div\b[^>]*>|<\/div\s*>/gi;
    tagRe.lastIndex = m.index + m[0].length;
    let t;
    while ((t = tagRe.exec(src))) {
      depth += t[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        blocks.push(src.slice(m.index, t.index + t[0].length));
        break;
      }
    }
  }
  return blocks;
}

function classText(block, className) {
  const re = new RegExp(`<(\\w+)\\b[^>]*class\\s*=\\s*["'](?:[^"']*\\s)?${className}(?:\\s[^"']*)?["'][^>]*>([\\s\\S]*?)</\\1>`, 'i');
  const m = re.exec(block);
  return m ? textOf(m[2]) : '';
}

function listItems(block) {
  return [...block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m => textOf(m[1]));
}

/** Parsed `.job` and `.project` blocks, in rendered order. */
export function renderedEntries(html) {
  const jobs = divBlocks(html, 'job').map(b => ({
    kind: 'job',
    name: classText(b, 'job-company'),
    period: classText(b, 'job-period'),
    bullets: listItems(b),
    paragraph: '',
  }));
  const projects = divBlocks(html, 'project').map(b => ({
    kind: 'project',
    name: classText(b, 'project-title'),
    period: '',
    bullets: listItems(b),
    paragraph: classText(b, 'project-desc'),
  }));
  return { jobs, projects };
}

// ── cv.md parsing ────────────────────────────────────────────────────────

/** `### ` entries under Experience-like and Projects sections of cv.md, with bullet counts. */
export function sourceEntries(cvMarkdown) {
  const entries = [];
  let section = '';
  let cur = null;
  for (const line of String(cvMarkdown).split('\n')) {
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2 && !line.startsWith('###')) { section = h2[1].trim(); cur = null; continue; }
    const h3 = /^###\s+(.*)$/.exec(line);
    if (h3) {
      if (!/experience|projects/i.test(section)) { cur = null; continue; }
      cur = { section, heading: h3[1].trim(), subline: '', bullets: 0 };
      entries.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^\s*[-*]\s+/.test(line)) cur.bullets++;
    else if (line.trim() && !cur.subline) cur.subline = line.trim();
  }
  return entries;
}

function candidateName(cvMarkdown) {
  const m = /^#\s+(?:CV\s*[-—–:]+\s*)?(.+)$/m.exec(String(cvMarkdown));
  return m ? m[1].trim() : '';
}

// ── dates ────────────────────────────────────────────────────────────────

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const SEASONS = { spring: 3, summer: 6, fall: 9, autumn: 9, winter: 12 };

/**
 * Start of a period string as a sortable month index (year*12 + month), or
 * null when it can't be read. Handles "May 2026 - Aug. 2026",
 * "Fall 2026 - Present", "June 2024 – Aug. 2024", "2021 - 2023".
 */
export function parseStart(period) {
  const start = String(period).split(/\s+[-–—]\s+|\s+to\s+/i)[0].trim();
  const year = /\b(19|20)\d{2}\b/.exec(start);
  if (!year) return null;
  const word = /\b([A-Za-z]+)\.?\s+(?:19|20)\d{2}\b/.exec(start);
  let month = 1;
  if (word) {
    const w = word[1].toLowerCase();
    month = SEASONS[w] ?? MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)] ?? 1;
  }
  return Number(year[0]) * 12 + month;
}

// ── checks ───────────────────────────────────────────────────────────────

export function checkEvidence(html, cvMarkdown, { allow = [] } = {}) {
  const result = checkCoverage(textOf(stripNonContent(html)), cvMarkdown, { allow });
  if (result.verdict === 'pass') {
    const note = result.allowed.length ? ` (${result.allowed.length} deliberate cut${result.allowed.length > 1 ? 's' : ''} allowed)` : '';
    return { id: 'evidence', ok: true, message: `every cv.md claim present${note}` };
  }
  const lines = result.missing.map(m => `    - ${m.claim.slice(0, 110)}`);
  return {
    id: 'evidence',
    ok: false,
    message: `${result.missing.length} cv.md claim(s) missing from the CV:\n${lines.join('\n')}\n    If a cut is deliberate, allow it: --allow="<text>" or config/cv-gate.json allow_missing.`,
  };
}

export function checkChronology(html) {
  const { jobs } = renderedEntries(html);
  const dated = jobs.map(j => ({ ...j, start: parseStart(j.period) })).filter(j => j.start !== null);
  for (let i = 1; i < dated.length; i++) {
    if (dated[i].start > dated[i - 1].start) {
      const order = dated.map(j => `${j.name} (${j.period})`).join(' → ');
      return {
        id: 'chronology',
        ok: false,
        message: `experience is not reverse-chronological — "${dated[i].name}" (${dated[i].period}) started after "${dated[i - 1].name}" (${dated[i - 1].period}) but is listed below it.\n    Rendered: ${order}`,
      };
    }
  }
  return { id: 'chronology', ok: true, message: `${dated.length} entries in reverse-chronological order` };
}

export function checkStructure(html, cvMarkdown) {
  const { jobs, projects } = renderedEntries(html);
  const rendered = [...jobs, ...projects].filter(e => e.name);
  const problems = [];
  for (const src of sourceEntries(cvMarkdown)) {
    if (src.bullets < 2) continue;
    const haystack = normKey(`${src.heading} ${src.subline}`);
    const match = rendered.find(r => {
      const k = normKey(r.name);
      return k.length >= 3 && haystack.includes(k);
    });
    if (!match) continue;
    const need = Math.max(2, Math.ceil(src.bullets / 2));
    const paraWords = match.paragraph ? match.paragraph.split(/\s+/).length : 0;
    if (match.bullets.length < need || paraWords >= 35) {
      const shape = paraWords ? `a ${paraWords}-word paragraph` : `${match.bullets.length} bullet(s)`;
      problems.push(`    - "${match.name}": ${src.bullets} bullets in cv.md, rendered as ${shape} (need at least ${need} bullets)`);
    }
  }
  return problems.length
    ? { id: 'structure', ok: false, message: `bullets flattened or collapsed:\n${problems.join('\n')}` }
    : { id: 'structure', ok: true, message: 'multi-bullet entries still render as bullets' };
}

export function checkWeakStarts(html) {
  const { jobs, projects } = renderedEntries(html);
  const weak = [...jobs, ...projects].flatMap(e => e.bullets.filter(b => WEAK_START_RE.test(b)).map(b => `    - ${b.slice(0, 100)}`));
  return weak.length
    ? { id: 'weak-starts', ok: false, message: `bullet(s) open with a weak verb (modes/heuristics/recruiter-side.md):\n${weak.join('\n')}` }
    : { id: 'weak-starts', ok: true, message: 'no weak bullet openers' };
}

/** Comparable content units: list items, summary, education line, skill lines. */
export function contentUnits(html) {
  const src = stripNonContent(html);
  const units = [
    ...[...src.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m => textOf(m[1])),
    ...[...src.matchAll(/<div\b[^>]*class\s*=\s*["'](?:summary-text|edu-desc|skill-item|project-desc)["'][^>]*>([\s\S]*?)<\/div>/gi)].map(m => textOf(m[1])),
  ];
  // Compared on words only. generate-pdf.mjs gates the ATS-normalized HTML
  // (em-dashes, smart quotes, bold markers rewritten) while sibling files on
  // disk are raw, so a character-exact comparison let a copied CV slip under
  // the threshold purely on punctuation.
  return units
    .map(u => u.toLowerCase().replace(/[^a-z0-9%$+#]+/g, ' ').trim())
    .filter(u => u.split(/\s+/).length >= 4);
}

export function checkSibling(html, { siblings = [], threshold = DEFAULT_SIBLING_THRESHOLD } = {}) {
  const mine = contentUnits(html);
  if (mine.length === 0 || siblings.length === 0) {
    return { id: 'sibling', ok: true, message: 'no other tailored CV to compare against' };
  }
  let worst = { file: '', ratio: 0 };
  for (const sib of siblings) {
    const theirs = new Set(contentUnits(sib.html));
    const shared = mine.filter(u => theirs.has(u)).length;
    const ratio = shared / mine.length;
    if (ratio > worst.ratio) worst = { file: sib.file, ratio };
  }
  const pct = Math.round(worst.ratio * 100);
  return worst.ratio > threshold
    ? {
        id: 'sibling',
        ok: false,
        message: `${pct}% of this CV's content is word-for-word identical to ${worst.file} (limit ${Math.round(threshold * 100)}%). That is a copy, not a tailoring — rework the summary and the bullets this JD actually asks about.`,
      }
    : { id: 'sibling', ok: true, message: `closest sibling ${worst.file} shares ${pct}% (limit ${Math.round(threshold * 100)}%)` };
}

function trackerCompanies(trackerPath) {
  if (!existsSync(trackerPath)) return [];
  const rows = readFileSync(trackerPath, 'utf-8').split('\n').filter(l => l.startsWith('|'));
  if (rows.length < 3) return [];
  const header = rows[0].split('|').map(c => c.trim().toLowerCase());
  const idx = header.indexOf('company');
  if (idx < 0) return [];
  return rows.slice(2).map(r => (r.split('|')[idx] || '').trim()).filter(c => c && c !== '?');
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function checkReportLink({ outputPath = '', reportNum = '', trackerPath = '' } = {}) {
  if (!outputPath || reportNum) return { id: 'report-link', ok: true, message: reportNum ? `linked to report ${reportNum}` : 'no output path given' };
  const file = slug(basename(outputPath));
  const hit = trackerCompanies(trackerPath).find(c => slug(c).length >= 3 && file.includes(slug(c)));
  return hit
    ? { id: 'report-link', ok: true, warn: true, message: `"${hit}" is in the tracker but no --report=N was given — the dashboard won't find this PDF.` }
    : { id: 'report-link', ok: true, message: 'no tracked company in the filename' };
}

// ── config + orchestration ───────────────────────────────────────────────

export function loadGateConfig(root = DATA_ROOT) {
  const p = join(root, 'config', 'cv-gate.json');
  const base = { allow_missing: [], sibling_threshold: DEFAULT_SIBLING_THRESHOLD };
  if (!existsSync(p)) return base;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    return {
      allow_missing: Array.isArray(raw.allow_missing) ? raw.allow_missing.map(String) : [],
      sibling_threshold: typeof raw.sibling_threshold === 'number' ? raw.sibling_threshold : DEFAULT_SIBLING_THRESHOLD,
    };
  } catch (err) {
    throw new Error(`config/cv-gate.json is not valid JSON: ${err.message}`);
  }
}

/** Other tailored CV HTML files in output/ (never the one being checked, never _scratch files). */
export function loadSiblings(outputDir, selfPath = '') {
  if (!existsSync(outputDir)) return [];
  const self = selfPath ? resolve(selfPath) : '';
  return readdirSync(outputDir)
    .filter(f => /^cv-.*\.html$/i.test(f))
    .map(f => join(outputDir, f))
    .filter(f => resolve(f) !== self)
    .map(f => ({ file: basename(f), html: readFileSync(f, 'utf-8') }));
}

/**
 * Run every check. Returns { skipped, results, failures, warnings }.
 * Skips (without failing) when the CV isn't for the candidate in cv.md — the
 * evidence and structure checks only mean something for the same person.
 */
export function runCvGate(html, opts = {}) {
  const { cvMarkdown = '', allow = [], siblings = [], threshold, outputPath, reportNum, trackerPath } = opts;
  const name = candidateName(cvMarkdown);
  if (!cvMarkdown || (name && !textOf(html).toLowerCase().includes(name.toLowerCase()))) {
    return { skipped: true, reason: name ? `CV is not for ${name}` : 'no cv.md', results: [], failures: [], warnings: [] };
  }
  const results = [
    checkEvidence(html, cvMarkdown, { allow }),
    checkChronology(html),
    checkStructure(html, cvMarkdown),
    checkWeakStarts(html),
    checkSibling(html, { siblings, threshold }),
    checkReportLink({ outputPath, reportNum, trackerPath }),
  ];
  return {
    skipped: false,
    results,
    failures: results.filter(r => !r.ok),
    warnings: results.filter(r => r.ok && r.warn),
  };
}

function formatResults(gate) {
  return gate.results.map(r => `${r.ok ? (r.warn ? '⚠️ ' : '✅') : '❌'} cv-gate ${r.id}: ${r.message}`).join('\n');
}

/**
 * The generate-pdf.mjs entry point. Throws when any blocking check fails, so
 * no PDF is written. `skip` downgrades failures to loud warnings.
 */
export function assertCvGate(html, { root = DATA_ROOT, inputPath = '', skip = false, extraAllow = [], ...rest } = {}) {
  const config = loadGateConfig(root);
  const gate = runCvGate(html, {
    ...rest,
    allow: [...config.allow_missing, ...extraAllow],
    threshold: config.sibling_threshold,
    siblings: rest.siblings ?? loadSiblings(join(root, 'output'), inputPath),
    trackerPath: rest.trackerPath ?? resolveTrackerPath(root),
  });
  if (gate.skipped) {
    console.log(`ℹ️  cv-gate skipped: ${gate.reason}`);
    return gate;
  }
  const report = formatResults(gate);
  if (gate.failures.length && skip) {
    console.warn(report);
    console.warn(`⚠️  cv-gate: ${gate.failures.length} check(s) FAILED but --skip-cv-gate was set — rendering anyway.`);
    return gate;
  }
  if (gate.failures.length) {
    throw new Error(`CV gate failed (${gate.failures.length} check${gate.failures.length > 1 ? 's' : ''}) — no PDF written.\n${report}`);
  }
  console.log(report);
  return gate;
}

// ── self-test ────────────────────────────────────────────────────────────

function runSelfTest() {
  let pass = 0, fail = 0;
  const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log(`  FAIL: ${label}`); } };

  // dates — every shape in the real cv.md
  ok('month + year', parseStart('May 2026 - Aug. 2026') === 2026 * 12 + 5);
  ok('abbrev with period', parseStart('Aug. 2023 - May 2027') === 2023 * 12 + 8);
  ok('full month', parseStart('June 2025 - Aug. 2025') === 2025 * 12 + 6);
  ok('season + Present', parseStart('Fall 2026 - Present') === 2026 * 12 + 9);
  ok('en dash', parseStart('June 2024 – Aug. 2024') === 2024 * 12 + 6);
  ok('year only', parseStart('2021 - 2023') === 2021 * 12 + 1);
  ok('unreadable → null', parseStart('Ongoing') === null);

  const cv = [
    '# CV -- Jane Doe',
    '## Experience',
    '### Engineer Intern May 2026 - Aug. 2026',
    'Acme Corp Mumbai',
    '- Built the orchestration layer for a distributed agent platform using worktrees.',
    '- Designed deterministic phase gating that agents could not route around at all.',
    '## Research Experience',
    '### Researcher Fall 2026 - Present',
    'Advised by Dr. X | State University',
    '- Designing an IRB-approved study benchmarking model judgment against engineers.',
    '## Projects',
    '### Lasso | Swift May 2026',
    '- Built and open-sourced a native macOS menu-bar focus redirection application.',
    '- Diagnosed four silent failure modes including disabled event taps in production.',
    '- Implemented focus routing across Spaces, displays and fullscreen windows reliably.',
  ].join('\n');

  const job = (co, period, lis) => `<div class="job"><div class="job-header"><span class="job-company">${co}</span><span class="job-period">${period}</span></div><ul>${lis.map(l => `<li>${l}</li>`).join('')}</ul></div>`;
  const acme = job('Acme Corp', 'May 2026 - Aug. 2026', [
    'Built the orchestration layer for a distributed agent platform using worktrees.',
    'Designed deterministic phase gating that agents could not route around at all.',
  ]);
  const uni = job('State University', 'Fall 2026 - Present', ['Designing an IRB-approved study benchmarking model judgment against engineers.']);
  const lassoBullets = '<div class="project"><div class="project-title">Lasso</div><ul><li>Built and open-sourced a native macOS menu-bar focus redirection application.</li><li>Diagnosed four silent failure modes including disabled event taps in production.</li><li>Implemented focus routing across Spaces, displays and fullscreen windows reliably.</li></ul></div>';
  const lassoPara = '<div class="project"><div class="project-title">Lasso</div><div class="project-desc">Built and open-sourced a native macOS menu-bar focus redirection application. Diagnosed four silent failure modes including disabled event taps in production. Implemented focus routing across Spaces, displays and fullscreen windows reliably.</div></div>';
  const doc = body => `<html><body><h1>Jane Doe</h1><!-- <div class="job"> in a comment is ignored -->${body}</body></html>`;

  const good = doc(uni + acme + lassoBullets);
  const g = runCvGate(good, { cvMarkdown: cv });
  ok('a correct CV passes every check', !g.skipped && g.failures.length === 0);

  ok('wrong candidate is skipped, not failed', runCvGate(good.replace('Jane Doe', 'John Roe'), { cvMarkdown: cv }).skipped);

  ok('current role listed below an older one fails chronology', !checkChronology(doc(acme + uni + lassoBullets)).ok);
  ok('comment text is not parsed as a job', renderedEntries(good).jobs.length === 2);

  ok('dropped claim fails evidence', !checkEvidence(doc(acme + lassoBullets), cv).ok);
  ok('allowed drop passes evidence', checkEvidence(doc(acme + lassoBullets), cv, { allow: ['IRB-approved'] }).ok);

  const flat = checkStructure(doc(uni + acme + lassoPara), cv);
  ok('project flattened into a paragraph fails structure', !flat.ok && /Lasso/.test(flat.message));
  ok('bulleted project passes structure', checkStructure(good, cv).ok);

  ok('weak opener fails', !checkWeakStarts(doc(job('Acme Corp', 'May 2026', ['Helped the team ship a platform migration end to end.']))).ok);
  ok('strong opener passes', checkWeakStarts(good).ok);

  const copy = checkSibling(good, { siblings: [{ file: 'cv-other.html', html: good }] });
  ok('identical sibling fails', !copy.ok && /100%/.test(copy.message));
  const different = doc(uni + job('Acme Corp', 'May 2026 - Aug. 2026', ['Rebuilt the evaluation layer scoring agent output with majority voting.', 'Shipped a memory layer with step checkpointing and crash resume.']) + lassoBullets);
  ok('genuinely retailored sibling passes', checkSibling(different, { siblings: [{ file: 'cv-other.html', html: good }] }).ok);
  const punctuated = good.replace(/around at all/g, 'around — at all').replace(/worktrees\./g, '**worktrees**.');
  ok('punctuation/bold normalization does not hide a copy', !checkSibling(punctuated, { siblings: [{ file: 'cv-other.html', html: good }] }).ok);

  ok('tracked company without --report warns', checkReportLink({ outputPath: 'output/cv-jane-acme-2026.pdf', trackerPath: '/nonexistent' }).ok);

  let threw = false;
  try { assertCvGate(doc(acme + uni + lassoBullets), { cvMarkdown: cv, siblings: [], trackerPath: '/nonexistent', root: '/nonexistent' }); } catch { threw = true; }
  ok('assertCvGate throws on a failed check', threw);

  let skippedThrow = false;
  const origWarn = console.warn; console.warn = () => {};
  try { assertCvGate(doc(acme + uni + lassoBullets), { cvMarkdown: cv, siblings: [], trackerPath: '/nonexistent', root: '/nonexistent', skip: true }); } catch { skippedThrow = true; }
  console.warn = origWarn;
  ok('--skip-cv-gate renders anyway', !skippedThrow);

  console.log(`\ncv-gate self-test: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

// ── CLI ──────────────────────────────────────────────────────────────────

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    runSelfTest();
  } else if (!args.length || args.includes('--help')) {
    console.log('Usage: node cv-gate.mjs <cv.html> [--allow "text"]... [--report N] [--json]\n\nRuns the checks generate-pdf.mjs enforces before rendering. Exit 1 on failure.');
  } else {
    let file = '', reportNum = '', json = false;
    const extraAllow = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--allow') extraAllow.push(args[++i]);
      else if (a.startsWith('--allow=')) extraAllow.push(a.slice(8));
      else if (a === '--report') reportNum = args[++i];
      else if (a.startsWith('--report=')) reportNum = a.slice(9);
      else if (a === '--json') json = true;
      else if (!a.startsWith('--')) file = a;
    }
    const cvPath = join(DATA_ROOT, 'cv.md');
    const cvMarkdown = existsSync(cvPath) ? readFileSync(cvPath, 'utf-8') : '';
    const html = readFileSync(file, 'utf-8');
    try {
      const gate = assertCvGate(html, { cvMarkdown, inputPath: file, extraAllow, reportNum, outputPath: file.replace(/\.html$/, '.pdf') });
      if (json) console.log(JSON.stringify(gate, null, 2));
    } catch (err) {
      if (json) console.log(JSON.stringify({ error: err.message }, null, 2));
      else console.error(err.message);
      process.exitCode = 1;
    }
  }
}
