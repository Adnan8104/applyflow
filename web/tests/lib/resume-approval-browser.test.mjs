import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as yaml from 'js-yaml';
import { chromium } from 'playwright-core';
import { extractBank, masterCandidate } from '../../../lib/resume-pipeline/facts.mjs';
import { renderCandidate } from '../../../lib/resume-pipeline/render.mjs';
import { fileHash, hash, writeAtomic, writeJson } from '../../../lib/resume-pipeline/io.mjs';
import { approve, revoke, fingerprint } from '../../../lib/resume-pipeline/approval.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.join(ROOT, 'web/src');
const enabled = process.env.RESUME_BROWSER_TESTS === '1';
let scratch;
const addExtension = href => {
  const file = fileURLToPath(href);
  if (path.extname(file)) return href;
  for (const ext of ['.ts', '.mjs', '.js']) if (fs.existsSync(file + ext)) return pathToFileURL(file + ext).href;
  return href;
};
if (enabled) registerHooks({
  resolve(specifier, context, next) {
    // Use production core with isolated fixture data; never touch the user's approval files.
    if (scratch && specifier === pathToFileURL(path.join(scratch, 'lib/resume-pipeline/approval.mjs')).href) return next(pathToFileURL(path.join(ROOT, 'lib/resume-pipeline/approval.mjs')).href, context);
    if (specifier.startsWith('@/')) return next(addExtension(pathToFileURL(path.join(SRC, specifier.slice(2))).href), context);
    if (/^\.\.?\//.test(specifier) && context.parentURL?.endsWith('.ts')) return next(addExtension(new URL(specifier, context.parentURL).href), context);
    return next(specifier, context);
  },
  load(url, context, next) { return next(url, url.endsWith('.ts') ? { ...context, format: 'module-typescript' } : context); },
});

test('local fake ATS: real PDF gates, no fill before approval, exact upload, no submit, stale/revoked approval stops', { skip: !enabled && 'Set RESUME_BROWSER_TESTS=1 for the local Chromium acceptance test' }, async t => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resume-browser-')));
  const oldRoot = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = scratch;
  t.after(() => { if (oldRoot === undefined) delete process.env.CAREER_OPS_ROOT; else process.env.CAREER_OPS_ROOT = oldRoot; fs.rmSync(scratch, { recursive: true, force: true }); });
  const master = '# CV -- Test Applicant\n**Contact:** test@example.com\n\n## Experience\n### Engineer Jan 2026 - Present\nExample Employer\n- Built a dashboard with React.\n\n## Technical Skills\n- **Frameworks:** React\n';
  const bank = { ...extractBank(master), status: 'approved' };
  writeAtomic(path.join(scratch, 'cv.md'), master);
  writeAtomic(path.join(scratch, 'data/fact_bank.yaml'), yaml.dump(bank));
  writeAtomic(path.join(scratch, 'config/job-policy.yml'), 'referral_protection: {hard_block: [], review: [], allow: []}\n');
  const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config/resume-pipeline.yml'), 'utf8'));
  writeAtomic(path.join(scratch, config.render.template), fs.readFileSync(path.join(ROOT, config.render.template)));
  const application = { id: 'fake-job', company: 'Example Employer', role: 'Engineer', url: 'https://jobs.ashbyhq.com/example/fixture-1', date: '2026-10-01' };
  const app = path.join(scratch, 'data/applications/fake-job'), run = path.join(app, 'runs/test-run');
  const result = await renderCandidate(scratch, path.join(run, 'master'), masterCandidate(bank), bank, config);
  assert.deepEqual(result.gates, { ok: true, errors: [] });
  assert.equal(fs.existsSync(path.join(scratch, 'data/pdf-index.tsv')), false);
  Object.assign(config.render, { approved_template_sha256: fileHash(path.join(scratch, config.render.template)), approved_master_sha256: hash(master), approved_baseline_pdf: path.relative(scratch, result.pdf), approved_baseline_sha256: result.pdf_sha256 });
  writeAtomic(path.join(scratch, 'config/resume-pipeline.yml'), yaml.dump(config));
  writeJson(path.join(app, 'application.json'), application);
  writeJson(path.join(app, 'active-run.json'), { run: 'test-run' });
  writeAtomic(path.join(run, 'inputs/jd.txt'), 'Local test job.');
  writeAtomic(path.join(run, 'packet.md'), 'Local test packet.');
  writeJson(path.join(run, 'manifest.json'), { application, status: 'awaiting_approval', selection: { status: 'awaiting_approval', winner: 'master' }, jd_sha256: hash('Local test job.'), packet_sha256: hash('Local test packet.'), fingerprint: fingerprint(scratch, config), entries: [{ id: 'master', passed: true, pdf: 'master/resume.pdf', pdf_sha256: result.pdf_sha256 }] });

  // This context fulfills EVERY request locally. No employer/network traffic occurs.
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<form><label>Name<input data-co-field="name" name="name"></label><label>Resume<input type="file" data-co-field="resume"></label><label>Cover letter<input type="file" data-co-field="cover"></label><button>Submit application</button></form><script>window.submits=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submits++}</script>' }));
  const page = await context.newPage();
  await page.goto(application.url);
  const { fillSession } = await import('../../src/lib/apply/session.ts');
  const { driveSession } = await import('../../src/lib/apply/drive.ts');
  const fields = [{ id: 'name', label: 'Name', type: 'text' }, { id: 'resume', label: 'Resume', type: 'file' }, { id: 'cover', label: 'Cover letter', type: 'file' }];
  globalThis.__coApplySessions.set('test-session', { id: 'test-session', url: application.url, page, frame: page.mainFrame(), fields, context, createdAt: Date.now() });
  t.after(() => globalThis.__coApplySessions.delete('test-session'));
  await assert.rejects(fillSession('test-session', { name: 'Test Applicant' }, fields), /approve/);
  assert.equal(await page.locator('[name=name]').inputValue(), '');
  assert.equal(await page.locator('[data-co-field=resume]').evaluate(e => e.files.length), 0);
  await assert.rejects(driveSession(page, 'no-cli', 'full', async () => false, () => {}), /approve/);

  const approved = await approve(scratch, application.id, 'test-run', result.pdf_sha256, { acknowledgeWarnings: true });
  const filled = await fillSession('test-session', { name: 'Test Applicant' }, fields);
  assert.equal(filled.steps.filter(s => s.ok).length, 2);
  assert.equal(await page.locator('[name=name]').inputValue(), 'Test Applicant');
  const uploaded = await page.locator('[data-co-field=resume]').evaluate(async e => [...new Uint8Array(await e.files[0].arrayBuffer())]);
  assert.equal(hash(Buffer.from(uploaded)), result.pdf_sha256);
  assert.equal(await page.locator('[data-co-field=cover]').evaluate(e => e.files.length), 0);
  assert.equal(await page.evaluate(() => window.submits), 0);
  assert.equal(fs.existsSync(path.join(app, 'submission.json')), false);

  const bytes = fs.readFileSync(approved.file);
  writeAtomic(approved.file, 'tampered');
  await assert.rejects(fillSession('test-session', { name: 'Should not fill' }, fields), /bytes changed/);
  writeAtomic(approved.file, bytes);
  await page.goto(application.url.replace('fixture-1', 'fixture-2'));
  await assert.rejects(fillSession('test-session', { name: 'Should not fill' }, fields), /approve/);
  await page.goto(application.url);
  await revoke(scratch, application.id);
  await assert.rejects(fillSession('test-session', { name: 'Should not fill' }, fields), /No active/);
  assert.equal(await page.locator('[name=name]').inputValue(), '');
  assert.equal(await page.evaluate(() => window.submits), 0);
});
