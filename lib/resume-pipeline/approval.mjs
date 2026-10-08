import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPipelineLock } from '../../pipeline-lock.mjs';
import { classifyReferralProtection } from '../job-policy.mjs';
import { contained, fileHash, hash, readJson, readYaml, writeJson, writeAtomic, jobUrl, sourcePaths } from './io.mjs';
import { loadBank } from './facts.mjs';
import { updateLog } from './log.mjs';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function fingerprint(root, config) {
  const src = sourcePaths(root);
  const files = [src.master, src.bank, 'config/resume-pipeline.yml', 'config/job-policy.yml', config.render.template, config.render.layout_css, config.render.approved_baseline_pdf].filter(Boolean);
  const code = ['generate-pdf.mjs', 'verify-ats.mjs', 'lib/job-policy.mjs', ...fs.readdirSync(path.join(CODE_ROOT, 'lib/resume-pipeline')).filter(f => /\.(mjs|py)$/.test(f)).map(f => `lib/resume-pipeline/${f}`)];
  return { files: Object.fromEntries(files.map(f => [f, fileHash(contained(root, f))])), code: Object.fromEntries(code.map(f => [f, fileHash(path.join(CODE_ROOT, f))])) };
}
export function verifyFingerprint(root, saved) {
  if (!saved?.files || !saved?.code) throw new Error('Missing source fingerprint');
  for (const [f, value] of Object.entries(saved.files)) if (fileHash(contained(root, f)) !== value) throw new Error(`Approval invalidated by changed input: ${f}`);
  for (const [f, value] of Object.entries(saved.code)) if (fileHash(contained(CODE_ROOT, f)) !== value) throw new Error(`Approval invalidated by changed pipeline: ${f}`);
  loadBank(root);
}
export function checkReferral(root, application) {
  const result = classifyReferralProtection({ company: application.company, url: application.url }, readYaml(contained(root, 'config/job-policy.yml')));
  if (result.status !== 'clear') throw new Error(`Referral protection: ${result.reason}. Use your referral channel, not form filling.`);
}
export function appDir(root, id) {
  if (!/^[a-z0-9][a-z0-9-]{0,160}$/.test(id)) throw new Error('Invalid application ID');
  return contained(root, `data/applications/${id}`);
}
export function runDir(root, id, run) {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(run)) throw new Error('Invalid run ID');
  return contained(root, path.join(appDir(root, id), 'runs', run));
}
const approvalPath = (root, url) => contained(root, `data/applications/approvals/${hash(jobUrl(url))}.json`);

export function applicationState(root, manifest) {
  if (fs.existsSync(path.join(appDir(root, manifest.application.id), 'submission.json'))) return 'submitted';
  const file = approvalPath(root, manifest.application.url);
  if (!fs.existsSync(file)) return manifest.status;
  const record = readJson(file);
  if (record.application.id !== manifest.application.id || record.run !== manifest.run) return manifest.status;
  if (record.status !== 'approved') return record.status;
  try { requireApproval(root, manifest.application.url); return 'approved'; }
  catch { return 'approval_invalidated'; }
}

