import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { renderHtmlToPdf } from '../../generate-pdf.mjs';
import { auditAts } from '../../verify-ats.mjs';
import { hash, fileHash, contained, writeAtomic } from './io.mjs';
import { plain } from './facts.mjs';
import { checkPdf } from './gates.mjs';

const escape = s => plain(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HERE = path.dirname(fileURLToPath(import.meta.url));

// Map source sections to existing Jake classes, preserving every immutable line.
// The legacy builder's fixed slots cannot represent separate research/venture sections.
export function projection(candidate, bank) {
  const sections = candidate.immutable.sections.map(s => ({
    title: s.title, lines: s.lines,
    entries: s.entries.map(e => ({
      label: e.label, dates: e.dates, details: e.details,
      bullets: candidate.bullets.filter(b => b.edit_type !== 'dropped' && bank.bullets.find(f => f.id === b.source_id)?.entry_id === e.id).map(b => b.final_text),
    })),
    bullets: candidate.bullets.filter(b => b.edit_type !== 'dropped' && bank.bullets.find(f => f.id === b.source_id)?.entry_id === s.id).map(b => b.final_text),
    skills: /skills/i.test(s.title) ? candidate.skills : [],
  }));
  return { header: candidate.immutable.header, sections };
}

// Pipeline-only spacing override from config.render.layout_css, applied after the
// template CSS. Local rules only: no markup, imports or external resources.
export function layoutCss(root, config) {
  if (!config.render.layout_css) return '';
  const css = fs.readFileSync(contained(root, config.render.layout_css), 'utf8');
  if (/<|@import|url\s*\(|expression\s*\(/i.test(css)) throw new Error('Layout CSS may contain only local style rules');
  return css;
}

export function buildHtml(template, candidate, bank, format, layout = '') {
  if (!template.includes('class="page"') || !template.includes('.job-header') || !template.includes('.section-title')) throw new Error('Source-section adapter currently supports the Jake template only');
  const view = projection(candidate, bank), expected = [];
  const name = plain(view.header[0]).replace(/^# (?:CV -- )?/, '');
  expected.push(name);
  const contact = view.header.slice(1).map(s => plain(s).replace(/^Contact:\s*/, ''));
  expected.push(...contact);
  const header = `<div class="header"><h1>${escape(name)}</h1>${contact.map(s => `<div class="contact-row">${escape(s)}</div>`).join('')}</div>`;
  const list = bullets => {
    expected.push(...bullets);
    return bullets.length ? `<ul>${bullets.map(b => `<li>${escape(b)}</li>`).join('')}</ul>` : '';
  };
  const sections = view.sections.map(s => {
    expected.push(s.title, ...s.lines);
    const entries = s.entries.map(e => {
      expected.push(e.label, e.dates, ...e.details);
      return `<div class="job"><div class="job-header"><span class="job-company">${escape(e.label)}</span><span class="job-period">${escape(e.dates)}</span></div>${e.details.map(d => `<div class="job-subheader"><div class="job-role">${escape(d)}</div></div>`).join('')}${list(e.bullets)}</div>`;
    }).join('');
    const loose = list(s.bullets);
    const skills = s.skills.map(s => { const text = `${s.category}: ${s.items.join(', ')}`; expected.push(text); return `<div class="skill-item"><span class="skill-category">${escape(s.category)}:</span> ${s.items.map(escape).join(', ')}</div>`; }).join('');
    return `<div class="section"><div class="section-title">${escape(s.title)}</div>${s.lines.map(l => `<div>${escape(l)}</div>`).join('')}${entries}${loose}${skills}</div>`;
  }).join('\n');
  // Reuse the complete existing head/CSS; only the reviewed layout override follows it.
  let head = template.slice(0, template.indexOf('<body>')).replaceAll('{{LANG}}', 'en').replaceAll('{{NAME}}', escape(name)).replaceAll('{{PAGE_WIDTH}}', format === 'a4' ? '210mm' : '8.5in');
  if (!head.includes('</head>') || /\{\{/.test(head)) throw new Error('Unsupported template head');
  if (layout) head = head.replace('</head>', `<style id="resume-pipeline-layout">\n${layout}\n</style>\n</head>`);
  return { html: `${head}<body><div class="page">${header}\n${sections}</div></body></html>`, expected, reviewText: view };
}

export function extractPdf(file, config) {
  return JSON.parse(execFileSync(config.render.extraction_python, [path.join(HERE, 'extract-pdf.py'), file], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 }));
}

export function checkBaseline(root, config, masterHash) {
  const r = config.render;
  if (!r.approved_template_sha256 || !r.approved_baseline_pdf || !r.approved_baseline_sha256 || !r.approved_master_sha256) throw new Error('Approve an unchanged-master layout baseline in config/resume-pipeline.yml before prepare');
  if (r.layout_css && fileHash(contained(root, r.layout_css)) !== r.approved_layout_sha256) throw new Error('Approved layout changed or not pinned; review and pin a new baseline');
  if (fileHash(contained(root, r.template)) !== r.approved_template_sha256 || fileHash(contained(root, r.approved_baseline_pdf)) !== r.approved_baseline_sha256 || masterHash !== r.approved_master_sha256) throw new Error('Approved master/template/baseline changed; review and pin a new baseline');
}

export async function renderCandidate(root, dir, candidate, bank, config) {
  const built = buildHtml(fs.readFileSync(contained(root, config.render.template), 'utf8'), candidate, bank, config.render.format, layoutCss(root, config));
  const html = path.join(dir, 'resume.html'), pdf = path.join(dir, 'resume.pdf');
  writeAtomic(html, built.html);
  // This lower-level renderer does not invoke legacy blanket-omission/sibling rules.
  // The coordinator runs source gates before this call and extraction gates after.
  await renderHtmlToPdf(built.html, pdf, { workspaceRoot: root, baseDir: dir, inputPath: html, format: config.render.format, maxPages: 1, strictPages: true, styleTokens: {}, publishManifest: false });
  const extraction = extractPdf(pdf, config);
  const gates = checkPdf(extraction, built.expected);
  return { ...built, pdf, pdf_sha256: fileHash(pdf), html_sha256: hash(built.html), extraction, gates, ats: auditAts(built.html) };
}
