#!/usr/bin/env node
// Checks a LaTeX resume against the approved bullet library and the master layout.
//
//   node resume-tex/check.mjs <file.tex> [--no-compile]
//   node resume-tex/check.mjs --hook        (Claude Code PostToolUse: reads tool JSON on stdin)
//
// Master: resume.tex (layout, headings and contact block are compared against it).
// Library: data/resume-variants.md (approved bullets, groups, skills, banned phrases).
// Exit 0 = OK; exit 1 (CLI) or 2 (hook) = problems, one per line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main-module.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ws = s => s.replace(/\s+/g, ' ').trim();

export function parseLibrary(text) {
  const [approvedPart, pendingPart = ''] = text.split(/^# Pending\b.*$/m);
  const bullets = new Map(), pending = new Map();
  const read = (part, into) => {
    let group = null, last = null;
    for (const line of part.split('\n')) {
      const g = line.match(/^\[([A-Z0-9-]+)\]\s*$/);
      if (g) { group = g[1]; continue; }
      if (/^## /.test(line)) { group = null; continue; }
      const c = line.match(/^\s+covers:\s*([A-Z0-9-]+)\s*$/);
      if (c && last) { last.covers.push(c[1]); continue; }
      const b = line.match(/^- (.+)$/);
      if (b && group) { last = { group, covers: [] }; into.set(ws(b[1]), last); }
    }
  };
  read(approvedPart, bullets);
  read(pendingPart, pending);
  const section = name => (approvedPart.match(new RegExp(`^## ${name}\\n([\\s\\S]*?)(?=^## |^# |$(?![\\s\\S]))`, 'm')) || [])[1] || '';
  const skills = new Set(section('Skills allowlist').split('\n')
    .map(l => l.replace(/^Only when the job asks for them \(no supporting bullet\):/, ''))
    .flatMap(l => l.split(',')).map(ws).filter(Boolean));
  const banned = section('Banned phrases').split('\n').map(l => l.match(/^- (.+)$/)?.[1]).filter(Boolean).map(ws);
  return { bullets, pending, skills, banned };
}

// Brace-balanced arguments following each occurrence of a command.
function commandArgs(body, name, count) {
  const out = [];
  const rx = new RegExp(`\\\\${name}(?![A-Za-z])`, 'g');
  let m;
  while ((m = rx.exec(body))) {
    let i = m.index + m[0].length;
    const args = [];
    while (args.length < count) {
      while (/\s/.test(body[i])) i++;
      if (body[i] !== '{') break;
      let depth = 0, start = i;
      for (; i < body.length; i++) {
        if (body[i] === '\\') { i++; continue; }
        if (body[i] === '{') depth++;
        else if (body[i] === '}' && --depth === 0) break;
      }
      args.push(ws(body.slice(start + 1, i)));
      i++;
    }
    if (args.length === count) out.push(args);
  }
  return out;
}

const stripComments = s => s.split('\n').map(l => l.replace(/(^|[^\\])%.*$/, '$1')).join('\n');
const split = tex => {
  const at = tex.indexOf('\\begin{document}');
  if (at < 0) throw new Error('no \\begin{document}');
  return { preamble: tex.slice(0, at), body: stripComments(tex.slice(at)) };
};

export function checkTex(file, { root = ROOT, compile = true } = {}) {
  const problems = [];
  const tex = fs.readFileSync(file, 'utf8');
  const masterPath = path.join(root, 'resume.tex');
  const isMaster = path.resolve(file) === path.resolve(masterPath);
  const libPath = path.join(root, 'data/resume-variants.md');
  if (!fs.existsSync(libPath)) return ['No approved bullet library at data/resume-variants.md'];
  const lib = parseLibrary(fs.readFileSync(libPath, 'utf8'));
  let doc;
  try { doc = split(tex); } catch (e) { return [e.message]; }

  // Bullets: exact approved text, at most one per fact group.
  const used = new Map();
  for (const [raw] of commandArgs(doc.body, 'resumeItem', 1)) {
    const text = ws(raw), hit = lib.bullets.get(text);
    if (!hit) {
      const p = lib.pending.get(text);
      problems.push(p ? `Bullet uses PENDING wording [${p.group}]; approve it first: "${text.slice(0, 70)}…"`
                      : `Bullet not in approved library (reworded or new): "${text.slice(0, 70)}…"`);
      continue;
    }
    for (const g of [hit.group, ...hit.covers]) {
      if (used.has(g)) problems.push(`Two bullets state the same fact [${g}]: "${used.get(g).slice(0, 40)}…" and "${text.slice(0, 40)}…"`);
      else used.set(g, text);
    }
  }

  const lowered = doc.body.toLowerCase();
  for (const phrase of lib.banned) if (lowered.includes(phrase.toLowerCase())) problems.push(`Banned phrase: "${phrase}"`);

  // Skills lines: \textbf{Category}{: a, b, c}
  for (const [cat, items] of commandArgs(doc.body.slice(doc.body.indexOf('Technical Skills')), 'textbf', 2).filter(([, v]) => v.startsWith(':'))) {
    for (const item of items.slice(1).split(',').map(s => ws(s).replace(/\\&/g, '&')).filter(Boolean)) {
      if (!lib.skills.has(item)) problems.push(`Skill not in allowlist (${cat}): "${item}"`);
    }
  }

  if (!isMaster && fs.existsSync(masterPath)) {
    const master = split(fs.readFileSync(masterPath, 'utf8'));
    if (doc.preamble !== master.preamble) problems.push('Layout changed: everything before \\begin{document} must match resume.tex exactly (geometry, spacing, fonts, commands)');
    const block = s => ws((s.match(/\\begin\{center\}([\s\S]*?)\\end\{center\}/) || [])[1] || '');
    if (block(doc.body) !== block(master.body)) problems.push('Name/contact block differs from resume.tex');
    for (const [cmd, n] of [['resumeSubheading', 4], ['resumeProjectHeading', 2]]) {
      const known = new Set(commandArgs(master.body, cmd, n).map(a => a.join(' ¦ ')));
      for (const args of commandArgs(doc.body, cmd, n)) {
        if (!known.has(args.join(' ¦ '))) problems.push(`Heading differs from resume.tex (title/dates/location/tech must be copied exactly): ${args.join(' | ').slice(0, 110)}`);
      }
    }
  }

  if (compile && !problems.length) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-check-'));
    try {
      execFileSync('tectonic', ['-X', 'compile', '--keep-logs', '--outdir', out, file], { stdio: 'pipe', timeout: 180000 });
      const log = fs.readFileSync(path.join(out, path.basename(file, '.tex') + '.log'), 'utf8');
      const pages = Number(log.match(/Output written on .*?\((\d+) pages?/)?.[1]);
      if (pages !== 1) problems.push(`PDF is ${pages || 'an unknown number of'} pages; must be exactly 1. Drop or swap bullets; never change spacing.`);
    } catch (e) {
      problems.push(`Does not compile with tectonic: ${String(e.stderr || e.message).split('\n').find(l => /error/i.test(l)) || e.message}`);
    } finally { fs.rmSync(out, { recursive: true, force: true }); }
  }
  return problems;
}

if (isMainModule(import.meta.url)) {
  const hook = process.argv.includes('--hook');
  let file = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (hook) {
    try { file = JSON.parse(fs.readFileSync(0, 'utf8'))?.tool_input?.file_path; } catch { process.exit(0); }
    if (!file || !file.endsWith('.tex') || !fs.existsSync(file)) process.exit(0);
  }
  if (!file) { console.error('Usage: node resume-tex/check.mjs <file.tex> [--no-compile] | --hook'); process.exit(1); }
  const problems = checkTex(file, { compile: !process.argv.includes('--no-compile') });
  if (!problems.length) { console.log(`OK ${path.relative(ROOT, path.resolve(file))}: approved bullets, master layout, one page`); process.exit(0); }
  const report = `resume check FAILED for ${file}:\n` + problems.map(p => `- ${p}`).join('\n');
  console.error(report);
  process.exit(hook ? 2 : 1);
}