export async function approve(root, id, run, pdfHash, { acknowledgeWarnings = false, selected, resolveDisagreement = false } = {}) {
  root = fs.realpathSync(root);
  const dir = runDir(root, id, run), manifestFile = path.join(dir, 'manifest.json');
  return withPipelineLock(path.join(appDir(root, id), 'lifecycle'), async () => {
    if (fs.existsSync(path.join(appDir(root, id), 'submission.json'))) throw new Error('Application already recorded as submitted');
    const m = readJson(manifestFile);
    if (readJson(path.join(appDir(root, id), 'active-run.json')).run !== run) throw new Error('A newer preparation invalidated this run');
    if (!['awaiting_approval', 'needs_review'].includes(m.status)) throw new Error('Run is not ready for approval');
    verifyFingerprint(root, m.fingerprint); checkReferral(root, m.application);
    if (fileHash(path.join(dir, 'inputs/jd.txt')) !== m.jd_sha256 || fileHash(path.join(dir, 'packet.md')) !== m.packet_sha256) throw new Error('JD or approval packet changed');
    if (!acknowledgeWarnings) throw new Error('Review PDF, packet, knockout warnings and claims, then explicitly acknowledge warnings');
    const choice = selected || m.selection.winner;
    if (m.selection.status === 'needs_review' && (!resolveDisagreement || !selected)) throw new Error('Resolve reviewer disagreement with an explicit candidate selection');
    if (selected && selected !== m.selection.winner && !resolveDisagreement) throw new Error('Explicitly acknowledge overriding the recommendation');
    const artifact = m.entries.find(e => e.id === choice && e.passed);
    if (!artifact || artifact.pdf_sha256 !== pdfHash) throw new Error('PDF hash must match the reviewed, passing candidate');
    const source = contained(root, path.relative(root, path.resolve(dir, artifact.pdf)));
    const bytes = fs.readFileSync(source);
    if (hash(bytes) !== pdfHash) throw new Error('Reviewed PDF bytes changed');
    const approved = path.join(dir, 'approved', `${pdfHash}.pdf`);
    writeAtomic(approved, bytes);
    const record = { version: 1, status: 'approved', application: m.application, run, candidate: choice, pdf: path.relative(root, approved), pdf_sha256: pdfHash, manifest: path.relative(root, manifestFile), manifest_sha256: fileHash(manifestFile), fingerprint: m.fingerprint, approved_at: new Date().toISOString(), acknowledged_warnings: true, human_override: !!resolveDisagreement };
    await updateLog(root, m.application, { run_id: run, status: 'approved', approved_file: record.pdf, approved_sha256: pdfHash });
    writeJson(approvalPath(root, m.application.url), record);
    return { file: approved, sha256: pdfHash, status: 'approved' };
  });
}

// Approval for a hand-tailored LaTeX resume (resume-tex/approve.mjs). The caller has
// already run the resume-tex checker and compiled `pdf` from `tex`; this binds that exact
// PDF to one job URL, together with the source and approved-bullet library it came from.
export async function approveLatex(root, { url, company, role, tex, pdf, library = 'data/resume-variants.md' }) {
  root = fs.realpathSync(root);
  url = jobUrl(url);
  if (typeof company !== 'string' || !company.trim() || typeof role !== 'string' || !role.trim()) throw new Error('Company and role required');
  const application = { id: `latex-${hash(url).slice(0, 12)}`, company: company.trim(), role: role.trim(), url, date: new Date().toISOString().slice(0, 10) };
  return withPipelineLock(path.join(appDir(root, application.id), 'lifecycle'), async () => {
    if (fs.existsSync(path.join(appDir(root, application.id), 'submission.json'))) throw new Error('Application already recorded as submitted');
    checkReferral(root, application);
    const bytes = fs.readFileSync(contained(root, pdf)), pdfHash = hash(bytes);
    const approved = path.join(appDir(root, application.id), 'approved', `${pdfHash}.pdf`);
    writeAtomic(approved, bytes);
    writeJson(path.join(appDir(root, application.id), 'application.json'), application);
    const record = { version: 1, kind: 'latex', status: 'approved', application, pdf: path.relative(root, approved), pdf_sha256: pdfHash,
      tex: path.relative(root, contained(root, tex)), tex_sha256: fileHash(contained(root, tex)), library, library_sha256: fileHash(contained(root, library)), approved_at: new Date().toISOString() };
    await updateLog(root, application, { status: 'approved', approved_file: record.pdf, approved_sha256: pdfHash });
    writeJson(approvalPath(root, url), record);
    return { file: approved, sha256: pdfHash, status: 'approved', application: application.id };
  });
}

