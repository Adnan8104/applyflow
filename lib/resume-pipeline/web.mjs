import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { withPipelineLock } from '../../pipeline-lock.mjs';
import { contained, readJson, writeJson, writeAtomic, hash, jobUrl, fileHash } from './io.mjs';
import { prepare } from './pipeline.mjs';
import { status } from './status.mjs';
import { runDir, verifyFingerprint, requireApproval } from './approval.mjs';

const number = input => {
  if (typeof input !== 'string' || !/^\d{1,9}$/.test(input)) throw new Error('A report number is required');
  return String(Number(input));
};
export function reportInput(text) {
  const summaryText = /^## Machine Summary\s*\n+```ya?ml\s*\n([\s\S]*?)^```/m.exec(text)?.[1];
  if (!summaryText) throw new Error('Report needs its structured Machine Summary; use the CLI with a saved JD for other formats');
  const summary = yaml.load(summaryText, { schema: yaml.JSON_SCHEMA });
  if (typeof summary?.company !== 'string' || !summary.company.trim() || typeof summary?.role !== 'string' || !summary.role.trim()) throw new Error('Report company/role missing');
  const url = jobUrl(/^\*\*URL:\*\*\s+(https:\/\/\S+)/m.exec(text)?.[1]);
  const archived = /^## Job Description \(archived verbatim\)\s*\n([\s\S]*)/m.exec(text)?.[1]?.trim();
  if (!archived) throw new Error('Report has no archived job description; save the original posting first');
  const raw = archived.startsWith('```') ? /^```[^\n]*\n([\s\S]*?)\n```(?:\s|$)/.exec(archived)?.[1] : archived;
  if (!raw?.trim()) throw new Error('Archived JD is empty or its code fence is incomplete');
  return { company: summary.company, role: summary.role, url, raw };
}

export async function prepareReport(root, selector, allowModelCalls, dependencies) {
  root = fs.realpathSync(root);
  const n = number(selector), setup = status(root);
  if (!setup.ready) throw new Error(setup.blockers.join('; '));
  if (allowModelCalls !== true) throw new Error('Confirm provider/model API charges and sharing resume data before generating');
  const map = contained(root, `data/applications/by-report/${n}.json`);
  fs.mkdirSync(path.dirname(map), { recursive: true });
  return withPipelineLock(map, async () => {
    const matches = fs.readdirSync(contained(root, 'reports')).filter(f => /^\d+-.*\.md$/.test(f) && String(Number(f.split('-')[0])) === n);
    if (matches.length !== 1) throw new Error('Report number is missing or ambiguous');
    const reportFile = contained(root, `reports/${matches[0]}`);
    const input = reportInput(fs.readFileSync(reportFile, 'utf8'));
    const jdFile = contained(root, `data/applications/web-inputs/${n}-${hash(input.raw).slice(0, 16)}.txt`);
    writeAtomic(jdFile, input.raw);
    // A failed/new run must never expose a prior winner as the new draft.
    writeJson(map, { status: 'preparing' });
    try {
      const result = await prepare(root, { ...input, jdFile, reportFile, allowModelCalls }, dependencies);
      writeJson(map, result);
      return result;
    } catch (e) { writeJson(map, { status: 'failed', error: e.message }); throw e; }
  });
}

export function previewReport(root, selector) {
  const map = contained(root, `data/applications/by-report/${number(selector)}.json`);
  if (!fs.existsSync(map)) return null; // Legacy previews remain available, never upload authorization.
  const result = readJson(map);
  if (!result.application || !result.run) throw new Error('Latest resume preparation has no reviewable result');
  const state = status(root, result.application);
  if (state.run !== result.run) throw new Error('This report references a superseded resume run');
  const dir = runDir(root, result.application, result.run), m = readJson(path.join(dir, 'manifest.json'));
  if (state.status === 'approved') {
    const approved = requireApproval(root, m.application.url);
    return { path: approved.path, status: 'approved-for-this-job' };
  }
  if (m.status !== 'awaiting_approval' || !m.selection?.winner) throw new Error('Review the packet to resolve this run before choosing a PDF');
  verifyFingerprint(root, m.fingerprint);
  const entry = m.entries.find(e => e.id === m.selection.winner && e.passed);
  if (!entry) throw new Error('No passing recommended PDF');
  const pdf = contained(root, path.join(dir, entry.pdf));
  if (fileHash(pdf) !== entry.pdf_sha256) throw new Error('Draft PDF changed');
  return { path: pdf, status: 'draft-preview-not-upload-approval' };
}
