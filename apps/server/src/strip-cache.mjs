// Lane BOOT2 (2026-10-22): a persisted cache of the server's TypeScript with its types stripped, for world processes
// (`node --import ./apps/server/src/strip-cache.mjs apps/server/src/main.ts`, tools/world-launcher/children.mjs).
// Node 22 strips types on every load (amaro, ~0.35 s of a world's ~1 s code load for ~900 modules) and its compile cache
// (NODE_COMPILE_CACHE) does not keep the stripped text there, so each cold boot redid it. Here a load hook keeps the
// stripped text in `<NODE_COMPILE_CACHE>/ts-strip-1/<sha1 of node version + source>.js`: a later boot of the same build
// reads it back, and V8's own compile cache then applies to that text as to any JavaScript module.
// The output is Node's own `stripTypeScriptTypes` in strip mode (what the loader runs), so the code is the same byte for
// byte. Off without NODE_COMPILE_CACHE, under --experimental-transform-types, without the APIs (older Node: boots as
// before), and for anything not a file: .ts / .mts outside node_modules. A broken or missing entry is only a miss.
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { hash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.NODE_COMPILE_CACHE;
const transform = process.execArgv.some((a) => a.startsWith('--experimental-transform-types'));
if (root && !transform && typeof registerHooks === 'function' && typeof stripTypeScriptTypes === 'function' && typeof hash === 'function') {
  const dir = join(root, 'ts-strip-1');
  let ok = true;
  try { mkdirSync(dir, { recursive: true }); } catch { ok = false; }
  if (ok) registerHooks({
    load(url, context, nextLoad) {
      const r = nextLoad(url, context);
      if (r.format !== 'module-typescript' || !url.startsWith('file:') || url.includes('/node_modules/')) return r;
      const src = typeof r.source === 'string' ? r.source : Buffer.from(r.source).toString('utf8');
      const file = join(dir, `${hash('sha1', `${process.version}\0${src}`)}.js`);
      try { return { format: 'module', source: readFileSync(file, 'utf8'), shortCircuit: true }; } catch { /* miss */ }
      const out = stripTypeScriptTypes(src, { mode: 'strip' });
      try { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, out); renameSync(tmp, file); } catch { /* read-only: next boot strips again */ }
      return { format: 'module', source: out, shortCircuit: true };
    },
  });
}
