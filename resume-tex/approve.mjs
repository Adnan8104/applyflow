#!/usr/bin/env node
// Approve a tailored LaTeX resume for one job so the apply flow may attach it.
//
//   node resume-tex/approve.mjs --url <job URL> --company <name> --role <title> --pdf output/<job>/resume.pdf
//
// The PDF is rebuilt from the .tex next to it after the checker passes (approved
// bullets, master layout, one page, readable text), then bound to that exact job URL
// and to the source and library it came from. Any later change voids the approval.
// This never fills or submits anything.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main-module.mjs';
import { checkTex } from './check.mjs';
import { approveLatex, greenhouseJobId } from '../lib/resume-pipeline/approval.mjs';
import { normalizeUrl } from '../url-key.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLIED = /^(applied|responded|interview|offer|hired|rejected)$/i;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Tracker rows that already record an application to this job: same normalized
// URL, same Greenhouse job ID, or same company + role. Catches applications made
// from another session (Codex, by hand) that this approval store never saw.
export function priorApplications(root, { url, company, role }) {
  const file = path.join(root, 'data/applications.md');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const header = lines.find(l => /^\|\s*#\s*\|/.test(l));
  if (!header) return [];
  const cols = header.split('|').map(c => c.trim().toLowerCase());
  const at = (cells, name) => cells[cols.indexOf(name)] ?? '';
  let key = ''; try { key = normalizeUrl(url); } catch {}
  const gh = greenhouseJobId(url, { anyHost: true });
  return lines.filter(l => /^\|\s*\d+\s*\|/.test(l)).map(l => l.split('|').map(c => c.trim())).filter(c => APPLIED.test(at(c, 'status'))).filter(c => {
    const u = at(c, 'url');
    let same = false; try { same = !!u && !!key && normalizeUrl(u) === key; } catch {}
    const sameGh = !!gh && !!u && greenhouseJobId(u, { anyHost: true }) === gh;
    const sameJob = norm(at(c, 'company')) === norm(company) && norm(at(c, 'role')) === norm(role);
    return same || sameGh || sameJob;
  }).map(c => `#${at(c, '#')} ${at(c, 'company')} - ${at(c, 'role')} (${at(c, 'status')}, ${at(c, 'date')})`);
}

export async function approveTex({ url, company, role, pdf, root = ROOT, allowReapply = false, checkCompile = true, compile = tex => execFileSync('tectonic', ['-X', 'compile', tex], { stdio: 'pipe', timeout: 180000 }) }) {
  if (!url || !pdf) throw new Error('Usage: node resume-tex/approve.mjs --url <job URL> --company <name> --role <title> --pdf output/<job>/resume.pdf');
  const prior = priorApplications(root, { url, company, role });
  if (prior.length && !allowReapply) throw new Error(`Already applied to this job according to data/applications.md:\n${prior.map(p => `- ${p}`).join('\n')}\nNothing approved. Re-run with --allow-reapply only if you really mean to apply again.`);
  const pdfPath = path.resolve(root, pdf);
  if (!pdfPath.endsWith('.pdf')) throw new Error('--pdf must point to a .pdf');
  const tex = pdfPath.replace(/\.pdf$/, '.tex');
  if (!fs.existsSync(tex)) throw new Error(`No LaTeX source next to the PDF: ${path.relative(root, tex)}`);
  const problems = checkTex(tex, { root, compile: checkCompile });
  if (problems.length) throw new Error(`Resume check failed; nothing approved:\n${problems.map(p => `- ${p}`).join('\n')}`);
  compile(tex); // the approved bytes are the ones built from the checked source
  if (!fs.existsSync(pdfPath)) throw new Error('Compile did not produce the PDF');
  return approveLatex(root, { url, company, role, tex: path.relative(root, tex), pdf: path.relative(root, pdfPath) });
}

if (isMainModule(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
  try {
    const out = await approveTex({ url: arg('url'), company: arg('company'), role: arg('role'), pdf: arg('pdf'), allowReapply: process.argv.includes('--allow-reapply') });
    console.log(`Approved ${path.relative(ROOT, out.file)} (sha256 ${out.sha256.slice(0, 12)}…) for this job only.`);
    console.log('The apply flow may now fill the form and attach this exact PDF. It never submits; you review and submit.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
