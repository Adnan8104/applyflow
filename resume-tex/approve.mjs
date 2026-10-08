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
import { approveLatex } from '../lib/resume-pipeline/approval.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function approveTex({ url, company, role, pdf, root = ROOT, checkCompile = true, compile = tex => execFileSync('tectonic', ['-X', 'compile', tex], { stdio: 'pipe', timeout: 180000 }) }) {
  if (!url || !pdf) throw new Error('Usage: node resume-tex/approve.mjs --url <job URL> --company <name> --role <title> --pdf output/<job>/resume.pdf');
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
    const out = await approveTex({ url: arg('url'), company: arg('company'), role: arg('role'), pdf: arg('pdf') });
    console.log(`Approved ${path.relative(ROOT, out.file)} (sha256 ${out.sha256.slice(0, 12)}…) for this job only.`);
    console.log('The apply flow may now fill the form and attach this exact PDF. It never submits; you review and submit.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
