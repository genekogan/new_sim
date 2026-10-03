// Reproducible camera replay, generated locally; never a second live simulation.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const viewer = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ids = ['presentation', 'conversation', 'walking', 'workstation', 'simultaneous', 'operator'];
export function validateCameraDemo(data) {
  if (data.schema !== 'mars-camera-suite/1' || data.live !== false)
    throw Error('camera.demo-schema: expected explicitly recorded replay');
  if (JSON.stringify(data.cases?.map((c) => c.id)) !== JSON.stringify(ids))
    throw Error('camera.demo-cases: expected all six supported scenes');
  for (const c of data.cases) {
    if (!c.take?.finalState || !c.worldHash || c.violations?.length !== 0 || !Array.isArray(c.records) || c.records.some((r) => r.status === 'failed'))
      throw Error(`camera.demo-world: ${c.id} has incomplete or invalid execution`);
    for (const policy of ['clear', 'restrained', 'continuous'])
      if (!c.policies?.[policy]?.frames?.length)
        throw Error(`camera.demo-policy: ${c.id} is missing ${policy}`);
  }
  return data;
}

function main() {
  const staged = process.argv.includes('--for-build') && process.env.CLOUDFLARE_RELEASE === '1';
  const target = resolve(viewer, 'public/camera-demo/suite.json');
  execFileSync(process.execPath, ['cinematography/suite-record.ts'], { cwd: viewer, stdio: 'pipe', timeout: 60_000 });
  const source = resolve(viewer, 'e2e/artifacts/codex-autonomous-camera-suite/suite.json');
  const payload = readFileSync(source, 'utf8');
  const data = validateCameraDemo(JSON.parse(payload));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: viewer, encoding: 'utf8' }).trim();
  if (data.commit !== head) throw Error('camera.demo-stale: regenerate and stage replay from the release source');
  if (Buffer.byteLength(payload) >= 25 * 1024 * 1024) throw Error('camera.demo-size: replay exceeds static asset limit');
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, payload);
  if (staged) {
    // Stage after prepare.py so its historical allowlist stays independently owned.
    const manifest = resolve(viewer, '.cloudflare/release.json');
    const records = JSON.parse(readFileSync(manifest, 'utf8')).filter((r) => r.path !== '/camera-demo/suite.json');
    const output = resolve(viewer, '.cloudflare/public/camera-demo/suite.json');
    mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, payload);
    records.push({ path: '/camera-demo/suite.json', bytes: Buffer.byteLength(payload), sha256: createHash('sha256').update(payload).digest('hex'), storage: 'static' });
    writeFileSync(manifest, JSON.stringify(records, null, 2));
  }
  console.log(JSON.stringify({ cameraDemo: staged ? 'staged and current' : 'generated', source: head, cases: ids, bytes: Buffer.byteLength(payload) }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
