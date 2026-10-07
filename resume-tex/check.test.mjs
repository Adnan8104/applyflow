import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkTex } from './check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = fs.readFileSync(path.join(ROOT, 'resume.tex'), 'utf8');
const LIBRARY = fs.readFileSync(path.join(ROOT, 'data/resume-variants.md'), 'utf8');

function fixture(t, edit, { compile = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-tex-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'resume.tex'), MASTER);
  fs.writeFileSync(path.join(root, 'data/resume-variants.md'), LIBRARY);
  const file = path.join(root, 'tailored.tex');
  const once = (s, a, b) => { assert.equal(s.split(a).length, 2, `fixture anchor not unique: ${a.slice(0, 50)}`); return s.replace(a, b); };
  fs.writeFileSync(file, edit((a, b, s = MASTER) => once(s, a, b)));
  return checkTex(file, { root, compile });
}
const has = (problems, rx) => assert.ok(problems.some(p => rx.test(p)), `expected ${rx} in:\n${problems.join('\n')}`);

test('unchanged master copy passes, including compile and one page', t => {
  assert.deepEqual(fixture(t, () => MASTER, { compile: true }), []);
});

test('"custom processors" is banned and no longer approved', t => {
  const p = fixture(t, r => r('with NiFi processors (ExecuteSQL', 'with custom processors (ExecuteSQL'));
  has(p, /Banned phrase: "custom processors"/);
  has(p, /not in approved library/);
});

test('TypeScript added to the MarketLens heading is caught', t => {
  has(fixture(t, r => r('\\emph{Next.js, React, Recharts, OpenAI API}', '\\emph{Next.js, React, TypeScript, Recharts, OpenAI API}')), /Heading differs.*MarketLens/);
});

test('a changed metric (47 MB to 45 MB) is caught', t => {
  has(fixture(t, r => r('(47 MB to 17 MB)', '(45 MB to 17 MB)')), /not in approved library/);
});

test('a reworded bullet is caught', t => {
  has(fixture(t, r => r('Built and open-sourced a native macOS menu-bar app', 'Developed and open-sourced a native macOS menu-bar app')), /not in approved library/);
});

test('pending wording is refused until approved', t => {
  has(fixture(t, r => r('prediction-market analysis tool that', 'prediction-market analysis web app that')), /PENDING wording \[ML-APP\]/);
});

test('approved alternate passes; using it with the original of the same fact fails', t => {
  const alt = 'Enforced approval gates in deterministic Python rather than through the model, preventing agents from bypassing their own review step; integrated six LLM providers behind a single interface.';
  const gating = MASTER.match(/\\resumeItem\{Designed phase gating[^\n]*\}/)[0];
  assert.deepEqual(fixture(t, r => r(gating, `\\resumeItem{${alt}}`)), []);
  has(fixture(t, r => r(gating, `${gating}\n        \\resumeItem{${alt}}`)), /same fact \[M-GATING\]/);
});

test('a merged bullet cannot be combined with the fact it already covers', t => {
  const merged = 'Produced 30+ data tables and briefing decks (Python, SQL), including materials presented in House of Representatives budget reviews, and contributed research and editing to the National AI Roadmap White Paper and AI Ethics Guidelines (39 agencies).';
  const tables = MASTER.match(/\\resumeItem\{Synthesized findings[^\n]*\}/)[0];
  has(fixture(t, r => r(tables, `\\resumeItem{${merged}}`)), /same fact \[I-PUBS\]/);
});

test('banned dates, skills outside the allowlist and layout edits are caught', t => {
  has(fixture(t, r => r('{Sept. 2026 -- Present}', '{Fall 2026 -- Present}')), /Banned phrase: "Fall 2026"/);
  has(fixture(t, r => r('Python, Java, C++, JavaScript/TypeScript, Swift, SQL', 'Python, Java, C++, JavaScript/TypeScript, Swift, SQL, GraphQL')), /Skill not in allowlist.*GraphQL/);
  has(fixture(t, r => r('\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{', '\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-1pt}\\vspace{')), /Layout changed/);
});

test('a two-page render fails', t => {
  has(fixture(t, r => r('\\section{Technical Skills}', '\\newpage\n\\section{Technical Skills}'), { compile: true }), /must be exactly 1/);
});

test('hook mode ignores non-.tex files and reports problems with exit code 2', t => {
  const run = input => { try { execFileSync('node', [path.join(ROOT, 'resume-tex/check.mjs'), '--hook'], { input: JSON.stringify(input), stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  assert.equal(run({ tool_input: { file_path: path.join(ROOT, 'cv.md') } }), 0);
  const dir = fs.mkdtempSync(path.join(ROOT, 'output/_hook-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bad = path.join(dir, 'bad.tex');
  fs.writeFileSync(bad, MASTER.replace('with NiFi processors', 'with custom processors'));
  assert.equal(run({ tool_input: { file_path: bad } }), 2);
});
