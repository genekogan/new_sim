// Native Node CLI reporter: observe structured events and forward native TAP.
// No run(), filters, scheduling, exception suppression or test implementation here.
import { tap } from 'node:test/reporters';
import { readFileSync, writeFileSync } from 'node:fs';
import { eventCollector } from './engine-proof.mjs';

export default async function* reporter(source) {
  const path = process.env.MARS_ENGINE_PROOF;
  if (!path) throw new Error('MARS_ENGINE_PROOF is required for the gate reporter');
  const identity = JSON.parse(readFileSync(`${path}.identity.json`, 'utf8'));
  const collector = eventCollector(identity.files);
  const started = performance.now();
  async function* observed() {
    for await (const event of source) { collector.accept(event); yield event; }
  }
  yield* tap(observed());
  writeFileSync(path, JSON.stringify({ schema: 1, completed: true, node: process.version, identity, ...collector.finish(Math.round(performance.now() - started)) }) + '\n');
}
