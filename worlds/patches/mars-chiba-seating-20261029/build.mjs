#!/usr/bin/env node
// Append only this final batch; preserve every preceding byte of the template.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {integrateTemplate, templateBatch, makePatch} from './patch.mjs';

if (process.argv[2] === '--snapshot') {
  const snapshot = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const vacant = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  process.stdout.write(JSON.stringify(makePatch(snapshot, {vacant}), null, 2) + '\n');
} else {
  const path = process.argv[2] ?? fileURLToPath(new URL('../../templates/mars-two.json', import.meta.url));
  const source = readFileSync(resolve(path), 'utf8'), template = JSON.parse(source);
  if (integrateTemplate(template)) {
    const end = source.match(/\n \]\n\}\s*$/);
    if (!end) throw new Error('unexpected template closing layout; refuse broad rewrite');
    const rendered = JSON.stringify(templateBatch(), null, 1).split('\n').map(l => `  ${l}`).join('\n');
    writeFileSync(path, source.slice(0, end.index) + ',\n' + rendered + '\n ]\n}\n');
  }
  process.stdout.write(JSON.stringify({template: resolve(path), finalBatch: templateBatch().group}) + '\n');
}
