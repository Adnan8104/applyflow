import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { extractBank, validateBank, masterCandidate, quantities, initBank, loadBank, toolsIn } from '../lib/resume-pipeline/facts.mjs';
import { checkCandidate, checkClaims, checkPdf } from '../lib/resume-pipeline/gates.mjs';
import { contained, hash, fileHash, readJson, writeJson, writeAtomic, jobUrl, sourcePaths } from '../lib/resume-pipeline/io.mjs';
import { jdSchema } from '../lib/resume-pipeline/contracts.mjs';
import { createWorkers } from '../lib/resume-pipeline/workers.mjs';
import { blindSet, interpretReview, chooseWinner, keywordCoverage } from '../lib/resume-pipeline/selection.mjs';
import { buildHtml, checkBaseline, layoutCss } from '../lib/resume-pipeline/render.mjs';
import { fingerprint } from '../lib/resume-pipeline/approval.mjs';
import { prepare } from '../lib/resume-pipeline/pipeline.mjs';
import { approve, requireApproval, revoke, recordSubmitted, appDir } from '../lib/resume-pipeline/approval.mjs';
import { parseCsv, serializeCsv, updateLog } from '../lib/resume-pipeline/log.mjs';
import { reportInput, previewReport } from '../lib/resume-pipeline/web.mjs';
import { status } from '../lib/resume-pipeline/status.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = `# CV -- Test Person
**Contact:** person@example.com | +1 555 0100

## Education
### University Aug. 2023 - May 2027
B.S. Computer Science | GPA: 3.42
- Completed coursework in algorithms.

## Experience
### Engineer Intern May 2026 - Aug. 2026
Example Company, United States
- Automated asset processing to reduce model size from 47 MB to 17 MB by 64%.
- Contributed to review of two publications using Python.
- Built checkpoint persistence using LangGraph and SQLite.

## Research Experience
### Researcher Fall 2026 - Present
University
- Studied human reasoning.

## Projects
### Dashboard | React Jan 2026
- Built a dashboard with React.