export function requireApproval(root, url) {
  root = fs.realpathSync(root);
  const file = approvalPath(root, url);
  if (!fs.existsSync(file)) throw new Error('Review the resume and approve it for this exact job (resume-pipeline approve, or resume-tex/approve.mjs for a LaTeX resume) before filling or uploading');
  const record = readJson(file);
  if (record.status !== 'approved' || jobUrl(record.application.url) !== jobUrl(url)) throw new Error('No active approval for this job');
  if (fs.existsSync(path.join(appDir(root, record.application.id), 'submission.json'))) throw new Error('Application already recorded as submitted');
  if (record.kind === 'latex') {
    checkReferral(root, record.application);
    if (fileHash(contained(root, record.tex)) !== record.tex_sha256) throw new Error('Approval invalidated: the resume source changed; check and approve again');
    if (fileHash(contained(root, record.library)) !== record.library_sha256) throw new Error('Approval invalidated: the approved-bullet library changed; check and approve again');
    const pdf = contained(root, record.pdf), buffer = fs.readFileSync(pdf);
    if (hash(buffer) !== record.pdf_sha256) throw new Error('Approved PDF bytes changed; review again');
    return { record, path: pdf, upload: { name: `resume-${record.pdf_sha256.slice(0, 10)}.pdf`, mimeType: 'application/pdf', buffer } };
  }
  verifyFingerprint(root, record.fingerprint); checkReferral(root, record.application);
  const manifestPath = contained(root, record.manifest);
  if (fileHash(manifestPath) !== record.manifest_sha256) throw new Error('Approved run changed');
  const m = readJson(manifestPath), dir = path.dirname(manifestPath);
  if (readJson(path.join(appDir(root, record.application.id), 'active-run.json')).run !== record.run) throw new Error('A newer preparation invalidated this approval');
  if (fileHash(path.join(dir, 'inputs/jd.txt')) !== m.jd_sha256 || fileHash(path.join(dir, 'packet.md')) !== m.packet_sha256) throw new Error('Approved job or packet changed');
  const pdf = contained(root, record.pdf), buffer = fs.readFileSync(pdf);
  if (hash(buffer) !== record.pdf_sha256) throw new Error('Approved PDF bytes changed; review again');
  return { record, path: pdf, upload: { name: `resume-${record.pdf_sha256.slice(0, 10)}.pdf`, mimeType: 'application/pdf', buffer } };
}

export async function revoke(root, id) {
  root = fs.realpathSync(root);
  const application = readJson(path.join(appDir(root, id), 'application.json'));
  return withPipelineLock(path.join(appDir(root, id), 'lifecycle'), async () => {
    const f = approvalPath(root, application.url);
    if (fs.existsSync(f)) writeJson(f, { ...readJson(f), status: 'revoked', revoked_at: new Date().toISOString() });
    await updateLog(root, application, { status: fs.existsSync(path.join(appDir(root, id), 'submission.json')) ? 'submitted' : 'revoked' });
  });
}

export async function recordSubmitted(root, id, pdfHash, confirmed) {
  root = fs.realpathSync(root);
  if (!confirmed) throw new Error('This command only records a submission you already made yourself. Explicit confirmation required.');
  const application = readJson(path.join(appDir(root, id), 'application.json'));
  return withPipelineLock(path.join(appDir(root, id), 'lifecycle'), async () => {
    const receiptPath = path.join(appDir(root, id), 'submission.json');
    const previous = fs.existsSync(receiptPath) ? readJson(receiptPath) : null;
    const record = previous || requireApproval(root, application.url).record;
    if (record.pdf_sha256 !== pdfHash) throw new Error('Confirm the exact PDF hash you submitted');
    const receipt = previous || { ...record, status: 'submitted', submitted_at: new Date().toISOString() };
    writeJson(receiptPath, receipt);
    await updateLog(root, application, { run_id: record.run, status: 'submitted', file_submitted: record.pdf, submitted_sha256: pdfHash });
    writeJson(approvalPath(root, application.url), receipt);
    return { status: 'submitted', note: 'Recorded your confirmation; no browser submission was performed' };
  });
}
