// Transport only immutable producer paths explicitly used by frozen fixtures.
// Include commit/tree objects so `git show <original SHA>:<path>` works, without
// shipping ancestor history, other historical blobs, working files or local data.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [ref, out] = process.argv.slice(2);
if (!ref || !out) throw Error('usage: historical-inputs.mjs <candidate-ref> <out.pack>');
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const json = path => JSON.parse(git('show', `${ref}:${path}`).toString());
const specs = [
  ['f7536a647b0ecd663554719da608babfaed14988', json('apps/server/test/fixtures/recorded-scene/codec-input.v1.json').files.map(f => f.path)],
  ['e1139e864479404e3c8cffedd977c63009afdd61', Object.keys(json('apps/server/test/fixtures/station-era/native-station-era.v1.json').producer)],
  ['d0b08ff5358b78c82bf15d2c0b526b5579edee41', Object.keys(json('apps/server/test/fixtures/station/native-station.v1.json').producer.authoredSourceSha256)],
];
const objects = new Set();
for (const [commit, paths] of specs) {
  objects.add(git('rev-parse', `${commit}^{commit}`).toString().trim());
  objects.add(git('rev-parse', `${commit}^{tree}`).toString().trim());
  for (const row of git('ls-tree', '-r', '-t', commit).toString().split('\n')) {
    const match = row.match(/^\d+ tree ([a-f0-9]+)\t/);
    if (match) objects.add(match[1]);
  }
  for (const path of paths) objects.add(git('rev-parse', `${commit}:${path}`).toString().trim());
}
const pack = execFileSync('git', ['pack-objects', '--stdout'], {
  input: [...objects].join('\n') + '\n', maxBuffer: 64 * 1024 * 1024,
});
writeFileSync(resolve(out), pack);
writeFileSync(resolve(out) + '.json', JSON.stringify({ candidate: git('rev-parse', ref).toString().trim(), specs, objects: objects.size, bytes: pack.length }, null, 2) + '\n');
console.log(`historical fixture inputs: ${objects.size} objects, ${pack.length} bytes`);
