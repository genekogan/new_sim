import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

// Exercise the entry point with component stubs: no renderer, assets or GPU.
const main = transformSync(
  readFileSync(new URL('../app/main.tsx', import.meta.url), 'utf8'),
  {
    loader: 'tsx',
    format: 'cjs',
    jsxFactory: 'createElement',
  },
).code;
function renderRoute(path, origin = 'https://mars.example') {
  const url = new URL(path, origin);
  const components = ['Studio', 'Reconstruction', 'Guide', 'Lab'];
  let tree;
  vm.runInNewContext(main, {
    location: url,
    URLSearchParams,
    document: { getElementById: () => ({}) },
    createElement: (type, props, ...children) => ({ type, props, children }),
    require: (name) =>
      name === 'react'
        ? {
            Component: class {},
            Suspense: 'Suspense',
            lazy: () => components.shift(),
          }
        : name === 'react-dom/client'
          ? {
              createRoot: () => ({
                render: (element) => {
                  tree = element;
                },
              }),
            }
          : {},
  });
  return tree.children[0].children[0];
}

test('presentation root validates query years and photo aliases preserve reconstruction', () => {
  for (let year = 2020; year <= 2026; year++) {
    const root = renderRoute(`/?year=${year}`);
    assert.equal(root.type, 'Studio');
    assert.equal(root.props.year, year);
    assert.equal(root.props.presentation, true);
  }
  for (const query of [
    '',
    '?year=',
    '?year=2019',
    '?year=2028',
    '?year=2020.0',
    '?year=02020',
    '?year=2020junk',
  ]) {
    assert.equal(renderRoute('/' + query).props.year, 2026, query);
  }
  for (const path of ['/photo', '/photo/', '/photo?year=2020']) {
    assert.equal(renderRoute(path).type, 'Reconstruction', path);
  }
});

test('museum, lab, guide and unknown route behavior is retained', () => {
  for (const path of ['/studio', '/studio/', '/studio/2020', '/studio/2026/']) {
    const route = renderRoute(path);
    assert.equal(route.type, 'Studio');
    assert.equal(route.props.year, path.includes('2020') ? 2020 : 2026);
    assert.equal(route.props.presentation, undefined);
  }
  assert.equal(renderRoute('/lab/').type, 'Lab');
  assert.equal(renderRoute('/simulation-guide/').type, 'Guide');
  for (const path of [
    '/studio/2019',
    '/studio/2028',
    '/photo/unknown',
    '/unknown',
  ]) {
    assert.equal(renderRoute(path).type, 'main', path);
  }
});

test('generated Worker admits photo/presentation routes and retains method/unknown refusals', async () => {
  const source = readFileSync(
    new URL('./configure.mjs', import.meta.url),
    'utf8',
  );
  const template = source.match(
    /new URL\('cloudflare-entry.js', out\),\s*(`[^`]+`)/,
  )?.[1];
  assert.ok(template, 'Worker source template exists');
  const workerSource = vm
    .runInNewContext(template, { assets: '{}' })
    .replace(/^import .*;$/gm, '')
    .replace(/^export \{.*;$/gm, '')
    .replace('export default', 'globalThis.worker =');
  const context = {
    URL,
    Request,
    Response,
    Headers,
    handleSimulation: async () => null,
  };
  vm.runInNewContext(workerSource, context);
  const requests = [];
  const env = {
    ASSETS: {
      fetch: async (request) => {
        requests.push(new URL(request.url).pathname);
        return new Response('<div id="root"></div>');
      },
    },
  };
  for (const path of [
    '/',
    '/?year=2020',
    '/photo',
    '/photo/',
    '/studio',
    '/studio/2020/',
    '/studio/2026',
    '/lab/',
    '/simulation-guide/',
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await context.worker.fetch(
        new Request('https://mars.example' + path, { method }),
        env,
        {},
      );
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      if (method === 'HEAD') assert.equal(await response.text(), '');
      assert.equal(requests.at(-1), '/index.html');
    }
    const refused = await context.worker.fetch(
      new Request('https://mars.example' + path, { method: 'POST' }),
      env,
      {},
    );
    assert.equal(refused.status, 405, path);
    assert.equal(refused.headers.get('allow'), 'GET, HEAD');
  }
  for (const path of ['/photo/unknown', '/studio/2028', '/unknown']) {
    assert.equal(
      (
        await context.worker.fetch(
          new Request('https://mars.example' + path),
          env,
          {},
        )
      ).status,
      404,
      path,
    );
  }
});

test('simulation domain keeps the campus homepage at root and Lab on its explicit route', () => {
  for (const origin of [
    'https://sim.mars.college',
    'https://campus.example.test',
    'http://127.0.0.1:5391',
  ]) {
    for (const [path, year] of [
      ['/', 2026],
      ['/?year=2020', 2020],
      ['/?scenario=living-day-4', 2026],
    ]) {
      const root = renderRoute(path, origin);
      assert.equal(root.type, 'Studio', `${origin}${path}`);
      assert.equal(root.props.presentation, true);
      assert.equal(root.props.year, year);
    }
    for (const path of ['/lab', '/lab/', '/lab?scenario=living-day-4']) {
      const lab = renderRoute(path, origin);
      assert.equal(lab.type, 'Lab', `${origin}${path}`);
      assert.equal(lab.props?.defaultScenario, undefined);
    }
  }
});