## Technical Skills
- **Languages:** Python, JavaScript/TypeScript
- **Frameworks:** React, LangGraph
`;
const RAW = 'Build web applications with React.\nExperience developing software required.\nMust be authorized to work in the United States.';
const JD = { must_haves: [{ text: 'Software development', line: 2, quote: 'Experience developing software required.', certainty: 'explicit' }], nice_to_haves: [], stack_keywords: [{ text: 'React', line: 1, quote: 'React', certainty: 'explicit' }], responsibilities: [{ text: 'Build web applications', line: 1, quote: 'Build web applications', certainty: 'explicit' }], knockout_constraints: [{ text: 'US work authorization; future sponsorship not specified', line: 3, quote: 'Must be authorized to work in the United States.', certainty: 'ambiguous' }] };
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'templates/cv-template.jake.html'), 'utf8');
const LAYOUT = fs.readFileSync(path.join(ROOT, 'config/resume-layout.css'), 'utf8');
const bank = extractBank(MASTER);
const master = masterCandidate(bank);
const mutate = (needle, text) => { const c = structuredClone(master), b = c.bullets.find(b => b.final_text.includes(needle)); Object.assign(b, { final_text: text, edit_type: 'rephrased', reason: 'test' }); return c; };

test('fact extraction round-trips source without approving or modifying it', () => {
  assert.equal(bank.status, 'needs_human_review');
  assert.equal(bank.bullets.length, 6);
  assert.throws(() => validateBank(bank, MASTER), /approved/);
  assert.doesNotThrow(() => validateBank({ ...bank, status: 'approved' }, MASTER));
  assert.throws(() => validateBank(bank, MASTER + '\n'), /stale/);
  assert.deepEqual(quantities('3D KTX2 mem0 47 MB 64% 8.2s $15K/month 200+ six-figure'), ['47 MB', '64%', '8.2s', '$15K/month', '200+', 'six-figure']);
});

test('master passes; metrics, immutable fields, unknown sources and skills fail closed', () => {
  assert.equal(checkCandidate(master, bank).ok, true);
  const metric = mutate('47 MB', master.bullets[1].final_text.replace('47 MB', '45 MB'));
  assert.equal(checkCandidate(metric, bank).ok, false);
  const changed = structuredClone(master); changed.immutable.header[0] = 'Different Person';
  assert.equal(checkCandidate(changed, bank).ok, false);
  const skill = structuredClone(master); skill.skills[0].items.push('GraphQL');
  assert.equal(checkCandidate(skill, bank).ok, false);
  const missing = structuredClone(master); missing.bullets.pop();
  assert.equal(checkCandidate(missing, bank).ok, false);
  const unknown = structuredClone(master); unknown.bullets[0].source_id = 'unknown';
  assert.equal(checkCandidate(unknown, bank).ok, false);
  const reorderedKeys = structuredClone(master);
  reorderedKeys.immutable = { sections: master.immutable.sections, header: master.immutable.header };
  assert.equal(checkCandidate(reorderedKeys, bank).ok, true);
});

test('spelled-out counts with descriptors or hyphens are protected; function words and tool prefixes are not', () => {
  for (const [text, want] of [['integrated six LLM providers behind one interface', ['six']], ['a five-agent majority-vote QA layer', ['five']], ['two official government publications', ['two']], ['four silent failure modes', ['four']], ['one of the agents', []], ['behind one interface', []]]) assert.deepEqual(quantities(text), want, text);
  assert.deepEqual(toolsIn('React Native, Swift, Kotlin, Java Spring Boot'), ['Java', 'Swift', 'React Native', 'Kotlin', 'Spring Boot']);
  assert.deepEqual(toolsIn('React and React Native'), ['React Native', 'React']);
  const src = '# CV -- T\n\n## Experience\n### Intern May 2026 - Aug. 2026\nCo\n- Integrated six LLM providers across React Native apps with a five-agent QA layer.\n\n## Technical Skills\n- **Frameworks:** React Native\n';
  const b = extractBank(src), c = masterCandidate(b);
  assert.deepEqual(b.bullets[0].metrics.map(m => m.text), ['six', 'five']);
  const edit = text => { const x = structuredClone(c); Object.assign(x.bullets[0], { final_text: text, edit_type: 'rephrased', reason: 'test' }); return checkCandidate(x, b); };
  assert.match(edit('Integrated eight LLM providers across React Native apps with a five-agent QA layer.').errors.join(), /lost quantity six/);
  assert.match(edit('Integrated LLM providers across React Native apps with a QA layer.').errors.join(), /lost quantity/);
  assert.match(edit('Integrated six LLM providers across React apps with a five-agent QA layer.').errors.join(), /unsupported technology React/);
  assert.equal(edit('Integrated six LLM providers across React Native apps with a five agent QA layer.').errors.length, 0);
});

test('global skill cannot be borrowed by a project bullet', () => {
  assert.ok(bank.skills_allowlist[0].items.includes('JavaScript/TypeScript'));
  const c = mutate('dashboard', 'Built a dashboard with React and TypeScript.');
  assert.match(checkCandidate(c, bank).errors.join(' '), /unsupported technology TypeScript/);
});

test('custom built-in features and stronger verbs are flagged and semantic failures revert', async () => {
  for (const [old, value] of [['checkpoint', 'Built custom checkpoint persistence using LangGraph and SQLite.'], ['47 MB', 'Optimized asset processing to reduce model size from 47 MB to 17 MB by 64%.'], ['Contributed', 'Led review of two publications using Python.']]) {
    const c = mutate(old, value), gates = checkCandidate(c, bank);
    assert.equal(gates.ok, true);
    assert.ok(gates.warnings.length);
    const checked = await checkClaims(c, bank, async input => {
      assert.deepEqual(Object.keys(input), ['original_text', 'final_text']);
      return { supported: false, issue: 'Strengthens ownership' };
    });
    assert.equal(checked.results[0].reverted, true);
    assert.deepEqual(checked.effective.bullets.map(b => b.final_text), master.bullets.map(b => b.final_text));
  }
});

test('claim timeout and malformed verdict revert instead of accepting', async () => {
  const c = mutate('dashboard', 'Built a React dashboard.');
  for (const call of [async () => { throw new Error('timeout'); }, async () => ({ supported: 'yes' })]) {
    const result = await checkClaims(c, bank, call);
    assert.equal(result.results[0].reverted, true);
    assert.equal(result.gates.ok, true);
  }
});

test('qualifiers and quantified outcomes cannot quietly disappear', () => {
  const c = mutate('47 MB', 'Automated asset processing.');
  assert.match(checkCandidate(c, bank).errors.join(' '), /lost quantity/);
  const b = extractBank(MASTER.replace('reduce model size', 'reduce estimated model size'));
  const withoutQualifier = masterCandidate(b);
  withoutQualifier.bullets[1].final_text = withoutQualifier.bullets[1].final_text.replace('estimated ', '');
  withoutQualifier.bullets[1].edit_type = 'rephrased';
  assert.match(checkCandidate(withoutQualifier, b).errors.join(' '), /lost qualifier/);
});

test('one-page extraction rejects missing sections, backwards reading order and off-page glyphs', () => {
  const extraction = { pages: 1, text: 'Education University Experience Engineer', width: 600, height: 800, lines: [{ x: 30, y: 30, width: 100, height: 10 }, { x: 30, y: 50, width: 100, height: 10 }] };
  assert.equal(checkPdf(extraction, ['Education', 'University', 'Experience', 'Engineer']).ok, true);
  assert.equal(checkPdf({ ...extraction, pages: 2 }, []).ok, false);
  assert.equal(checkPdf(extraction, ['Experience', 'Education']).ok, false);
  assert.equal(checkPdf({ ...extraction, lines: extraction.lines.toReversed() }, []).ok, false);
  assert.equal(checkPdf({ ...extraction, lines: [{ x: 590, y: 20, width: 100, height: 10 }] }, []).ok, false);
});

test('section adapter preserves research, education-first, dated projects and source CSS', () => {
  const result = buildHtml(TEMPLATE, master, bank, 'a4');
  assert.equal(result.html.match(/<style>([\s\S]*?)<\/style>/)[1], TEMPLATE.match(/<style>([\s\S]*?)<\/style>/)[1].replace('{{PAGE_WIDTH}}', '210mm'));
  assert.ok(result.html.indexOf('>Education<') < result.html.indexOf('>Experience<'));
  assert.ok(result.html.includes('>Research Experience<'));
  assert.ok(result.html.includes('Jan 2026'));
  assert.equal((result.html.match(/<li>/g) || []).length, bank.bullets.length);
  assert.ok(result.expected.includes('B.S. Computer Science | GPA: 3.42'));
  // The stock builder exposes fixed slots, no research/venture placeholders.
  assert.equal(TEMPLATE.includes('{{SECTION_RESEARCH}}'), false);
});

test('pipeline layout override follows template CSS, stays local and is bound to baseline/approval', t => {
  const plain = buildHtml(TEMPLATE, master, bank, 'letter'), styled = buildHtml(TEMPLATE, master, bank, 'letter', LAYOUT);
  assert.equal(plain.html.includes('resume-pipeline-layout'), false);
  assert.ok(styled.html.indexOf('id="resume-pipeline-layout"') > styled.html.indexOf('<style>'));
  assert.ok(styled.html.indexOf('id="resume-pipeline-layout"') < styled.html.indexOf('</head>'));
  assert.deepEqual(styled.expected, plain.expected);
  assert.doesNotMatch(LAYOUT.replace(/\/\*[\s\S]*?\*\//g, ''), /font|--page-margin|@page/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-layout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = { render: { template: 't.html', layout_css: 'layout.css', approved_template_sha256: hash(TEMPLATE), approved_layout_sha256: hash(LAYOUT), approved_baseline_pdf: 'b.pdf', approved_baseline_sha256: hash('%PDF-b'), approved_master_sha256: hash(MASTER) } };
  writeAtomic(path.join(root, 't.html'), TEMPLATE); writeAtomic(path.join(root, 'b.pdf'), '%PDF-b'); writeAtomic(path.join(root, 'layout.css'), LAYOUT);
  for (const f of ['cv.md', 'data/fact_bank.yaml', 'config/resume-pipeline.yml', 'config/job-policy.yml']) writeAtomic(path.join(root, f), 'x');
  assert.equal(layoutCss(root, config), LAYOUT);
  checkBaseline(root, config, hash(MASTER));
  assert.ok(fingerprint(root, config).files['layout.css']);
  writeAtomic(path.join(root, 'layout.css'), LAYOUT + '.job { margin-bottom: 0; }');
  assert.throws(() => checkBaseline(root, config, hash(MASTER)), /layout changed/);
  for (const bad of ['</style><script>', '@import "x.css";', '.a { background: url(https://x) }']) {
    writeAtomic(path.join(root, 'layout.css'), bad);
    assert.throws(() => layoutCss(root, config), /local style rules/);
  }
});

test('configured source master/bank replace cv.md without reading or changing it', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(sourcePaths(root), { master: 'cv.md', bank: 'data/fact_bank.yaml' });
  writeAtomic(path.join(root, 'cv.md'), 'OLD MASTER, not a resume');
  writeAtomic(path.join(root, 'config/resume-pipeline.yml'), yaml.dump({ source: { master: 'data/main.md', fact_bank: 'data/main-bank.yaml' } }));
  writeAtomic(path.join(root, 'data/main.md'), MASTER);
  initBank(root);
  assert.throws(() => loadBank(root), /Review data\/main-bank\.yaml/);
  writeAtomic(path.join(root, 'data/main-bank.yaml'), yaml.dump({ ...bank, status: 'approved' }));
  const loaded = loadBank(root);
  assert.equal(loaded.master, MASTER);
  assert.equal(loaded.bank.bullets.length, bank.bullets.length);
  assert.equal(fs.existsSync(path.join(root, 'data/fact_bank.yaml')), false);
  assert.equal(fs.readFileSync(path.join(root, 'cv.md'), 'utf8'), 'OLD MASTER, not a resume');
  for (const f of ['config/job-policy.yml', 't.html']) writeAtomic(path.join(root, f), 'x');
  assert.deepEqual(Object.keys(fingerprint(root, { render: { template: 't.html' } }).files).slice(0, 2), ['data/main.md', 'data/main-bank.yaml']);
  writeAtomic(path.join(root, 'config/resume-pipeline.yml'), yaml.dump({ source: { master: '../escape.md' } }));
  assert.throws(() => loadBank(root));
});

test('JD requires exact source evidence and keyword score is deterministic', () => {
  assert.equal(jdSchema(JD, RAW), JD);
  const bad = structuredClone(JD); bad.must_haves[0].quote = 'Must know GraphQL';
  assert.throws(() => jdSchema(bad, RAW), /unsupported/);
  assert.equal(keywordCoverage(master, JD).percent, 100);
});

test('existing report adapter uses archived JD, not the evaluator narrative', () => {
  const report = '**URL:** https://jobs.ashbyhq.com/sample/req1\n\n## Machine Summary\n\n```yaml\ncompany: Sample\nrole: Engineer\n```\n\n## Evaluation\nDo not use this as the JD.\n\n## Job Description (archived verbatim)\n\n```\n' + RAW + '\n```\n';
  assert.equal(reportInput(report).raw, RAW);
  assert.equal(reportInput(report).company, 'Sample');
  assert.throws(() => reportInput(report.replace('Job Description (archived verbatim)', 'Missing archive')), /no archived/);
});

test('blind labels hide strategy and edits, shuffles differ and master wins ties/margin', () => {
  const entries = ['master', 'candidate-1', 'candidate-2'].map(id => ({ id, reviewText: { sections: [] } }));
  const first = blindSet(entries), second = blindSet(entries, first.order);
  assert.notDeepEqual(first.order, second.order);
  assert.deepEqual(Object.keys(first.resumes[0]), ['label', 'sections']);
  const review = { winner: 'A', scores: ['A', 'B', 'C'].map(label => ({ label, criteria: Array.from({ length: 4 }, () => ({ score: 3, reason: 'Matches responsibility', jd_lines: [1] })) })) };
  assert.equal(interpretReview(review, first.mapping, JD).winner, 'master');
  const close = { winner: 'candidate-1', totals: { master: 15, 'candidate-1': 16 } };
  assert.equal(chooseWinner([close, close], 2).winner, 'master');
  const strong = { winner: 'candidate-1', totals: { master: 15, 'candidate-1': 18 } };
  assert.equal(chooseWinner([strong, strong], 2).winner, 'candidate-1');
  assert.equal(chooseWinner([close, { ...close, winner: 'master' }], 2).status, 'needs_review');
});

test('stateless calls share no history/tools, honor limits, and do not silently enable providers', async () => {
  const config = { models: { enabled: false, writer: { model: 'test', temperature: 0 } }, max_calls: 2, max_output_tokens: 500, timeout_ms: 1000 };
  assert.throws(() => createWorkers(config), /disabled/);
  const seen = [];
  const call = createWorkers(config, { transport: async request => { seen.push(request); return '{}'; } });
  await call('writer', { input: 'one' }); await call('writer', { input: 'two' });
  assert.equal(seen[1].messages.length, 2);
  assert.equal(seen[1].messages[1].content.includes('one'), false);
  assert.equal('tools' in seen[1], false);
  await assert.rejects(call('writer', {}), /budget/);
});

test('CSV quotes commas, newlines and quotes, protects formulas and rejects malformed data', () => {
  const rows = [['name', 'outcome'], ['a,b', 'one\n"two"'], ['=cmd()', '']];
  assert.deepEqual(parseCsv(serializeCsv(rows)), [['name', 'outcome'], ['a,b', 'one\n"two"'], ["'=cmd()", '']]);
  assert.throws(() => parseCsv('"abc'), /Unclosed/);
});

test('path containment allows new nested directories, rejects traversal/symlinks; job identities stay distinct', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.ok(contained(root, 'new/deep/file.json').endsWith('new/deep/file.json'));
  assert.throws(() => contained(root, '../outside'), /escapes/);
  fs.symlinkSync('/tmp/missing-resume-target', path.join(root, 'link'));
  assert.throws(() => contained(root, 'link/test'), /Symlink/);
  assert.equal(jobUrl('https://jobs.ashbyhq.com/acme/req1/application'), jobUrl('https://jobs.ashbyhq.com/acme/req1'));
  assert.notEqual(jobUrl('https://jobs.ashbyhq.com/acme/req1'), jobUrl('https://jobs.ashbyhq.com/acme/req2'));
  assert.notEqual(jobUrl('https://careers.example/#/job/1'), jobUrl('https://careers.example/#/job/2'));
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-flow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeAtomic(path.join(root, 'cv.md'), MASTER);
  initBank(root);
  writeAtomic(path.join(root, 'data/fact_bank.yaml'), yaml.dump({ ...bank, status: 'approved' }));
  writeAtomic(path.join(root, 'templates/cv-template.jake.html'), TEMPLATE);
  writeAtomic(path.join(root, 'config/resume-layout.css'), LAYOUT);
  writeAtomic(path.join(root, 'documents/master.pdf'), '%PDF-test-master');
  writeAtomic(path.join(root, 'config/job-policy.yml'), yaml.dump({ referral_protection: { hard_block: [{ family: 'Protected', names: ['Protected Company'], domains: ['protected.example'] }], review: [], allow: [] } }));
  const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config/resume-pipeline.yml'), 'utf8'));
  delete config.source; // fixture exercises the default cv.md source
  for (const stage of ['parser', 'writer', 'claim', 'reviewer']) config.models[stage].model = 'mock-model';
  Object.assign(config.render, { approved_template_sha256: hash(TEMPLATE), approved_layout_sha256: hash(LAYOUT), approved_baseline_pdf: 'documents/master.pdf', approved_baseline_sha256: fileHash(path.join(root, 'documents/master.pdf')), approved_master_sha256: hash(MASTER) });
  writeAtomic(path.join(root, 'config/resume-pipeline.yml'), yaml.dump(config));
  writeAtomic(path.join(root, 'jd.txt'), RAW);
  const options = { jdFile: path.join(root, 'jd.txt'), company: 'Sample Company', role: 'Engineer', url: 'https://jobs.ashbyhq.com/sample/req1' };
  const expected = buildHtml(TEMPLATE, master, bank, 'a4');
  let calls = 0;
  const dependencies = {
    extract: () => ({ pages: 1, text: expected.expected.join('\n'), width: 600, height: 800, lines: [{ x: 30, y: 30, width: 100, height: 10 }] }),
    transport: async (request, stage) => {
      calls++;
      if (stage === 'parser') return structuredClone(JD);
      if (stage === 'writer') return structuredClone(master);
      if (stage === 'reviewer') {
        const labels = JSON.parse(request.messages[1].content).resumes.map(r => r.label);
        return { winner: labels[0], scores: labels.map(label => ({ label, criteria: Array.from({ length: 4 }, () => ({ score: 4, reason: 'Matches JD', jd_lines: [1] })) })) };
      }
      throw new Error('Unexpected model stage');
    },
    render: async (_root, dir, c) => {
      const pdf = path.join(dir, 'resume.pdf'); writeAtomic(pdf, '%PDF-test-candidate');
      return { pdf, pdf_sha256: fileHash(pdf), reviewText: buildHtml(TEMPLATE, c, bank, 'a4').reviewText, gates: { ok: true, errors: [] }, ats: { score: 90 } };
    },
  };
  return { root, options, dependencies, calls: () => calls };
}

test('end-to-end mocked preparation, explicit approval, immutable upload, outcome-preserving submission log', async t => {
  const f = fixture(t), out = await prepare(f.root, f.options, f.dependencies);
  assert.equal(out.status, 'awaiting_approval'); assert.equal(out.winner, 'master'); assert.equal(f.calls(), 6);
  assert.equal(fs.readFileSync(path.join(f.root, 'cv.md'), 'utf8'), MASTER);
  assert.equal(fs.existsSync(path.join(f.root, 'data/pdf-index.tsv')), false);
  assert.throws(() => requireApproval(f.root, f.options.url), /approve/);
  const manifest = readJson(path.join(path.dirname(out.packet), 'manifest.json'));
  const sha = manifest.entries[0].pdf_sha256;
  await assert.rejects(approve(f.root, out.application, out.run, sha), /acknowledge/);
  await approve(f.root, out.application, out.run, sha, { acknowledgeWarnings: true });
  assert.equal(status(f.root, out.application).status, 'approved');
  const approved = requireApproval(f.root, f.options.url + '/application');
  assert.equal(hash(approved.upload.buffer), sha);
  assert.throws(() => requireApproval(f.root, 'https://jobs.ashbyhq.com/sample/req2'), /approve/);
  const logfile = path.join(f.root, 'data/applications/log.csv'), rows = parseCsv(fs.readFileSync(logfile, 'utf8'));
  assert.equal(rows[1][8], '');
  rows[1][10] = 'Recruiter said "hello", follow up\nnext week'; writeAtomic(logfile, serializeCsv(rows));
  await assert.rejects(recordSubmitted(f.root, out.application, sha, false), /confirmation/);
  await recordSubmitted(f.root, out.application, sha, true);
  const final = parseCsv(fs.readFileSync(logfile, 'utf8'));
  assert.equal(final[1][9], sha); assert.equal(final[1][10], rows[1][10]);
  assert.throws(() => requireApproval(f.root, f.options.url), /No active/);
  await assert.rejects(approve(f.root, out.application, out.run, sha, { acknowledgeWarnings: true }), /already recorded/);
  await assert.rejects(prepare(f.root, f.options, f.dependencies), /already recorded/);
});

test('stale master, changed PDF, newer run and revocation invalidate approval', async t => {
  const f = fixture(t), out = await prepare(f.root, f.options, f.dependencies);
  const m = readJson(path.join(path.dirname(out.packet), 'manifest.json')), sha = m.entries[0].pdf_sha256;
  const a = await approve(f.root, out.application, out.run, sha, { acknowledgeWarnings: true });
  writeAtomic(a.file, '%PDF-tampered');
  assert.throws(() => requireApproval(f.root, f.options.url), /bytes changed/);
  writeAtomic(a.file, '%PDF-test-master');
  writeAtomic(path.join(f.root, 'cv.md'), MASTER + '\n');
  assert.throws(() => requireApproval(f.root, f.options.url), /changed input/);
  writeAtomic(path.join(f.root, 'cv.md'), MASTER);
  await revoke(f.root, out.application);
  assert.throws(() => requireApproval(f.root, f.options.url), /No active/);
  writeJson(path.join(appDir(f.root, out.application), 'active-run.json'), { run: 'newer' });
  await assert.rejects(approve(f.root, out.application, out.run, sha, { acknowledgeWarnings: true }), /newer preparation/);
});

test('unapproved bank and referral protection stop before model calls', async t => {
  const f = fixture(t);
  writeAtomic(path.join(f.root, 'data/fact_bank.yaml'), yaml.dump(bank));
  await assert.rejects(prepare(f.root, f.options, f.dependencies), /approved/);
  assert.equal(f.calls(), 0);
  writeAtomic(path.join(f.root, 'data/fact_bank.yaml'), yaml.dump({ ...bank, status: 'approved' }));
  await assert.rejects(prepare(f.root, { ...f.options, company: 'Protected Company' }, f.dependencies), /Referral protection/);
  assert.equal(f.calls(), 0);
});

test('failed parser cannot publish a winner or leave prior approval usable', async t => {
  const f = fixture(t), first = await prepare(f.root, f.options, f.dependencies);
  const m = readJson(path.join(path.dirname(first.packet), 'manifest.json'));
  await approve(f.root, first.application, first.run, m.entries[0].pdf_sha256, { acknowledgeWarnings: true });
  const failed = await prepare(f.root, f.options, { ...f.dependencies, transport: async () => ({}) });
  assert.equal(failed.status, 'failed'); assert.equal(failed.winner, null);
  assert.throws(() => requireApproval(f.root, f.options.url), /No active/);
});

test('all candidates rejected still permits the valid unchanged master', async t => {
  const f = fixture(t), originalTransport = f.dependencies.transport;
  f.dependencies.transport = async (request, stage) => stage === 'writer' ? {} : originalTransport(request, stage);
  const result = await prepare(f.root, f.options, f.dependencies);
  const m = readJson(path.join(path.dirname(result.packet), 'manifest.json'));
  assert.equal(result.winner, 'master');
  assert.equal(m.entries.filter(e => e.passed).length, 1);
  assert.equal(m.entries.filter(e => e.errors?.length).length, 3);
});

test('reviewer disagreement stays unselected until the user explicitly chooses a passing PDF', async t => {
  const f = fixture(t), originalTransport = f.dependencies.transport;
  let writer = 0, reviewer = 0;
  f.dependencies.transport = async (request, stage) => {
    if (stage === 'writer') {
      if (++writer > 1) return {};
      return mutate('dashboard', 'Built a React dashboard.');
    }
    if (stage === 'claim') return { supported: true, issue: '' };
    if (stage === 'reviewer') {
      const resumes = JSON.parse(request.messages[1].content).resumes;
      const variant = resumes.find(r => JSON.stringify(r.sections).includes('Built a React dashboard.'));
      const unchanged = resumes.find(r => r.label !== variant.label);
      const winner = (++reviewer === 1 ? variant : unchanged).label;
      return { winner, scores: resumes.map(r => ({ label: r.label, criteria: Array.from({ length: 4 }, () => ({ score: r.label === winner ? 5 : 3, reason: 'Evidence for responsibilities', jd_lines: [1] })) })) };
    }
    return originalTransport(request, stage);
  };
  const result = await prepare(f.root, f.options, f.dependencies);
  assert.equal(result.status, 'needs_review'); assert.equal(result.winner, null);
  const m = readJson(path.join(path.dirname(result.packet), 'manifest.json'));
  const sha = m.entries.find(e => e.id === 'candidate-1').pdf_sha256;
  await assert.rejects(approve(f.root, result.application, result.run, sha, { acknowledgeWarnings: true }), /Resolve reviewer disagreement/);
  await approve(f.root, result.application, result.run, sha, { acknowledgeWarnings: true, selected: 'candidate-1', resolveDisagreement: true });
  assert.equal(requireApproval(f.root, f.options.url).record.candidate, 'candidate-1');
  writeJson(path.join(f.root, 'data/applications/by-report/9.json'), result);
  const preview = previewReport(f.root, '009');
  assert.equal(preview.status, 'approved-for-this-job');
  assert.equal(fileHash(preview.path), sha);
});

test('review timeout creates a failed packet, not an automatic master approval', async t => {
  const f = fixture(t), originalTransport = f.dependencies.transport;
  f.dependencies.transport = async (request, stage) => { if (stage === 'reviewer') throw new Error('timeout'); return originalTransport(request, stage); };
  const result = await prepare(f.root, f.options, f.dependencies);
  assert.equal(result.status, 'failed'); assert.equal(result.winner, null);
  assert.throws(() => requireApproval(f.root, f.options.url), /approve/);
});

test('changing the original saved JD invalidates an otherwise matching PDF', async t => {
  const f = fixture(t), result = await prepare(f.root, f.options, f.dependencies);
  const m = readJson(path.join(path.dirname(result.packet), 'manifest.json'));
  await approve(f.root, result.application, result.run, m.entries[0].pdf_sha256, { acknowledgeWarnings: true });
  writeAtomic(f.options.jdFile, RAW + '\nChanged eligibility.');
  assert.throws(() => requireApproval(f.root, f.options.url), /changed input/);
});

test('concurrent CSV updates retain both applications', async t => {
  const f = fixture(t);
  await Promise.all(['one', 'two'].map(id => updateLog(f.root, { id, company: 'Example, Inc.', role: 'Engineer', date: '2026-10-01' }, { status: 'awaiting_approval' })));
  const rows = parseCsv(fs.readFileSync(path.join(f.root, 'data/applications/log.csv'), 'utf8'));
  assert.deepEqual(rows.slice(1).map(r => r[0]).sort(), ['one', 'two']);
});
