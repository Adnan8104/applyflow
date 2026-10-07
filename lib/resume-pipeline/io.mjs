import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as yaml from 'js-yaml';

export const VERSION = 1;
export const hash = value => createHash('sha256').update(value).digest('hex');
export const fileHash = file => hash(fs.readFileSync(file));
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const readYaml = file => yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.JSON_SCHEMA });

export function contained(root, name) {
  const base = fs.realpathSync(root);
  const target = path.resolve(base, name);
  const inside = p => p === base || p.startsWith(base + path.sep);
  if (!inside(target)) throw new Error('Path escapes the workspace');
  let current = base;
  for (const part of path.relative(base, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink paths are not allowed in the resume pipeline');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return target;
}

export function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomUUID()}`;
  try {
    fs.writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
export const writeJson = (file, value) => writeAtomic(file, JSON.stringify(value, null, 2) + '\n');

// Which master resume + fact bank the pipeline uses. Read without full config
// validation so status/init still work; defaults keep the original cv.md source.
export function sourcePaths(root) {
  const file = contained(root, 'config/resume-pipeline.yml');
  const source = fs.existsSync(file) ? readYaml(file)?.source || {} : {};
  const master = source.master || 'cv.md', bank = source.fact_bank || 'data/fact_bank.yaml';
  if (typeof master !== 'string' || !master.endsWith('.md') || typeof bank !== 'string' || !/\.ya?ml$/.test(bank)) throw new Error('Invalid source paths in config/resume-pipeline.yml');
  return { master, bank };
}

export function configFor(root) {
  const config = readYaml(contained(root, 'config/resume-pipeline.yml'));
  if (config?.schema_version !== VERSION) throw new Error('Unsupported resume pipeline config');
  for (const [key, min, max] of [['candidates', 1, 8], ['concurrency', 1, 4], ['max_calls', 1, 200], ['max_output_tokens', 256, 32000], ['timeout_ms', 1000, 600000]]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new Error(`Invalid config: ${key}`);
  }
  if (!Number.isFinite(config.reviewer_margin) || config.reviewer_margin < 0 || config.reviewer_margin > 16) throw new Error('Invalid reviewer margin');
  if (!Array.isArray(config.strategies) || config.strategies.length !== 3 || config.strategies.some(s => typeof s !== 'string' || !s.trim())) throw new Error('Three strategies are required');
  if (!['a4', 'letter'].includes(config.render?.format)) throw new Error('Invalid page format');
  return config;
}

export function jobUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Use a public HTTPS job URL');
  // Ashby uses two URLs for the same requisition, not two applications.
  if (u.hostname === 'jobs.ashbyhq.com') {
    u.hash = '';
    u.pathname = u.pathname.replace(/\/application\/?$/, '');
  }
  u.pathname = u.pathname.replace(/\/$/, '');
  return u.href;
}

export async function mapLimit(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}
