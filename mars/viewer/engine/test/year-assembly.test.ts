// Assembly graph of the canonical year scenes (engine/campus/assembly.ts; owner feedback §7 phase A).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { loadCampusYear, type CampusYearFile } from '../campus/history.ts';
import { loadCampusFile } from '../campus/history-node.ts';
import { assemblyGraph, graphCounts, topoOrder } from '../campus/assembly.ts';
import type { CampusScene } from '../campus/types.ts';
import { def } from '../world/catalog.ts';
import { defaultSortOrder } from '../core/order.ts';

// Preserve source-era geometry/count assertions on their exact input bytes.
function sourceEraFile(y: number): CampusYearFile {
  if (![2021, 2022, 2023, 2024].includes(y)) return loadCampusFile(y);
  const root = new URL('./fixtures/campus-history-pre-review-7648dbf/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as { years: Record<string, { sha256: string; contentHash: string }> };
  const bytes = readFileSync(new URL(`campus-${y}.json`, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.years[String(y)].sha256);
  const file = JSON.parse(bytes.toString()) as CampusYearFile;
  assert.equal(file.contentHash, manifest.years[String(y)].contentHash); return file;
}
const scene = (y: number) => loadCampusYear(y, sourceEraFile(y)).base;

test('byte-verified pre-review7648dbf assembly graph 2022: 4 houses × (12 frames + 54 beams), every rack part classified, deterministic', () => {
  const base = scene(2022);
  const g = assemblyGraph(2022, base);
  const c = graphCounts(g);
  assert.equal(c.kinds.upright, 48);
  assert.equal(c.kinds.beam, 216);
  assert.equal(c.unclassified, 0, JSON.stringify(g.unclassified.slice(0, 3)));
  assert.equal(g.sceneHash, sourceEraFile(2022).contentHash);
  assert.equal(hashOf(assemblyGraph(2022, scene(2022))), hashOf(g));
  const order = topoOrder(g);
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const house of ['chiba', 'east-house', 'kitchen', 'west-house']) {
    const h = assemblyGraph(2022, base, { assemblies: [house] });
    const ups = h.nodes.filter((n) => n.kind === 'upright'), beams = h.nodes.filter((n) => n.kind === 'beam');
    assert.equal(ups.length, 12, house);
    assert.equal(beams.length, 54, house);
    for (const u of ups) {
      assert.equal(u.def, 'upright-16ft-kit');
      assert.equal(u.components.length, 2 + 1 + 6, `${u.id}: 2 posts, crossbar, 6 bracing rods`);
      assert.ok(h.edges.some((e) => e.from === u.id && e.to === 'ground' && e.rel === 'rests-on'));
    }
    const seats = new Map<string, number>();
    for (const b of beams) {
      assert.equal(b.def, 'beam-12ft');
      const es = h.edges.filter((e) => e.from === b.id && e.rel === 'connects-to');
      assert.equal(es.length, 2, b.id);
      assert.notEqual(es[0].to, es[1].to);
      for (const e of es) {
        assert.ok(pos.get(e.to)! < pos.get(b.id)!, `${e.to} before ${b.id}`);
        seats.set(e.socket!.replace(/^col[lr]/, ''), (seats.get(e.socket!.replace(/^col[lr]/, '')) ?? 0) + 1);
      }
    }
    assert.deepEqual([...seats].sort(defaultSortOrder), [['@0.220', 36], ['@2.480', 36], ['@4.757', 36]], house);
    // deck sheets rest on the beams under them
    const sheets = h.nodes.filter((n) => n.feature === 'deck-sheet');
    assert.ok(sheets.length >= 21);
    for (const s of sheets) assert.ok(h.edges.some((e) => e.from === s.id && (e.rel === 'rests-on' || e.rel === 'supported-by')), `${s.id} is carried by a beam`);
  }
});

test('source-era assembly graph: every year builds and orders; 2020 racks do not map onto catalog frames and are reported, not forced', () => {
  for (const y of [2021, 2023, 2024, 2025]) {
    const g = assemblyGraph(y, scene(y));
    assert.ok(topoOrder(g).length === g.nodes.length);
    assert.ok(graphCounts(g).kinds.upright! >= 52, `${y} uprights`);
  }
  const g20 = assemblyGraph(2020, scene(2020));
  const why = g20.unclassified.map((u) => `${u.kitDef}: ${u.reason}`);
  assert.equal(graphCounts(g20).kinds.beam, undefined, '2020 beams hang on frame centre lines — no catalog seat');
  assert.ok(why.some((w) => /12 ft rack beam: beam ends not on a frame post/.test(w)));
  assert.ok(why.some((w) => /has no catalog upright/.test(w)), '2020 10 ft / 13 ft frames');
  assert.ok(why.some((w) => /column spacing .* ≠ the 19 ft frame depth/.test(w)));
});

test('assembly graph: deliberately broken geometry is reported with a reason, never faked', () => {
  const base = scene(2022);
  const house = base.obstacles.filter((o) => o.assembly === 'east-house');
  const sub = (obs: typeof house): CampusScene => ({ ...base, obstacles: obs });
  const beam = house.find((o) => o.label?.startsWith('12 foot orange beam') && !o.id.includes('.'))!;
  const post = house.find((o) => o.label?.startsWith('rack upright') && !o.id.includes('.'))!;
  // (a) a beam slid 10 cm along its axis: one end misses its post
  const slid = house.map((o) => (o.component === beam.component ? { ...o, obb: { ...o.obb, c: [o.obb.c[0] + 0.1 * Math.abs(Math.sign(Math.round(o.obb.half[0] * 10))), o.obb.c[1] + 0.1 * Math.abs(Math.sign(Math.round(o.obb.half[1] * 10)))] as [number, number] } } : o));
  const ga = assemblyGraph(2022, sub(slid), { assemblies: ['east-house'] });
  assert.ok(ga.unclassified.some((u) => u.component === beam.component && /not on a frame post/.test(u.reason)), JSON.stringify(ga.unclassified));
  assert.equal(ga.nodes.filter((n) => n.kind === 'beam').length, 53);
  // (b) a beam raised 3 cm: not a seat of the frame
  const raised = house.map((o) => (o.component === beam.component ? { ...o, y0: o.y0 + 0.03, y1: o.y1 + 0.03 } : o));
  const gb = assemblyGraph(2022, sub(raised), { assemblies: ['east-house'] });
  const ub = gb.unclassified.find((u) => u.component === beam.component);
  assert.match(ub!.reason, /seat 0\.250 m is not a beam seat of upright-16ft-kit/);
  // (c) a post removed: its frame's crossbar and partner post are reported; beams on it lose an end
  const noPost = house.filter((o) => o.component !== post.component);
  const gc = assemblyGraph(2022, sub(noPost), { assemblies: ['east-house'] });
  assert.equal(gc.nodes.filter((n) => n.kind === 'upright').length, 11);
  assert.ok(gc.unclassified.some((u) => /crossbar ends do not both sit on free posts/.test(u.reason)));
  assert.ok(gc.unclassified.some((u) => /post with no crossbar partner/.test(u.reason)));
  assert.ok(gc.unclassified.some((u) => /bracing rod not inside any classified frame/.test(u.reason)));
  assert.ok(gc.unclassified.filter((u) => /not on a frame post/.test(u.reason)).length >= 3);
  // catalog: the reconstruction frame keeps the stock seats and adds the Kit levels
  const seats = new Set((def('upright-16ft-kit').sockets ?? []).map((s) => s.local[1].toFixed(4)));
  for (const y of ['0.2200', '2.4800', '4.7568', '0.3048', '1.8288']) assert.ok(seats.has(y), y);
});


test('current public year graphs preserve actual rack identity/order and explicitly report unsupported components', () => {
  for (const year of [2020, 2021, 2022, 2023, 2024, 2025]) {
    const file = loadCampusFile(year), base = loadCampusYear(year, file).base, graph = assemblyGraph(year, base);
    assert.equal(graph.sceneHash, file.contentHash);
    assert.equal(topoOrder(graph).length, graph.nodes.length);
    assert.equal(new Set(graph.nodes.map(n => n.id)).size, graph.nodes.length);
    const components = new Set(base.obstacles.map(o => o.component));
    for (const issue of graph.unclassified) {
      assert.ok(components.has(issue.component), `${year}: refusal names actual component ${issue.component}`);
      assert.ok(issue.reason.length > 10, `${year}: ${issue.component} has an explicit classification reason`);
    }
    if (year === 2022) for (const house of ['chiba', 'east-house', 'kitchen', 'west-house']) {
      const selected = assemblyGraph(year, base, { assemblies: [house] });
      assert.equal(selected.nodes.filter(n => n.kind === 'upright').length, 12, house);
      assert.equal(selected.nodes.filter(n => n.kind === 'beam').length, 54, house);
    }
    console.log(`[current graph ${year}] ${JSON.stringify(graphCounts(graph))}`);
  }
});
