import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Release-only packaging. The downloaded CLI stays one dependency-free file.
// esbuild comes from the existing frozen frontend toolchain; no install here.
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const [outputDirectory] = process.argv.slice(2);
if (!outputDirectory) throw new Error('Usage: node tools/edge-skill/build-cli.mjs ABSOLUTE_NEW_OUTPUT_DIR');
const output = resolve(outputDirectory);
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Release packaging requires a clean source tree');
const source = git('rev-parse', 'HEAD');
mkdirSync(output, { recursive: false }); // Exclusive output preserves prior attempts.
const toolchain = createRequire(realpathSync(resolve(root, 'apps/web/node_modules/vite/package.json')));
const { build, version } = toolchain('esbuild');
const result = await build({
  absWorkingDir: root,
  entryPoints: ['tools/edge-skill/eden-agent.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  write: false,
  metafile: true,
  outfile: 'eden-agent.mjs',
  legalComments: 'inline',
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = Object.keys(result.metafile.inputs).map(path => {
  const absolute = realpathSync(resolve(root, path));
  const local = relative(root, absolute);
  if (local.startsWith('../') || !local.startsWith('tools/edge-skill/')) throw new Error(`Unexpected bundle source: ${path}`);
  return { path: local, sha256: sha(readFileSync(absolute)) };
});
if (git('rev-parse', 'HEAD') !== source || git('status', '--porcelain')) throw new Error('Source changed during packaging');
const bytes = result.outputFiles[0].contents;
const artifact = resolve(output, 'eden-agent.mjs');
writeFileSync(artifact, bytes, { flag: 'wx' });
writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify({ source, esbuild: version, artifact, bytes: bytes.length, sha256: sha(bytes), inputs }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ source, artifact, bytes: bytes.length, sha256: sha(bytes), inputs: inputs.length }));
