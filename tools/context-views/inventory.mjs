#!/usr/bin/env node
// One unchanged offline template per invocation. No server, render, inference or live credentials.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { replay } from '../meaning/materialize.mjs';
import { contextTargets, contextEnclosed } from '../../apps/server/src/god/context-view-scene.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = [
  'tools/context-views/inventory.mjs',
  'tools/meaning/materialize.mjs',
  'apps/server/src/god/context-view-scene.ts',
  'apps/server/src/god/meaning.ts',
  'packages/world-compiler/src/schemas.ts',
];
export function inventory(name, destination) {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error('exact repository template name required');
  const source = `worlds/templates/${name}.json`;
  const bytes = readFileSync(resolve(root, source));
  const receipt = { source, sha256: sha(bytes), tools: Object.fromEntries(sourceFiles.map(file => [file, sha(readFileSync(resolve(root, file)))])) };
  const output = resolve(destination, `${name}.json`);
  if (existsSync(output)) {
    const previous = JSON.parse(readFileSync(output, 'utf8'));
    if (JSON.stringify(previous.receipt) === JSON.stringify(receipt)) return { name, resumed: true, ...previous.summary };
    throw Error(`source drift for ${name}; use a new output directory to preserve prior inventory`);
  }
  const template = JSON.parse(bytes);
  const world = replay(template, { seed: `context-inventory:${name}` });
  const targets = contextTargets(world).map(target => ({
    ref: target.ref, entity: target.entity, path: world.pathOf(target.entity),
    ...(target.part ? { part: target.part } : {}), ...(target.slot ? { slot: target.slot } : {}),
    title: target.title, enclosed: contextEnclosed(world, target),
    ...(target.viewpoint ? { viewpoint: target.viewpoint } : {}),
    ...(target.original ? { original: target.original } : {}),
  }));
  const authored = [...world.entities.values()].filter(entity => entity.about);
  const summary = {
    entities: world.entities.size, authoredEntities: authored.length,
    authoredParts: authored.reduce((n, entity) => n + (entity.about.parts?.length ?? 0), 0),
    targets: targets.length, roomTargets: targets.filter(target => target.slot && !target.part).length,
    partTargets: targets.filter(target => target.part).length,
    authoredViewpoints: targets.filter(target => target.viewpoint).length,
    originalImages: targets.filter(target => target.original).length,
    replayAccepted: true, invalidBindingRefusals: 0,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ schema: 'context-inventory/1', name, receipt,
    scope: 'unchanged repository template; deterministic offline IDs, not live bindings; no images generated',
    resume: 'one template per invocation; matching source/tool hashes skip completed inventory; drift requires fresh output directory',
    summary, targets }, null, 2) + '\n');
  return { name, resumed: false, ...summary };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [name, output] = process.argv.slice(2);
  if (!name || !output) throw Error('inventory.mjs <template-name> <explicit-output-directory>');
  console.log(JSON.stringify(inventory(name, output)));
}
