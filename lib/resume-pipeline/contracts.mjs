export function object(value, keys, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !(k in value))) throw new Error(`${where}: expected exactly ${keys.join(', ')}`);
}
export function text(value, where, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > 100000) throw new Error(`${where}: invalid text`);
}
export function candidateSchema(c) {
  object(c, ['immutable', 'skills', 'bullets'], 'candidate');
  if (!Array.isArray(c.bullets) || c.bullets.length > 200 || !Array.isArray(c.skills)) throw new Error('Invalid candidate lists');
  for (const b of c.bullets) {
    object(b, ['source_id', 'edit_type', 'final_text', 'reason'], 'bullet');
    text(b.source_id, 'source_id'); text(b.final_text, 'final_text', true); text(b.reason, 'reason', true);
    if (!['kept', 'reordered', 'rephrased', 'dropped'].includes(b.edit_type)) throw new Error('Invalid edit_type');
    if (b.edit_type === 'dropped' ? (b.final_text !== '' || !b.reason.trim()) : !b.final_text.trim()) throw new Error('Dropped bullets need empty text and a reason; retained bullets need text');
  }
  for (const s of c.skills) {
    object(s, ['category', 'items'], 'skills'); text(s.category, 'category');
    if (!Array.isArray(s.items) || s.items.some(i => typeof i !== 'string' || !i.trim())) throw new Error('Invalid skills');
  }
  return c;
}

export const JD_KEYS = ['must_haves', 'nice_to_haves', 'stack_keywords', 'responsibilities', 'knockout_constraints'];
export function jdSchema(jd, raw) {
  object(jd, JD_KEYS, 'JD');
  const lines = raw.split(/\r?\n/);
  for (const key of JD_KEYS) {
    if (!Array.isArray(jd[key]) || jd[key].length > 100) throw new Error(`Invalid JD ${key}`);
    for (const item of jd[key]) {
      object(item, ['text', 'line', 'quote', 'certainty'], key);
      text(item.text, key); text(item.quote, 'quote');
      if (!Number.isInteger(item.line) || !lines[item.line - 1]?.includes(item.quote)) throw new Error('JD source quote/line is unsupported');
      if (!['explicit', 'ambiguous'].includes(item.certainty)) throw new Error('Invalid JD certainty');
    }
  }
  if (!jd.responsibilities.length || !jd.must_haves.length) throw new Error('JD parsing incomplete: responsibilities and requirements required');
  return jd;
}

export function claimSchema(c) {
  object(c, ['supported', 'issue'], 'claim check');
  if (typeof c.supported !== 'boolean') throw new Error('Invalid claim verdict');
  text(c.issue, 'issue', c.supported);
  return c;
}

export function reviewSchema(r, labels, jd) {
  object(r, ['winner', 'scores'], 'review');
  if (!labels.includes(r.winner) || !Array.isArray(r.scores) || r.scores.length !== labels.length) throw new Error('Incomplete reviewer result');
  const seen = new Set(), lines = new Set(Object.values(jd).flat().map(x => x.line));
  for (const row of r.scores) {
    object(row, ['label', 'criteria'], 'review row');
    if (!labels.includes(row.label) || seen.has(row.label)) throw new Error('Unknown/duplicate review label');
    seen.add(row.label);
    if (!Array.isArray(row.criteria) || row.criteria.length !== 4) throw new Error('Four rubric criteria required');
    for (const c of row.criteria) {
      object(c, ['score', 'reason', 'jd_lines'], 'criterion'); text(c.reason, 'reason');
      if (!Number.isInteger(c.score) || c.score < 1 || c.score > 5 || !Array.isArray(c.jd_lines) || !c.jd_lines.length || c.jd_lines.some(n => !lines.has(n))) throw new Error('Invalid rubric score or JD citation');
    }
  }
  const total = row => row.criteria.reduce((s, c) => s + c.score, 0);
  if (total(r.scores.find(s => s.label === r.winner)) < Math.max(...r.scores.map(total))) throw new Error('Reviewer winner contradicts rubric totals');
  return r;
}
