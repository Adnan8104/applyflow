#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { initBank } from './lib/resume-pipeline/facts.mjs';
import { baselinePreview, prepare } from './lib/resume-pipeline/pipeline.mjs';
import { approve, revoke, recordSubmitted } from './lib/resume-pipeline/approval.mjs';
import { status } from './lib/resume-pipeline/status.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values: v, positionals } = parseArgs({ args, allowPositionals: true, options: {
    root: { type: 'string' }, jd: { type: 'string' }, company: { type: 'string' }, role: { type: 'string' }, url: { type: 'string' },
    application: { type: 'string' }, run: { type: 'string' }, 'pdf-hash': { type: 'string' }, select: { type: 'string' },
    'allow-model-calls': { type: 'boolean' }, 'acknowledge-warnings': { type: 'boolean' }, 'resolve-disagreement': { type: 'boolean' }, 'confirm-submitted': { type: 'boolean' },
  } });
  const root = v.root || getCareerOpsRoot();
  switch (positionals[0]) {
    case 'status': return status(root, v.application);
    case 'init': return initBank(root);
    case 'baseline': return baselinePreview(root);
    case 'prepare': return prepare(root, { company: v.company, role: v.role, url: v.url, jdFile: v.jd, allowModelCalls: v['allow-model-calls'] });
    case 'approve': return approve(root, v.application, v.run, v['pdf-hash'], { acknowledgeWarnings: v['acknowledge-warnings'], selected: v.select, resolveDisagreement: v['resolve-disagreement'] });
    case 'revoke': await revoke(root, v.application); return { status: 'revoked' };
    case 'record-submitted': return recordSubmitted(root, v.application, v['pdf-hash'], v['confirm-submitted']);
    default: throw new Error('Usage: node resume-pipeline.mjs status [--application <id>] | init | baseline | prepare --jd <file> --company <name> --role <role> --url <https-url> --allow-model-calls | approve --application <id> --run <run> --pdf-hash <hash> --acknowledge-warnings | revoke --application <id> | record-submitted --application <id> --pdf-hash <hash> --confirm-submitted');
  }
}
if (isMainModule(import.meta.url)) main().then(result => { console.log(JSON.stringify(result, null, 2)); if (result?.status === 'failed') process.exitCode = 1; }).catch(e => { console.error(e.message); process.exitCode = 1; });
