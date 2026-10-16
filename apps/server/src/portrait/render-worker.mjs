// Automatic portrait renderer (child process of the world server; no browser, no GPU).
// stdin: one JSON request per line {id, look}; stdout: one JSON reply per line {id, ok, png (base64)} | {id, ok:false, error}.
// The viewer's humanoid kit code (apps/web, mars/viewer) is TypeScript with features node's type stripping refuses, so this
// process transforms repo .ts with esbuild, and pins every `three` import to the server's own copy (a release installs only
// the server's dependencies). The kit is read from this checkout's mars/viewer/public/modular/humanoid.
import {registerHooks, createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const serverRequire = createRequire(ROOT + 'apps/server/package.json');
const esbuild = serverRequire('esbuild');
const SERVER_PKG = pathToFileURL(ROOT + 'apps/server/package.json').href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three' || specifier.startsWith('three/')) return next(specifier, {...context, parentURL: SERVER_PKG});
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file://' + ROOT) && url.endsWith('.ts') && !url.includes('/node_modules/')) {
      const source = readFileSync(new URL(url), 'utf8');
      return {format: 'module', source: esbuild.transformSync(source, {loader: 'ts', format: 'esm', sourcefile: url}).code, shortCircuit: true};
    }
    return next(url, context);
  },
});

const KIT = process.env.SIM_PORTRAIT_KIT_DIR || ROOT + 'mars/viewer/public/modular/humanoid/';
const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js');
const {HumanoidKit} = await import(ROOT + 'apps/web/src/humanoid/compose.ts');
const {humanoidPortraitPNG} = await import(ROOT + 'apps/web/src/humanoid/portrait.ts');
const kit = new HumanoidKit(new GLTFLoader(), '', async file => { const b = readFileSync(KIT + file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });

const reply = o => process.stdout.write(JSON.stringify(o) + '\n');
reply({ready: true});
let chain = Promise.resolve();
createInterface({input: process.stdin}).on('line', line => {
  chain = chain.then(async () => {
    let id = null;
    try {
      const req = JSON.parse(line); id = req.id;
      const png = await humanoidPortraitPNG(kit, req.look);
      reply({id, ok: true, png: Buffer.from(png).toString('base64')});
    } catch (e) { reply({id, ok: false, error: String(e && e.message || e).slice(0, 300)}); }
  });
}).on('close', () => { chain.then(() => process.exit(0)); });
