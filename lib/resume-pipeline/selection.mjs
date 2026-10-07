import { randomInt } from 'node:crypto';
import { reviewSchema } from './contracts.mjs';
import { mentions } from './facts.mjs';

export function keywordCoverage(candidate, jd) {
  const text = [...candidate.bullets.filter(b => b.edit_type !== 'dropped').map(b => b.final_text), ...candidate.skills.flatMap(s => s.items)].join('\n');
  const terms = [...new Set(jd.stack_keywords.map(k => k.text))];
  const matched = terms.filter(t => mentions(text, t));
  return { matched, missing: terms.filter(t => !matched.includes(t)), total: terms.length, percent: terms.length ? Math.round(100 * matched.length / terms.length) : null };
}

export function blindSet(entries, previousOrder) {
  const items = [...entries];
  for (let i = items.length - 1; i > 0; i--) { const j = randomInt(i + 1); [items[i], items[j]] = [items[j], items[i]]; }
  if (items.length > 1 && previousOrder && items.every((e, i) => e.id === previousOrder[i])) items.push(items.shift());
  const mapping = Object.fromEntries(items.map((e, i) => [String.fromCharCode(65 + i), e.id]));
  return {
    mapping, order: items.map(e => e.id),
    // Remove edit metadata, source IDs and strategy; reviewers see only rendered order/content.
    resumes: items.map((e, i) => ({ label: String.fromCharCode(65 + i), sections: e.reviewText })),
  };
}

export function interpretReview(review, mapping, jd) {
  reviewSchema(review, Object.keys(mapping), jd);
  const totals = Object.fromEntries(review.scores.map(row => [mapping[row.label], row.criteria.reduce((sum, c) => sum + c.score, 0)]));
  const max = Math.max(...Object.values(totals));
  const ties = Object.keys(totals).filter(id => totals[id] === max);
  // A tied challenger cannot displace the master. Challenger-only ties need a human.
  const winner = ties.includes('master') ? 'master' : ties.length === 1 ? ties[0] : null;
  return { winner, totals, ties, mapping, review };
}

export function chooseWinner(reviews, margin) {
  if (reviews.length !== 2 || reviews.some(r => !r.winner)) return { status: 'needs_review', winner: null, reason: 'Incomplete review or tied challengers' };
  if (reviews[0].winner !== reviews[1].winner) return { status: 'needs_review', winner: null, reason: 'Independent reviewers disagree' };
  const pick = reviews[0].winner;
  const beatsMaster = pick !== 'master' && reviews.every(r => r.totals[pick] > r.totals.master && r.totals[pick] - r.totals.master >= margin);
  return { status: 'awaiting_approval', winner: beatsMaster ? pick : 'master', reason: beatsMaster ? `Both reviews favor this draft by at least ${margin} points` : 'No consistent improvement over the master at the required margin' };
}
