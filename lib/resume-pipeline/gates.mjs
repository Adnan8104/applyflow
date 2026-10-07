import { candidateSchema, claimSchema } from './contracts.mjs';
import { isDeepStrictEqual } from 'node:util';
import { quantities, toolsIn, leadingVerb, plain } from './facts.mjs';

export function checkCandidate(candidate, bank) {
  const errors = [], warnings = [];
  try { candidateSchema(candidate); } catch (e) { return { ok: false, errors: [e.message], warnings }; }
  if (!isDeepStrictEqual(candidate.immutable, bank.immutable)) errors.push('Immutable fields changed');
  const categories = new Set();
  for (const s of candidate.skills) {
    const source = bank.skills_allowlist.find(x => x.category === s.category);
    if (categories.has(s.category) || !source || new Set(s.items).size !== s.items.length || s.items.some(v => !source.items.includes(v))) errors.push(`Skills outside allowlist: ${s.category}`);
    categories.add(s.category);
  }
  const seen = new Set();
  for (const b of candidate.bullets) {
    const src = bank.bullets.find(s => s.id === b.source_id);
    if (!src || seen.has(b.source_id)) { errors.push(`Unknown or duplicate source_id: ${b.source_id}`); continue; }
    seen.add(b.source_id);
    if (b.edit_type === 'dropped') continue;
    if (['kept', 'reordered'].includes(b.edit_type) && b.final_text !== src.original_text) errors.push(`${src.id}: unacknowledged rephrase`);
    for (const q of quantities(b.final_text)) if (!src.metrics.some(m => m.text === q)) errors.push(`${src.id}: unsupported quantity ${q}`);
    // A retained bullet cannot quietly strip its measurable outcome or qualifier.
    for (const m of src.metrics) if (!quantities(b.final_text).includes(m.text)) errors.push(`${src.id}: lost quantity ${m.text}`);
    for (const qualifier of ['estimated', 'approximately', 'up to']) {
      if (src.original_text.toLowerCase().includes(qualifier) && !b.final_text.toLowerCase().includes(qualifier)) errors.push(`${src.id}: lost qualifier ${qualifier}`);
    }
    for (const tool of toolsIn(b.final_text)) if (!src.technologies.includes(tool)) errors.push(`${src.id}: unsupported technology ${tool}`);
    if (b.edit_type === 'rephrased') {
      if (!src.allowed_verbs.some(v => v.toLowerCase() === leadingVerb(b.final_text).toLowerCase())) warnings.push(`${src.id}: leading verb not approved`);
      if (/\bcustom\b/i.test(b.final_text) && !/\bcustom\b/i.test(src.original_text)) warnings.push(`${src.id}: new custom-ownership claim`);
      if (/^(led|owned|architected|spearheaded|optimized)\b/i.test(b.final_text) && !/^(led|owned|architected|spearheaded|optimized)\b/i.test(src.original_text)) warnings.push(`${src.id}: possible ownership/scope escalation`);
      const newWords = (b.final_text.match(/\b[A-Z][A-Za-z0-9+#.]+\b/g) || []).filter(w => !plain(src.original_text).includes(w) && w !== leadingVerb(b.final_text));
      if (newWords.length) warnings.push(`${src.id}: new named terms need review: ${[...new Set(newWords)].join(', ')}`);
    }
  }
  if (seen.size !== bank.bullets.length) errors.push('Every source bullet must be retained or explicitly dropped');
  return { ok: !errors.length, errors, warnings };
}

export async function checkClaims(candidate, bank, call) {
  const effective = structuredClone(candidate), results = [];
  for (const b of effective.bullets.filter(b => b.edit_type === 'rephrased')) {
    const src = bank.bullets.find(s => s.id === b.source_id);
    let verdict;
    try { verdict = claimSchema(await call({ original_text: src.original_text, final_text: b.final_text })); }
    catch (e) { verdict = { supported: false, issue: `Unverified: ${e.message}` }; }
    results.push({ source_id: b.source_id, proposed_text: b.final_text, ...verdict, reverted: !verdict.supported });
    if (!verdict.supported) {
      b.final_text = src.original_text; b.edit_type = 'kept'; b.reason = `Reverted: ${verdict.issue}`;
    }
  }
  return { effective, results, gates: checkCandidate(effective, bank) };
}

export function normalizePdfText(s) {
  return plain(s).normalize('NFKC').replace(/([A-Za-z])-\s*\n\s*(?=[a-z])/g, '$1-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/[\u2022\u00b7]/g, '').replace(/\s+/g, ' ').trim();
}

export function checkPdf(extracted, expected) {
  const errors = [];
  if (extracted.pages !== 1) errors.push(`PDF must be exactly one page, found ${extracted.pages}`);
  const text = normalizePdfText(extracted.text || '').toLowerCase();
  let cursor = 0;
  for (const block of expected) {
    const needle = normalizePdfText(block).toLowerCase();
    if (!needle) continue;
    const at = text.indexOf(needle, cursor);
    if (at < 0) errors.push(`Missing or out-of-order PDF block: ${needle.slice(0, 90)}`);
    else cursor = at + needle.length;
  }
  if (!Array.isArray(extracted.lines) || !extracted.lines.length) errors.push('PDF coordinates missing');
  else {
    let lastY = -Infinity;
    for (const line of extracted.lines) {
      if (![line.x, line.y, line.width, line.height].every(Number.isFinite) || line.x < -1 || line.y < -1 || line.x + line.width > extracted.width + 1 || line.y + line.height > extracted.height + 1) errors.push('PDF text outside page bounds');
      if (line.y + 3 < lastY) errors.push('PDF reading order goes backwards (detached title or columns)');
      lastY = Math.max(lastY, line.y);
    }
  }
  return { ok: !errors.length, errors: [...new Set(errors)] };
}
