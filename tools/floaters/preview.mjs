#!/usr/bin/env node
// Bundle preview-entry.ts, serve this worktree on localhost, and screenshot the preview with the
// system Chrome (playwright-core; no browser download). Screenshots land in tools/floaters/shots/.
//   node preview.mjs [mode[:tick] ...]     default: lineup side kin lineup:400
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, '.out');
const SHOTS = path.join(HERE, 'shots');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

await build({
  entryPoints: [path.join(HERE, 'preview-entry.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: path.join(OUT, 'preview.js'),
  nodePaths: [path.join(HERE, 'node_modules')],
  logLevel: 'warning',
});
fs.writeFileSync(path.join(OUT, 'index.html'), '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}</style><script type="module" src="preview.js"></script>');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '/preview.js') p = `/tools/floaters/.out${p === '/' ? '/index.html' : p}`;
  const file = path.join(REPO, p);
  if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const shots = process.argv.slice(2).length ? process.argv.slice(2) : ['lineup', 'side', 'kin', 'lineup:400'];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`[page ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => e.message !== 'axes done' && console.log(`[page error] ${e.message}`));
  for (const s of shots) {
    const [mode, tick = '0', model = ''] = s.split(':');
    await page.goto(`http://127.0.0.1:${port}/?mode=${mode}&tick=${tick}&model=${model}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    const file = path.join(SHOTS, `${mode}${model ? `-${model}` : ''}${tick !== '0' ? `-t${tick}` : ''}.png`);
    await page.screenshot({ path: file });
    console.log(`wrote ${path.relative(REPO, file)}`);
  }
} finally {
  await browser.close();
  server.close();
}
