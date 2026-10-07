import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { hash, readYaml, contained, sourcePaths, VERSION } from './io.mjs';

// These are recognition terms, NOT permission to add a tool to a source bullet.
export const TECHNOLOGIES = ['Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'Swift', 'SQL', 'React Native', 'React', 'Kotlin', 'Spring Boot', 'Salesforce Apex', 'FastAPI', 'Django', 'Next.js', 'Node.js', 'GraphQL', 'LangGraph', 'LangChain', 'AutoGen', 'MCP', 'AppKit', 'Apache NiFi', 'PostgreSQL', 'MongoDB', 'ClickHouse', 'SQLite', 'Docker', 'Kubernetes', 'GCP', 'AWS', 'Azure', 'Semgrep', 'SonarQube', 'RabbitMQ', 'pandas', 'NumPy', 'Pydantic', 'asyncio', 'Recharts', 'OpenAI API', 'mem0', 'requests', 'BeautifulSoup', 'PyMuPDF', 'ExecuteSQL', 'ExecuteScript', 'Groovy', 'GLB', 'glTF', 'Draco', 'KTX2', 'SkyLight', 'CGEventTap', 'AXUIElement', 'macOS Accessibility API', 'DewaWeb', 'iSeller', 'Git', 'CI/CD'];
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function mentions(text, term) {
  return new RegExp(`(?<![\\w])${escapeRe(term)}(?![\\w])`, 'i').test(text);
}
// Longest names claim their text first, so "React Native" does not also count as "React".
export function toolsIn(text) {
  let rest = String(text);
  const found = new Set();
  for (const t of [...TECHNOLOGIES].sort((x, y) => y.length - x.length)) {
    if (!mentions(rest, t)) continue;
    found.add(t);
    rest = rest.replace(new RegExp(`(?<![\\w])${escapeRe(t)}(?![\\w])`, 'gi'), ' ');
  }
  return TECHNOLOGIES.filter(t => found.has(t));
}
export const plain = text => String(text).replace(/\*\*/g, '');

export function quantities(text) {
  // Preserve literal value/unit pairs; embedded identifiers (mem0, 3D, KTX2) are not quantities.
  const rx = /(?<![\w])(?:\$\d+(?:[.,]\d+)*(?:[KMB])?(?:\/(?:month|year|hour))?|\d+(?:\.\d+)?\+?(?:%|\s*(?:MB|GB|KB|ms|s)\b)?)(?![\w])/g;
  const values = [...text.matchAll(rx)].map(m => m[0]);
  // A number word counts when a listed noun follows directly, after a hyphen ("five-agent"),
  // or after up to two descriptive words ("six LLM providers"). Function words break the
  // chain so "one of the agents" and "one interface" are not quantities.
  const nouns = '(?:agents?|providers?|reviewers?|validators?|marketplaces?|failure modes|languages?|publications?|years?|months?)\\b';
  const between = '(?:\\s+(?!(?:of|the|a|an|and|or|to|in|on|for|with|per|by|from|at)\\b)[A-Za-z][\\w-]*){0,2}';
  const words = new RegExp(`\\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:-figure\\b|(?=-${nouns})|(?=${between}\\s+${nouns}))`, 'gi');
  return [...new Set([...values, ...[...text.matchAll(words)].map(m => m[0])])];
}
export function leadingVerb(text) {
  return plain(text).match(/^(?:Contributed to|Co-founded|Worked on|Responsible for|[A-Za-z]+(?:-[A-Za-z]+)?)/i)?.[0] || '';
}

export function extractBank(master) {
  const header = [], sections = [], bullets = [], skills = [];
  let section, entry;
  master.split(/\r?\n/).forEach((line, index) => {
    const h2 = /^## (.+)$/.exec(line), h3 = /^### (.+)$/.exec(line), bullet = /^[-*] (.+)$/.exec(line);
    if (h2) {
      section = { id: `s${sections.length + 1}`, title: h2[1], entries: [], lines: [] };
      sections.push(section); entry = undefined;
    } else if (h3 && section) {
      const heading = h3[1];
      const dm = /\b(?:Jan\.?|Feb\.?|Mar\.?|Apr\.?|May|Jun(?:e)?\.?|Jul(?:y)?\.?|Aug\.?|Sep(?:t)?\.?|Oct\.?|Nov\.?|Dec\.?|Fall|Spring|Summer|Winter)\s+\d{4}(?:\s*[-–—]\s*(?:(?:[A-Za-z]+\.?)\s+\d{4}|Present))?$/.exec(heading);
      entry = { id: `e${sections.flatMap(s => s.entries).length + 1}`, heading, details: [], dates: dm?.[0] || '', label: heading.slice(0, dm?.index ?? heading.length).trim(), source_line: index + 1 };
      section.entries.push(entry);
    } else if (bullet && section) {
      if (/skills/i.test(section.title)) {
        const m = /^\*\*(.+?):\*\*\s*(.*)$/.exec(bullet[1]);
        if (!m) throw new Error(`Unrecognized skills line ${index + 1}; review the master format`);
        skills.push({ category: m[1], items: m[2].split(/,\s*/).filter(Boolean) });
      } else {
        const original_text = bullet[1];
        const id = `b-${hash(`${section.id}|${entry?.id || ''}|${index + 1}|${original_text}`).slice(0, 12)}`;
        bullets.push({ id, section: section.title, entry_id: entry?.id || section.id, org: '', role: entry?.label || '', dates: entry?.dates || '', original_text, metrics: quantities(original_text).map(text => ({ text })), technologies: toolsIn(original_text), allowed_verbs: [leadingVerb(original_text)].filter(Boolean), alt_phrasings: [], source_line: index + 1 });
      }
    } else if (line.trim()) {
      if (!section) header.push(line);
      else (entry ? entry.details : section.lines).push(line);
    }
  });
  if (!header.length || !bullets.length || !skills.length) throw new Error('Master must have identity, bullet entries and categorized skills');
  for (const b of bullets) {
    const s = sections.find(s => s.title === b.section);
    const e = s.entries.find(e => e.id === b.entry_id);
    b.org = /projects|education/i.test(s.title) ? e?.label || '' : e?.details[0] || '';
  }
  return {
    schema_version: VERSION, status: 'needs_human_review', master_sha256: hash(master),
    review_notes: ['Review organization/location boundaries in immutable entry details.', 'Project heading stacks are immutable metadata, not permission to add those tools to individual bullets.', 'Only original leading verbs are seeded. Review any equal/weaker synonyms before adding them.'],
    immutable: { header, sections }, skills_allowlist: skills, bullets,
  };
}

export function validateBank(bank, master, approved = true, bankPath = 'data/fact_bank.yaml') {
  const expected = extractBank(master);
  if (bank?.schema_version !== VERSION || bank.master_sha256 !== hash(master)) throw new Error('Fact bank is stale or malformed; master changed');
  if (approved && bank.status !== 'approved') throw new Error(`Review ${bankPath} and set status: approved before generation`);
  for (const key of ['immutable', 'skills_allowlist']) {
    if (JSON.stringify(bank[key]) !== JSON.stringify(expected[key])) throw new Error(`Fact bank ${key} no longer matches master`);
  }
  if (bank.bullets?.length !== expected.bullets.length) throw new Error('Missing fact-bank bullets');
  bank.bullets.forEach((b, i) => {
    for (const key of Object.keys(expected.bullets[i]).filter(k => !['allowed_verbs', 'alt_phrasings'].includes(k))) {
      if (JSON.stringify(b[key]) !== JSON.stringify(expected.bullets[i][key])) throw new Error(`Fact bank ${b.id} ${key} is not source-backed`);
    }
    if (!Array.isArray(b.allowed_verbs) || !b.allowed_verbs.every(v => typeof v === 'string' && /^[A-Za-z -]+$/.test(v)) || !b.allowed_verbs.includes(leadingVerb(b.original_text))) throw new Error(`Invalid allowed verbs: ${b.id}`);
    if (!Array.isArray(b.alt_phrasings) || b.alt_phrasings.length) throw new Error('Alternate phrasings are not supported in v1');
  });
  return bank;
}

export function loadBank(root) {
  const src = sourcePaths(root);
  const master = fs.readFileSync(contained(root, src.master), 'utf8');
  return { master, bank: validateBank(readYaml(contained(root, src.bank)), master, true, src.bank), source: src };
}

export function initBank(root) {
  const src = sourcePaths(root);
  const file = contained(root, src.bank);
  const bank = extractBank(fs.readFileSync(contained(root, src.master), 'utf8'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(bank, { lineWidth: 110, noRefs: true }), { flag: 'wx', mode: 0o600 });
  return { file, bullets: bank.bullets.length, status: bank.status };
}

export function masterCandidate(bank) {
  return { immutable: structuredClone(bank.immutable), skills: structuredClone(bank.skills_allowlist), bullets: bank.bullets.map(b => ({ source_id: b.id, edit_type: 'kept', final_text: b.original_text, reason: '' })) };
}
