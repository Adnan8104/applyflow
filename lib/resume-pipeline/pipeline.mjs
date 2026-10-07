import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withPipelineLock } from '../../pipeline-lock.mjs';
import { auditAts } from '../../verify-ats.mjs';
import { loadBank, masterCandidate } from './facts.mjs';
import { configFor, contained, fileHash, hash, jobUrl, mapLimit, readJson, writeAtomic, writeJson } from './io.mjs';
import { jdSchema } from './contracts.mjs';
import { checkCandidate, checkClaims, checkPdf } from './gates.mjs';
import { buildHtml, checkBaseline, extractPdf, layoutCss, renderCandidate } from './render.mjs';
import { createWorkers } from './workers.mjs';
import { blindSet, chooseWinner, interpretReview, keywordCoverage } from './selection.mjs';
import { appDir, checkReferral, fingerprint } from './approval.mjs';
import { updateLog } from './log.mjs';

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'job';
const md = s => String(s).replace(/[<>`]/g, '').replace(/\r?\n/g, ' ');

export function packetFor(m, bank) {
  const lines = [`# Resume Approval Packet`, '', `Status: ${m.status}. Nothing has been uploaded or submitted.`, '', '## Knockout Warnings'];
  const constraints = m.jd?.knockout_constraints || [];
  for (const k of constraints) lines.push(`- ${md(k.certainty)}: ${md(k.text)} (JD line ${k.line}: ${md(k.quote)})`);
  if (!constraints.length) lines.push('- No constraints extracted. This is not proof of eligibility; inspect the original posting.');
  lines.push('- Work authorization, future sponsorship and start date are distinct questions. Confirm your answers yourself.', '', '## Recommendation', m.selection ? `${md(m.selection.winner || 'None; human decision required')}: ${md(m.selection.reason)}` : 'Stopped before selection.', '', '## Files and Checks');
  for (const e of m.entries) {
    lines.push(`### ${e.id}`, `Passed: ${!!e.passed}. ${e.pdf ? `PDF: ${e.pdf}; SHA-256: ${e.pdf_sha256}` : 'No passing PDF.'}`);
    lines.push(`Keyword coverage: ${JSON.stringify(e.coverage || null)}`, `Existing HTML ATS heuristic: ${e.ats?.score ?? 'not computed'}/100. Not an employer ATS score and not a truth check.`);
    for (const problem of e.errors || []) lines.push(`- Rejected: ${md(problem)}`);
    for (const warning of e.warnings || []) lines.push(`- Flag: ${md(warning)}`);
    for (const claim of e.claims || []) lines.push(`- Claim ${claim.source_id}: ${claim.reverted ? 'REVERTED' : 'supported by model'}; ${md(claim.issue)}`);
    for (const b of e.candidate?.bullets || []) {
      const src = bank.bullets.find(s => s.id === b.source_id);
      if (src && (b.edit_type !== 'kept' || b.reason)) lines.push(`- ${b.source_id} (${b.edit_type}): BEFORE: ${md(src.original_text)} AFTER: ${md(b.final_text || '[dropped]')}. Reason: ${md(b.reason)}`);
    }
  }
  lines.push('', '## Independent Reviews');
  for (const [i, review] of (m.reviews || []).entries()) {
    lines.push(`### Review ${i + 1}`, `Winner: ${review.winner || 'tie'}; totals: ${JSON.stringify(review.totals)}`);
    for (const row of review.review.scores) for (const [n, c] of row.criteria.entries()) lines.push(`- ${review.mapping[row.label]}, criterion ${n + 1}: ${c.score}/5; ${md(c.reason)} (JD lines ${c.jd_lines.join(', ')})`);
  }
  if (m.error) lines.push('', `Stopped: ${md(m.error)}`);
  lines.push('', '## Human Check', 'Inspect the actual PDF visually. Confirm facts, omitted evidence, reading order, legibility, dates and job eligibility. Deterministic checks do not prove unrestricted English paraphrases are truthful. The claim checker is an additional fallible check.', 'Approval permits only form filling and this exact resume upload for this job. Final submission remains yours.');
  return lines.join('\n') + '\n';
}

export async function baselinePreview(root) {
  root = fs.realpathSync(root);
  const { bank } = loadBank(root), config = configFor(root);
  const dir = contained(root, `data/applications/baselines/${randomUUID()}`);
  const result = await renderCandidate(root, dir, masterCandidate(bank), bank, config);
  const layout_sha256 = config.render.layout_css ? fileHash(contained(root, config.render.layout_css)) : null;
  writeJson(path.join(dir, 'audit.json'), { gates: result.gates, ats: result.ats, master_sha256: bank.master_sha256, template_sha256: fileHash(contained(root, config.render.template)), layout_sha256, pdf_sha256: result.pdf_sha256 });
  if (!result.gates.ok) throw new Error(`Baseline extraction failed; inspect ${dir}/audit.json`);
  return { pdf: result.pdf, sha256: result.pdf_sha256, template_sha256: fileHash(contained(root, config.render.template)), layout_sha256, master_sha256: bank.master_sha256, note: 'Unapproved baseline preview. Review visually before pinning config. No model calls.' };
}

export async function prepare(root, options, dependencies = {}) {
  root = fs.realpathSync(root);
  // All local setup gates precede paid calls and lifecycle changes.
  const { master, bank, source } = loadBank(root), config = configFor(root);
  checkBaseline(root, config, bank.master_sha256);
  if (typeof options.company !== 'string' || !options.company.trim() || typeof options.role !== 'string' || !options.role.trim()) throw new Error('Company and role required');
  if (typeof options.jdFile !== 'string' || !options.jdFile) throw new Error('Supply --jd with a saved JD inside the workspace');
  const sourceJd = contained(root, fs.realpathSync(path.resolve(root, options.jdFile)));
  const url = jobUrl(options.url), raw = fs.readFileSync(sourceJd, 'utf8');
  if (!raw.trim() || raw.length > 100000) throw new Error('JD must contain 1..100000 characters');
  const date = new Date().toISOString().slice(0, 10);
  const application = { id: `${slug(options.company)}-${slug(options.role)}-${hash(url).slice(0, 12)}`, company: options.company.trim(), role: options.role.trim(), url, date };
  checkReferral(root, application);
  const original = masterCandidate(bank);
  const masterView = buildHtml(fs.readFileSync(contained(root, config.render.template), 'utf8'), original, bank, config.render.format, layoutCss(root, config));
  const extract = dependencies.extract || extractPdf;
  const baseline = contained(root, config.render.approved_baseline_pdf);
  const baselineGates = checkPdf(extract(baseline, config), masterView.expected);
  if (!baselineGates.ok) throw new Error(`Approved master baseline fails extraction/page gates: ${baselineGates.errors.join('; ')}`);
  const dir = appDir(root, application.id);
  fs.mkdirSync(dir, { recursive: true });
  const run = `${Date.now()}-${randomUUID().slice(0, 8)}`, runPath = path.join(dir, 'runs', run);
  const audits = [];
  const call = createWorkers(config, { allowModelCalls: options.allowModelCalls, transport: dependencies.transport, audit: r => audits.push(r) });
  return withPipelineLock(path.join(dir, 'lifecycle'), async () => {
    if (fs.existsSync(path.join(dir, 'submission.json'))) throw new Error('Application already recorded as submitted; no repeat application');
    const appFile = path.join(dir, 'application.json');
    if (fs.existsSync(appFile)) {
      const old = readJson(appFile);
      if (old.url !== url || old.company !== application.company || old.role !== application.role) throw new Error('Existing application identity differs');
      application.date = old.date;
    }
    writeJson(appFile, application);
    const activeApproval = contained(root, `data/applications/approvals/${hash(url)}.json`);
    if (fs.existsSync(activeApproval)) {
      const old = readJson(activeApproval);
      if (old.status === 'submitted' || fs.existsSync(path.join(appDir(root, old.application.id), 'submission.json'))) throw new Error('This job was already recorded as submitted; no repeat application');
      if (old.application.id !== application.id) throw new Error(`This exact job already belongs to application ${old.application.id}; use its original company/role identity`);
      writeJson(activeApproval, { ...old, status: 'revoked', reason: 'New preparation started' });
    }
    writeJson(path.join(dir, 'active-run.json'), { run });
    writeAtomic(path.join(runPath, 'inputs/master.md'), master);
    writeAtomic(path.join(runPath, 'inputs/fact-bank.yaml'), fs.readFileSync(contained(root, source.bank)));
    writeAtomic(path.join(runPath, 'inputs/jd.txt'), raw);
    writeJson(path.join(runPath, 'inputs/config.json'), config);
    const m = { version: 1, status: 'preparing', application, run, fingerprint: fingerprint(root, config), jd_sha256: hash(raw), entries: [], reviews: [] };
    m.fingerprint.files[path.relative(root, sourceJd)] = hash(raw);
    if (options.reportFile) m.fingerprint.files[path.relative(root, contained(root, options.reportFile))] = fileHash(contained(root, options.reportFile));
    await updateLog(root, application, { run_id: run, status: 'preparing', approved_file: '', approved_sha256: '', file_submitted: '', submitted_sha256: '' });
    try {
      m.jd = jdSchema(await call('parser', { numbered_jd: raw.split(/\r?\n/).map((text, i) => ({ line: i + 1, text })) }), raw);
      writeJson(path.join(runPath, 'jd.json'), m.jd);
      const masterPdf = path.join(runPath, 'master/resume.pdf');
      writeAtomic(masterPdf, fs.readFileSync(baseline));
      m.entries.push({ id: 'master', passed: true, candidate: original, reviewText: masterView.reviewText, pdf: 'master/resume.pdf', pdf_sha256: fileHash(masterPdf), gates: baselineGates, coverage: keywordCoverage(original, m.jd), ats: auditAts(masterView.html), warnings: [] });
      const drafts = await mapLimit(Array.from({ length: config.candidates }, (_, i) => i), config.concurrency, async i => {
        const id = `candidate-${i + 1}`, dest = path.join(runPath, id), entry = { id, passed: false, errors: [], warnings: [] };
        try {
          const proposed = await call('writer', { master, fact_bank: bank, jd: m.jd, strategy: config.strategies[i % config.strategies.length] });
          writeJson(path.join(dest, 'proposed.json'), proposed);
          const gates = checkCandidate(proposed, bank);
          entry.warnings.push(...gates.warnings);
          if (!gates.ok) throw new Error(gates.errors.join('; '));
          const checked = await checkClaims(proposed, bank, input => call('claim', input));
          entry.claims = checked.results; entry.candidate = checked.effective;
          entry.warnings.push(...checked.gates.warnings);
          if (!checked.gates.ok) throw new Error(checked.gates.errors.join('; '));
          writeJson(path.join(dest, 'effective.json'), entry.candidate);
          const rendered = await (dependencies.render || renderCandidate)(root, dest, entry.candidate, bank, config);
          writeJson(path.join(dest, 'render-audit.json'), { gates: rendered.gates, extraction: rendered.extraction, ats: rendered.ats });
          if (!rendered.gates.ok) throw new Error(rendered.gates.errors.join('; '));
          Object.assign(entry, { passed: true, reviewText: rendered.reviewText, pdf: path.relative(runPath, rendered.pdf), pdf_sha256: rendered.pdf_sha256, gates: rendered.gates, ats: rendered.ats, coverage: keywordCoverage(entry.candidate, m.jd) });
        } catch (e) { entry.errors.push(e.message); }
        writeJson(path.join(dest, 'result.json'), entry);
        return entry;
      });
      m.entries.push(...drafts);
      const passing = m.entries.filter(e => e.passed);
      let order;
      for (let i = 0; i < 2; i++) {
        const blind = blindSet(passing, order); order = blind.order;
        const review = await call('reviewer', { jd: m.jd, source_master: master, resumes: blind.resumes });
        m.reviews.push(interpretReview(review, blind.mapping, m.jd));
      }
      m.selection = chooseWinner(m.reviews, config.reviewer_margin);
      m.status = m.selection.status;
    } catch (e) { m.status = 'failed'; m.error = e.message; }
    const packet = packetFor(m, bank);
    writeAtomic(path.join(runPath, 'packet.md'), packet);
    m.packet_sha256 = hash(packet);
    writeJson(path.join(runPath, 'calls.json'), audits);
    writeJson(path.join(runPath, 'manifest.json'), m);
    await updateLog(root, application, { run_id: run, status: m.status });
    return { application: application.id, run, status: m.status, winner: m.selection?.winner || null, packet: path.join(runPath, 'packet.md'), error: m.error };
  });
}
