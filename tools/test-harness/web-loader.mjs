// Test-only module transformation: use the browser build's TS/TSX semantics while retaining
// module URLs (asset/source fixtures resolve relative to the original file).
import { registerHooks, createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const { transformSync } = createRequire(new URL('../../mars/viewer/package.json', import.meta.url))('esbuild');
// URL-only browser context for modules computing public asset paths at import time.
globalThis.location ??= new URL('http://fixture.invalid/w/eden/');
registerHooks({
  load(url, context, next) {
    if (!url.startsWith('file:')) return next(url, context);
    if (/\.css(?:\?|$)/.test(url)) return { format: 'module', source: 'export default {};', shortCircuit: true };
    if (/\.json(?:\?|$)/.test(url)) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')};`, shortCircuit: true };
    if (/\.tsx?(?:\?|$)/.test(url) && !url.includes('/node_modules/')) {
      let source = readFileSync(new URL(url), 'utf8');
      // Mirror Vite's sole eager side-effect glob, including every real mesh registration.
      if (source.includes("import.meta.glob('./**/*.mesh.ts', { eager: true })")) {
        const dir = dirname(fileURLToPath(url));
        const meshFiles = [];
        const visit = path => { for (const e of readdirSync(path, {withFileTypes:true})) {
          if (e.isDirectory()) visit(join(path,e.name));
          else if (e.name.endsWith('.mesh.ts')) meshFiles.push('./'+relative(dir,join(path,e.name)).replaceAll('\\','/'));
        }};
        visit(dir);
        source = source.replace("import.meta.glob('./**/*.mesh.ts', { eager: true });", meshFiles.sort().map(p => `import ${JSON.stringify(p)};`).join('\n'));
      }
      return { format: 'module', source: transformSync(source, {
        loader: url.endsWith('.tsx') ? 'tsx' : 'ts', format: 'esm', jsx: 'automatic',
        sourcemap: 'inline', sourcefile: new URL(url).pathname,
      }).code, shortCircuit: true };
    }
    return next(url, context);
  },
});
