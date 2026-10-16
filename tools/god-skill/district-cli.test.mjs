// Y3 districts: offline CLI checks (no server). The in-process end-to-end run is apps/server/src/god/districts-agent.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, checkArgs, districtLines, parseFlags } from './cli.mjs';

function offline(t, reply) {
  const cwd = process.cwd(), originalFetch = globalThis.fetch, dir = mkdtempSync(join(tmpdir(), 'god-district-cli-')), calls = [];
  process.chdir(dir); writeFileSync('.eden-god.json', JSON.stringify({ world: 'https://world.invalid', token: 'fixture-only' }));
  globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); const out = reply(url, options); return out instanceof Response ? out : Response.json(out); };
  t.after(() => { globalThis.fetch = originalFetch; process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });
  return { dir, calls };
}
const view = { id: 'high', title: 'High Street', brief: 'six shops', roads: [{ id: 'high', width: 8, path: [[-60, 0], [60, 0]] }], counts: { plots: 2, built: 1, building: 0, planned: 1 },
  plots: [{ id: 'p1', title: 'Bakery', at: [-40, -14], size: [16, 18], masses: 1, status: 'built', chapter: 'high-1', parts: 3 }, { id: 'p2', at: [-40, 14], size: [16, 18], masses: 1, status: 'planned' }],
  chapters: [{ id: 'high-1', plots: ['p1'], status: 'done', step: { n: 3, label: 'details', of: 3 }, parts: 3, closed: false }], next: { action: 'start', id: 'high-2', plots: ['p2'] } };

test('district arguments pass the CLI check and refuse site flags on a chapter before any request', async t => {
  for (const argv of [['district', 'high', '--file', 'plan.json'], ['district', 'high'], ['district'], ['district', 'high', '--delete'], ['start', 'high-1', '--district', 'high', '--plots', 'p1,p2', '--brief', 'words']]) {
    const { flags, rest } = parseFlags(argv); checkArgs('build', flags, rest);
  }
  const { calls } = offline(t, () => ({}));
  await assert.rejects(build('start', ['high-1'], { district: 'high', at: '0,0' }), /--at does not apply to a district chapter/);
  await assert.rejects(build('start', ['high-1'], { district: 'High!' }), /--district needs a district id/);
  await assert.rejects(build('start', ['high-1'], { district: 'high', plots: 'p1,,p2' }), /--plots needs/);
  await assert.rejects(build('district', ['Bad Id'], {}), /district id/);
  await assert.rejects(build('district', [], { file: 'plan.json' }), /--file plan.json/);
  await assert.rejects(build('district', ['high'], { file: '{"id":"other","title":"x","plots":[]}' }), /differs from high/);
  await assert.rejects(build('district', [], { delete: true }), /build district <id> --delete/);
  await assert.rejects(build('district', ['high'], { delete: 'yes' }), /--delete takes no value/);
  await assert.rejects(build('district', ['high'], { delete: true, file: 'plan.json' }), /separate commands/);
  assert.equal(calls.length, 0);
});

test('a chapter start sends only the district, plots and words; district prints the plan and the next command', async t => {
  const { calls } = offline(t, (url) => String(url).endsWith('/v1/god/builds') ? { ok: false, failures: [{ op: -1, code: 'district.plot', detail: 'Plot p1 is built by high-1.', field: 'district.plots', fix: 'build district high' }] } : { ok: true, district: view, warnings: ['plot p2 overlaps road high; keep buildings off the carriageway'] });
  const refused = await build('start', ['high-2'], { district: 'high', plots: 'p1', brief: 'A smithy' });
  assert.match(refused, /REFUSED: district.plot.*field district.plots/);
  assert.deepEqual(JSON.parse(calls[0].body), { id: 'high-2', district: { id: 'high', plots: ['p1'] }, brief: 'A smithy' });
  const recorded = await build('district', ['high'], { file: '{"title":"High Street","plots":[]}' });
  assert.deepEqual(JSON.parse(calls[1].body), { title: 'High Street', plots: [], id: 'high' }); assert.match(calls[1].url, /\/v1\/god\/districts$/);
  assert.match(recorded, /district high: High Street; 1\/2 plots built/); assert.match(recorded, /WARNING: plot p2 overlaps road high/);
  assert.match(recorded, /next: build start high-2 --district high --plots p2/);
});

test('beside one chapter the district view is compact and shows next only once the chapter is closed', () => {
  const open = { ...view, chapters: [{ ...view.chapters[0], status: 'active' }] };
  const lines = districtLines(open, 'high-1').join('\n');
  assert.match(lines, /plot p1 Bakery .*<- this chapter/); assert.doesNotMatch(lines, /plot p2/); assert.doesNotMatch(lines, /next:/);
  assert.match(districtLines(view, 'high-1').join('\n'), /next: build start high-2/);
  assert.match(districtLines({ ...view, next: { action: 'resume', id: 'high-2', plots: ['p2'] } }).join('\n'), /next: build resume high-2 \(plots p2\)/);
  assert.match(districtLines({ ...view, next: null }).join('\n'), /next: every plot is built/);
});

test('an unknown district is a 404 the CLI explains; --delete sends DELETE and reports a refusal or what stays', async t => {
  let deleted = false;
  const { calls } = offline(t, (url, options) => String(url).endsWith('/missing') ? Response.json({ ok: false, code: 'not-found' }, { status: 404 })
    : options.method === 'DELETE' ? (deleted ? { ok: true, deleted: 'high', chapters: ['high-1', 'high-2'] } : (deleted = true, { ok: false, failures: [{ op: -1, code: 'district.open', detail: 'Chapter high-2 of high is open.', field: 'id', fix: 'Finish or abandon high-2 first.' }] })) : {});
  assert.equal(await build('district', ['missing'], {}), 'unknown district: missing; `build district` lists them');
  assert.deepEqual(await build('district', ['missing'], { json: true }), { ok: false, code: 'district.unknown' });
  assert.equal(await build('district', ['missing'], { delete: true }), 'unknown district: missing; `build district` lists them');
  assert.match(await build('district', ['high'], { delete: true }), /REFUSED: district.open.*high-2/);
  assert.equal(await build('district', ['high'], { delete: true }), 'district high deleted: its buildings and 2 chapter build(s) stay; undo --group <chapter> still works');
  assert.deepEqual(calls.map(c => `${c.method} ${new URL(c.url).pathname}`), ['GET /v1/god/districts/missing', 'GET /v1/god/districts/missing', 'DELETE /v1/god/districts/missing', 'DELETE /v1/god/districts/high', 'DELETE /v1/god/districts/high']);
});
