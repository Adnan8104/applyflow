import fs from 'node:fs';
import path from 'node:path';
import { configFor, contained, readJson, sourcePaths } from './io.mjs';
import { loadBank } from './facts.mjs';
import { checkBaseline } from './render.mjs';
import { appDir, runDir, applicationState } from './approval.mjs';

export function status(root, id) {
  if (id) {
    const dir = appDir(root, id);
    const { run } = readJson(path.join(dir, 'active-run.json'));
    const runPath = runDir(root, id, run);
    if (!fs.existsSync(path.join(runPath, 'manifest.json'))) return { application: id, run, status: 'preparing_or_interrupted' };
    const m = readJson(path.join(runPath, 'manifest.json'));
    return { application: id, run, status: applicationState(root, m), selection: m.selection, packet: path.join(runPath, 'packet.md'), files: m.entries.map(e => ({ id: e.id, passed: e.passed, pdf: e.pdf ? path.join(runPath, e.pdf) : null, sha256: e.pdf_sha256 })) };
  }
  const blockers = [];
  let bank, config;
  try { ({ bank } = loadBank(root)); } catch (e) { blockers.push(e.message); }
  try { config = configFor(root); } catch (e) { blockers.push(e.message); }
  if (config) {
    try { checkBaseline(root, config, bank?.master_sha256); } catch (e) { blockers.push(e.message); }
    if (!config.models?.enabled) blockers.push('Model calls disabled');
    for (const stage of ['parser', 'writer', 'claim', 'reviewer']) if (!config.models?.[stage]?.model) blockers.push(`No ${stage} model selected`);
    if (!config.models?.endpoint) blockers.push('No provider endpoint selected');
    if (!process.env[config.models?.api_key_env]) blockers.push('Provider API key not set');
  }
  return { ready: blockers.length === 0, blockers, fact_bank: (() => { try { return contained(root, sourcePaths(root).bank); } catch { return null; } })(), provider: config?.models?.endpoint || null, note: 'Ready means configured, not an approved application. CLI model-call consent and per-application PDF approval are still required.' };
}
