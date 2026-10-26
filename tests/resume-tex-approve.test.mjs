import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { approveTex } from '../resume-tex/approve.mjs';
import { requireApproval, uploadName } from '../lib/resume-pipeline/approval.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests/fixtures/resume-tex');
const MASTER = fs.readFileSync(path.join(FIXTURES, 'resume.tex'), 'utf8');
const LIBRARY = fs.readFileSync(path.join(FIXTURES, 'resume-variants.md'), 'utf8');
const URL = 'https://jobs.ashbyhq.com/acme/req1';

// A workspace with the fictional master/library, a tailored copy and a fake compiler.
function workspace(t, tailored = MASTER) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resume-tex-approve-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [f, body] of [['resume.tex', MASTER], ['data/resume-variants.md', LIBRARY], ['output/acme/resume.tex', tailored],
    ['config/job-policy.yml', yaml.dump({ referral_protection: { hard_block: [{ family: 'Protected', names: ['Protected Co'], domains: ['protected.example'] }], review: [], allow: [] } })]]) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), body);
  }
  let builds = 0;
  const compile = tex => { builds++; fs.writeFileSync(tex.replace(/\.tex$/, '.pdf'), `%PDF-fake-${builds}-${fs.readFileSync(tex, 'utf8').length}`); };
  const approve = (extra = {}) => approveTex({ url: URL, company: 'Acme', role: 'Engineer', pdf: 'output/acme/resume.pdf', root, checkCompile: false, compile, ...extra });
  return { root, approve, builds: () => builds };
}

test('a checked LaTeX resume is approved for one job and the apply flow can load it', async t => {
  const w = workspace(t);
  const out = await w.approve();
  assert.equal(w.builds(), 1);
  const got = requireApproval(w.root, URL);
  assert.equal(got.record.kind, 'latex');
  assert.equal(got.upload.mimeType, 'application/pdf');
  assert.equal(got.upload.name, 'Resume.pdf'); // no profile in this workspace
  assert.equal(got.record.pdf_sha256, out.sha256);
  assert.throws(() => requireApproval(w.root, 'https://jobs.ashbyhq.com/acme/req2'), /approve it for this exact job/);
});

test('a resume that fails the checker is never approved', async t => {
  const w = workspace(t, MASTER.replace('with NiFi processors', 'with custom processors'));
  await assert.rejects(w.approve(), /Resume check failed; nothing approved/);
  assert.equal(w.builds(), 0);
  assert.throws(() => requireApproval(w.root, URL), /approve it for this exact job/);
});

test('changing the PDF, the source or the library voids the approval', async t => {
  const w = workspace(t);
  await w.approve();
  const rec = requireApproval(w.root, URL).record;
  const pdf = path.join(w.root, rec.pdf);
  fs.writeFileSync(pdf, '%PDF-tampered');
  assert.throws(() => requireApproval(w.root, URL), /PDF bytes changed/);
  await w.approve();
  fs.appendFileSync(path.join(w.root, 'output/acme/resume.tex'), '\n% edit\n');
  assert.throws(() => requireApproval(w.root, URL), /resume source changed/);
  fs.writeFileSync(path.join(w.root, 'output/acme/resume.tex'), MASTER);
  await w.approve();
  fs.appendFileSync(path.join(w.root, 'data/resume-variants.md'), '\n');
  assert.throws(() => requireApproval(w.root, URL), /library changed/);
});

test('referral-protected companies and missing details are refused', async t => {
  const w = workspace(t);
  await assert.rejects(w.approve({ company: 'Protected Co' }), /Referral protection/);
  await assert.rejects(w.approve({ role: '' }), /Company and role required/);
  await assert.rejects(w.approve({ url: 'http://insecure.example/job' }), /HTTPS/);
});

test('uploads are named after the candidate, never an internal hash', t => {
  const w = workspace(t);
  fs.writeFileSync(path.join(w.root, 'config/profile.yml'), yaml.dump({ candidate: { full_name: "  Jane  O'Brien-Smith <script>/../x " } }));
  assert.equal(uploadName(w.root), "Jane O'Brien-Smith script..x.pdf");
  fs.writeFileSync(path.join(w.root, 'config/profile.yml'), yaml.dump({ candidate: { full_name: 'José Núñez' } }));
  assert.equal(uploadName(w.root), 'José Núñez.pdf');
  fs.writeFileSync(path.join(w.root, 'config/profile.yml'), yaml.dump({ candidate: {} }));
  assert.equal(uploadName(w.root), 'Resume.pdf');
});

test('an embedded Greenhouse form resolves to the posting approval for the same job ID only', async t => {
  const w = workspace(t);
  const posting = 'https://careers.example.com/job/1?gh_jid=7992556';
  await w.approve({ url: posting });
  const a = requireApproval(w.root, posting);
  const b = requireApproval(w.root, 'https://job-boards.greenhouse.io/embed/job_app?for=example&token=7992556&b=https%3A%2F%2Fcareers.example.com');
  assert.equal(b.record.pdf_sha256, a.record.pdf_sha256);
  assert.equal(requireApproval(w.root, 'https://job-boards.greenhouse.io/example/jobs/7992556').record.pdf_sha256, a.record.pdf_sha256);
  assert.throws(() => requireApproval(w.root, 'https://job-boards.greenhouse.io/embed/job_app?for=example&token=7992557'), /approve it for this exact job/);
  assert.throws(() => requireApproval(w.root, 'https://evil.example.com/apply?gh_jid=7992556'), /approve it for this exact job/);
  assert.throws(() => requireApproval(w.root, 'https://greenhouse.io.evil.example/embed/job_app?token=7992556'), /approve it for this exact job/);
});

test('a job already marked applied in the tracker is refused unless re-applying is explicit', async t => {
  const w = workspace(t);
  fs.writeFileSync(path.join(w.root, 'data/applications.md'), [
    '| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes | URL |',
    '|---|------|---------|-----|------|-------|--------|-----|--------|-------|-----|',
    '| 1 | 2026-10-01 | Acme | — | Engineer | N/A | Applied | ✅ | — | via another session | https://jobs.ashbyhq.com/acme/req1?utm_source=board |',
    '| 2 | 2026-10-01 | Other | — | Analyst | N/A | Evaluated | ✅ | — | not applied | https://jobs.ashbyhq.com/other/req9 |',
  ].join('\n'));
  await assert.rejects(w.approve(), /Already applied to this job[\s\S]*#1 Acme/);
  await assert.rejects(w.approve({ url: 'https://jobs.ashbyhq.com/acme/req2', role: 'Engineer' }), /Already applied/); // same company + role
  await w.approve({ url: 'https://jobs.ashbyhq.com/other/req9', company: 'Other', role: 'Analyst' }); // evaluated, not applied
  const ok = await w.approve({ allowReapply: true });
  assert.equal(ok.status, 'approved');
});
