import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkTex } from '../resume-tex/check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests/fixtures/resume-tex');
const MASTER = fs.readFileSync(path.join(FIXTURES, 'resume.tex'), 'utf8');
const LIBRARY = fs.readFileSync(path.join(FIXTURES, 'resume-variants.md'), 'utf8');
const HAS_TECTONIC = (() => { try { execFileSync('tectonic', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

// Builds a throwaway workspace whose resume.tex master and library are the fictional fixtures.
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-tex-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'resume.tex'), MASTER);
  fs.writeFileSync(path.join(root, 'data/resume-variants.md'), LIBRARY);
  return root;
}
function fixture(t, edit, { compile = false } = {}) {
  const root = workspace(t);
  const file = path.join(root, 'tailored.tex');
  const once = (a, b) => { assert.equal(MASTER.split(a).length, 2, `fixture anchor not unique: ${a.slice(0, 50)}`); return MASTER.replace(a, b); };
  fs.writeFileSync(file, edit(once));
  return checkTex(file, { root, compile });
}
const has = (problems, rx) => assert.ok(problems.some(p => rx.test(p)), `expected ${rx} in:\n${problems.join('\n')}`);

test('unchanged master copy passes', t => {
  assert.deepEqual(fixture(t, () => MASTER), []);
});

test('"custom processors" is banned and not approved', t => {
  const p = fixture(t, r => r('with NiFi processors (ExecuteSQL', 'with custom processors (ExecuteSQL'));
  has(p, /Banned phrase: "custom processors"/);
  has(p, /not in approved library/);
});

test('a technology added to a project heading is caught', t => {
  has(fixture(t, r => r('\\emph{Next.js, React, Recharts}', '\\emph{Next.js, React, TypeScript, Recharts}')), /Heading differs.*Dashboard/);
});

test('headings from an alternate master are accepted; headings from no master are not', t => {
  const root = workspace(t);
  const alt = MASTER.replace('{\\textbf{Dashboard} $|$ \\emph{Next.js, React, Recharts}}{Jan 2026}', '{\\textbf{Benchmark} $|$ \\emph{Python}}{Oct 2026}');
  fs.writeFileSync(path.join(root, 'resume-alt.tex'), alt);
  const file = path.join(root, 'tailored.tex');
  fs.writeFileSync(file, alt);
  assert.deepEqual(checkTex(file, { root }), []);
  fs.writeFileSync(file, alt.replace('{\\textbf{Benchmark} $|$ \\emph{Python}}{Oct 2026}', '{\\textbf{Benchmark} $|$ \\emph{Python, CUDA}}{Oct 2026}'));
  has(checkTex(file, { root }), /Heading differs from the masters/);
});

test('a changed metric (47 MB to 45 MB) is caught', t => {
  has(fixture(t, r => r('(47 MB to 17 MB)', '(45 MB to 17 MB)')), /not in approved library/);
});

test('a reworded bullet is caught', t => {
  has(fixture(t, r => r('Built a full-stack market analysis tool', 'Developed a full-stack market analysis tool')), /not in approved library/);
});

test('pending wording is refused until approved', t => {
  has(fixture(t, r => r('Compressed 3D assets to cut model size', 'Built a 3D asset pipeline that cut model size')), /PENDING wording \[A-3D\]/);
});

test('approved alternate passes; using it with the original of the same fact fails', t => {
  const orig = 'Designed phase gating in deterministic Python; integrated six LLM providers behind one interface.';
  const alt = 'Enforced approval gates in deterministic Python; integrated six LLM providers behind a single interface.';
  assert.deepEqual(fixture(t, r => r(orig, alt)), []);
  has(fixture(t, r => r(`\\resumeItem{${orig}}`, `\\resumeItem{${orig}}\n        \\resumeItem{${alt}}`)), /same fact \[A-GATING\]/);
});

test('a merged bullet cannot be combined with the fact it already covers', t => {
  has(fixture(t, r => r('Synthesized findings into 30+ data tables for budget reviews.', 'Produced 30+ data tables for budget reviews and contributed editing to two published reports.')), /same fact \[R-REPORTS\]/);
});

test('banned dates, skills outside the allowlist and layout edits are caught', t => {
  has(fixture(t, r => r('{Sept. 2026 -- Present}', '{Fall 2026 -- Present}')), /Banned phrase: "Fall 2026"/);
  has(fixture(t, r => r('Python, SQL, JavaScript/TypeScript}', 'Python, SQL, JavaScript/TypeScript, GraphQL}')), /Skill not in allowlist.*GraphQL/);
  has(fixture(t, r => r('\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{', '\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-1pt}\\vspace{')), /Layout changed/);
});

test('master compiles to one page and a two-page render fails', { skip: !HAS_TECTONIC && 'tectonic not installed' }, t => {
  assert.deepEqual(fixture(t, () => MASTER, { compile: true }), []);
  has(fixture(t, r => r('\\section{Technical Skills}', '\\newpage\n\\section{Technical Skills}'), { compile: true }), /must be exactly 1/);
});

test('hook mode ignores non-.tex files and reports problems with exit code 2', t => {
  const run = input => { try { execFileSync('node', [path.join(ROOT, 'resume-tex/check.mjs'), '--hook'], { input: JSON.stringify(input), stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  assert.equal(run({ tool_input: { file_path: path.join(ROOT, 'README.md') } }), 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-tex-hook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bad = path.join(dir, 'bad.tex');
  fs.writeFileSync(bad, '\\documentclass{article}\n\\begin{document}\nThis uses custom processors.\n\\end{document}\n');
  assert.equal(run({ tool_input: { file_path: bad } }), 2);
});
