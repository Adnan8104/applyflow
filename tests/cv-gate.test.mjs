// tests/cv-gate.test.mjs — the CV gate generate-pdf.mjs runs before rendering.
//
// Each case below is a defect that actually shipped in a tailored CV in this
// fork and was caught only by a human reading the output: evidence cut to hit
// one page, the current role listed below older ones, project bullets
// flattened into a paragraph, and a "tailored" CV that was a near-copy of the
// previous one. The gate exists so none of them can render again.
//
// Run:  node test-all.mjs --only cv-gate

import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as gate from '../cv-gate.mjs';

console.log('\nCV gate: blocks the defects that shipped in earlier tailored CVs');

const {
  parseStart, checkEvidence, checkChronology, checkStructure,
  checkWeakStarts, checkSibling, runCvGate, contentUnits,
} = gate;

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
const lasso = '<div class="project"><div class="project-title">Lasso</div><ul><li>Built and open-sourced a native macOS menu-bar focus redirection application.</li><li>Diagnosed four silent failure modes including disabled event taps in production.</li><li>Implemented focus routing across Spaces, displays and fullscreen windows reliably.</li></ul></div>';
const lassoPara = '<div class="project"><div class="project-title">Lasso</div><div class="project-desc">Built and open-sourced a native macOS menu-bar focus redirection application. Diagnosed four silent failure modes including disabled event taps in production. Implemented focus routing across Spaces, displays and fullscreen windows reliably.</div></div>';
const doc = body => `<html><body><h1>Jane Doe</h1>${body}</body></html>`;
const good = doc(uni + acme + lasso);

const check = (label, cond) => (cond ? pass(label) : fail(label));

check('every period shape in the real cv.md parses',
  parseStart('Aug. 2023 - May 2027') === 2023 * 12 + 8
  && parseStart('June 2025 - Aug. 2025') === 2025 * 12 + 6
  && parseStart('Fall 2026 - Present') === 2026 * 12 + 9);

check('a correct CV passes every check', runCvGate(good, { cvMarkdown: cv }).failures.length === 0);
check('a CV for someone else is skipped, not failed',
  runCvGate(good.replace('Jane Doe', 'John Roe'), { cvMarkdown: cv }).skipped === true);

check('evidence: a claim cut to save space blocks', !checkEvidence(doc(acme + lasso), cv).ok);
check('evidence: a deliberate, named cut passes', checkEvidence(doc(acme + lasso), cv, { allow: ['IRB-approved'] }).ok);

check('chronology: the current role below an older one blocks', !checkChronology(doc(acme + uni + lasso)).ok);
check('chronology: reverse-chronological order passes', checkChronology(good).ok);

check('structure: bullets flattened into a paragraph block', !checkStructure(doc(uni + acme + lassoPara), cv).ok);

check('weak-starts: "Helped …" blocks',
  !checkWeakStarts(doc(job('Acme Corp', 'May 2026', ['Helped the team ship a platform migration end to end.']))).ok);

check('sibling: a copy of another tailored CV blocks',
  !checkSibling(good, { siblings: [{ file: 'cv-other.html', html: good }] }).ok);
check('sibling: comparison ignores punctuation/bold rewrites from ATS normalization',
  contentUnits('<li>Built it — **fast** and well.</li>')[0] === contentUnits('<li>Built it - fast and well.</li>')[0]);

// The gate is only worth anything if the render path calls it. Asserted at
// source level: exercising it end to end would mean launching Chromium.
const gen = readFileSync(join(ROOT, 'generate-pdf.mjs'), 'utf-8');
const calls = (gen.match(/await import\('\.\/cv-gate\.mjs'\)/g) || []).length;
check('generate-pdf.mjs calls the gate on both the single and batch paths', calls >= 2);
check('the gate import is lazy (sandboxed generate-pdf suites copy that file alone)',
  !/^import[^\n]*cv-gate\.mjs/m.test(gen));
