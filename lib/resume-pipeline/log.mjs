import fs from 'node:fs';
import { withPipelineLock } from '../../pipeline-lock.mjs';
import { contained, writeAtomic } from './io.mjs';

export const COLUMNS = ['application_id', 'run_id', 'company', 'role', 'date', 'status', 'approved_file', 'approved_sha256', 'file_submitted', 'submitted_sha256', 'outcome'];
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else {
      if (closed || c === '"') throw new Error('Malformed CSV');
      cell += c;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || closed || row.length) rows.push([...row, cell]);
  return rows;
}
const safe = value => /^[\s]*[=+\-@\t\r]/.test(String(value)) ? `'${value}` : String(value);
export const serializeCsv = rows => rows.map(row => row.map(v => `"${safe(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';

export async function updateLog(root, application, patch) {
  const file = contained(root, 'data/applications/log.csv');
  fs.mkdirSync(contained(root, 'data/applications'), { recursive: true });
  await withPipelineLock(file, async () => {
    const rows = fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : [COLUMNS];
    if (JSON.stringify(rows[0]) !== JSON.stringify(COLUMNS) || rows.some(r => r.length !== COLUMNS.length)) throw new Error('Application CSV header/row mismatch; refusing to overwrite');
    let index = rows.findIndex((r, i) => i > 0 && r[0] === application.id);
    if (index < 0) { index = rows.length; rows.push(COLUMNS.map(() => '')); }
    const before = Object.fromEntries(COLUMNS.map((c, i) => [c, rows[index][i]]));
    // Outcome is user-owned. Preparing/approving never means submitted.
    const after = { ...before, application_id: application.id, company: application.company, role: application.role, date: application.date, ...patch, outcome: before.outcome };
    rows[index] = COLUMNS.map(c => after[c] ?? '');
    writeAtomic(file, serializeCsv(rows));
  });
}
