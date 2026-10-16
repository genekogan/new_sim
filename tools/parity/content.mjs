/**
 * Read-only content parity inventory. No HTTP requests, servers, credentials or LLMs.
 *
 * API:
 *   inventoryOldWorld({world,scene,buildings,paths?,hills?,skyHourly?,source}, {samples,solarHourly?})
 *   inventoryCandidate(model, {template?,samples,solarHourly?,source,compilation?})
 *   compareContent(oldInventory, candidateInventory, {numberTolerance:0})
 *   await compileTemplate(template, {root,seed?}) -> {model,compilation}
 *   await loadRepoComparison('mars'|'littlemartians', {root?,samples?,date?,
 *     oldSnapshot?,candidateSnapshot?,template?,seed?,oldMarsMap?:boolean,
 *     oldSkyHourly?,candidateSkyHourly?})
 *     -> {old,candidate,diff}
 *
 * oldSnapshot is an explicitly exported bundle, never a DB: {world,scene,buildings,
 * paths?,hills?,skyHourly?,source?,buildingsComplete?,interiorsComplete?}.
 * Set a coverage flag false when an export enumerates only part of that category.
 * candidateSnapshot is a compiler snapshot (the
 * public/god snapshot shape, including defs/library/entities/ground), optionally
 * {snapshot,skyHourly,source}. Importing and sampling one performs no mutations.
 * Without overrides this compares the repo's plain Mars camp / small LM fixtures
 * to mars-two / littlemartians-two genesis, NOT deployed DB or live world parity.
 *
 * oldMarsMap:true selects the repo's opt-in mars-2026-map/1 scene/regions on the
 * camp, matching a runtime that selects this map. Its campus GLB's architectural
 * building/interior inventory is incomplete and stays PARTIAL/UNKNOWN.
 *
 * CLI (Node >=22.18, from any cwd):
 * node --experimental-strip-types /absolute/tools/parity/content.mjs --world mars
 *   [--root /absolute/repo] [--out /absolute/content.json]
 *   [--old /absolute/exported-old-bundle.json] [--candidate /absolute/snapshot.json]
 *   [--template /absolute/genesis.json] [--samples /absolute/xz-points.json]
 *   [--date 2026-10-15] [--seed parity:mars] [--old-mars-map true]
 * Output is JSON; exit 0=IDENTICAL, 1=NOT_IDENTICAL, 2=UNKNOWN/error. Numerical
 * tolerance defaults to zero. Same IDs are compared; no fuzzy/name/position
 * alignment hides moved geometry. Missing data is UNKNOWN, never an empty pass.
 * Terrain is physical support/ground height; decorative hill heights and the
 * complete rendered atmosphere need separate evidence and remain UNKNOWN.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CONTENT_SCHEMA = 'sim-parity-content/1';
export const CATEGORIES = ['buildings', 'interiors', 'places', 'paths', 'hills', 'terrain', 'skyLighting'];
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const unknown = (reason) => ({ unknown: reason });
const isUnknown = (x) => !!x && typeof x === 'object' && typeof x.unknown === 'string';
const sorted = (rows) => rows.slice().sort((a, b) => a.id.localeCompare(b.id));
const category = (records, limitations = [], complete = true) => ({
  status: !complete ? records.length ? 'PARTIAL' : 'UNKNOWN' : 'KNOWN',
  records: sorted(records), limitations,
});
const asRows = (value) => Array.isArray(value) ? value : Object.values(value ?? {});
const point3 = (p) => !p ? unknown('position unavailable') : p.length === 3 ? [...p] : [p[0], 0, p[1]];
const rectPoly = ([x0, z0, x1, z1]) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** Ignore polygon starting vertex/winding only; retain every exact coordinate. */
export function canonicalPolygon(points) {
  if (!Array.isArray(points)) return unknown('polygon unavailable');
  let p = points.map((v) => v.slice());
  if (p.length > 1 && JSON.stringify(p[0]) === JSON.stringify(p.at(-1))) p.pop();
  if (!p.length) return [];
  const variants = [];
  for (const order of [p, p.slice().reverse()]) for (let i = 0; i < p.length; i++) variants.push([...order.slice(i), ...order.slice(0, i)]);
  return variants.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))[0];
}

function polygonOfObb(obb) {
  if (!obb) return unknown('footprint unavailable');
  const c = Math.cos(obb.yaw ?? 0), s = Math.sin(obb.yaw ?? 0);
  return canonicalPolygon([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [
    obb.c[0] + a * obb.half[0] * c + b * obb.half[1] * s,
    obb.c[1] - a * obb.half[0] * s + b * obb.half[1] * c,
  ]));
}

function contains(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = poly[i], [c, d] = poly[j];
    const cross = (x - a) * (d - b) - (z - b) * (c - a);
    if (Math.abs(cross) <= 1e-9 && x >= Math.min(a, c) && x <= Math.max(a, c) && z >= Math.min(b, d) && z <= Math.max(b, d)) return true;
    if ((b > z) !== (d > z) && x < (c - a) * (z - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}

export function defaultSamples() {
  const p = [-320, -160, -80, -40, -20, -10, 0, 10, 20, 40, 80, 160, 320];
  return p.flatMap((x) => p.map((z) => [x, z]));
}

function validSamples(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.length > 4096 || samples.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((v) => !Number.isFinite(v)))) throw new Error('samples must contain 1..4096 finite [x,z] points');
  return [...new Map(samples.map((p) => [p.join(','), p])).values()];
}

function legacyGroundHeight(scene, x, z) {
  // Higher floors are interiors, not bare terrain. No support outside the
  // exported level-0 surfaces is invented, even when a viewer draws an infinite plane.
  const heights = (scene?.surfaces ?? []).filter((s) => s.level === 0 && contains(polygonOfObb(s.obb), x, z)).map((s) => s.y);
  return heights.length ? Math.max(...heights) : unknown('no exported old ground surface at this point');
}

const hourlyUnknown = (solarHourly) => (solarHourly ?? Array.from({ length: 24 }, (_, hour) => ({ hour }))).map((h) => ({
  id: String(h.hour).padStart(2, '0'), ...h, rendered: unknown('full rendered sky/lighting was not sampled at this hour'),
}));

function hourlyCategory(skyHourly, solarHourly, config) {
  if (skyHourly !== undefined) {
    if (!Array.isArray(skyHourly)) throw new Error('skyHourly must be an array');
    const seen = new Set(skyHourly.map((x) => x.hour));
    const complete = skyHourly.length === 24 && seen.size === 24 && [...seen].every((h) => Number.isInteger(h) && h >= 0 && h < 24);
    if (!complete) throw new Error('skyHourly must contain each integer hour 0..23 exactly once');
    const rows = skyHourly.map((h) => ({ ...h, id: String(h.hour).padStart(2, '0'),
      ...(!('rendered' in h) && !('background' in h && 'lights' in h) ? { rendered: unknown('hour has no rendered background/light evidence') } : {}),
    }));
    return category(rows, [], rows.every((h) => !isUnknown(h.rendered)));
  }
  return category(hourlyUnknown(solarHourly).map((h) => ({ ...h, config: config ?? unknown('old renderer sky configuration not exported') })), [
    'Hourly astronomical reference is computed from the shared sun/daylight functions; it is not a rendered sky measurement.',
    'Full sky, local lights, weather, clouds and material/exposure response require controlled rendered samples.',
  ], false);
}

/** Normalize an explicit old-engine export or a repo fixture. No ID guessing. */
export function inventoryOldWorld(input, { samples = defaultSamples(), solarHourly } = {}) {
  const scene = input.scene?.scene ?? input.scene;
  const world = input.world ?? {};
  const regions = asRows(world.regions ?? input.regions);
  const entities = asRows(world.entities);
  const levels = new Map((scene?.levels ?? []).map((l) => [l.id, l.y]));
  const buildings = (input.buildings ?? []).map((b) => {
    const polygon = b.rect ? canonicalPolygon(rectPoly(b.rect)) : b.polygon ? canonicalPolygon(b.polygon) : unknown('decorative mesh footprint is not present in exported old building');
    const p = b.p ? point3(b.p) : b.rect ? [(b.rect[0] + b.rect[2]) / 2, 0, (b.rect[1] + b.rect[3]) / 2] : unknown('building origin unavailable');
    return { id: b.id ?? b.file, name: b.label ?? b.name ?? b.id ?? b.file, position: p, yaw: b.yaw ?? 0, polygon, asset: b.file ?? unknown('procedural old building has no asset ID') };
  });
  const interiors = (input.interiors ?? regions.filter((r) => (r.level ?? 0) !== 0 || buildings.some((b) => b.id === r.id))).map((r) => ({
    id: r.id, name: r.label ?? r.name ?? r.id, polygon: canonicalPolygon(r.polygon),
    floorY: r.y ?? levels.get(r.level ?? 0) ?? unknown('floor level height unavailable'),
    fixtures: sorted(entities.filter((e) => e.kind !== 'human' && e.pose && Array.isArray(r.polygon) && contains(r.polygon, e.pose.p[0], e.pose.p[2]) && (e.pose.level ?? e.level ?? 0) === (r.level ?? 0)).map((e) => ({ id: e.id, position: point3(e.pose.p), yaw: e.pose.yaw ?? 0, def: e.def }))),
  }));
  const places = regions.map((r) => ({ id: r.id, name: r.label ?? r.name ?? r.id, kind: r.kind ?? unknown('place kind unavailable'), polygon: canonicalPolygon(r.polygon), floorY: levels.get(r.level ?? 0) ?? unknown('floor level height unavailable') }));
  // Engine links and painted pedestrian paths are different inventories. Retain
  // raw links separately instead of calling stairs a missing painted footpath.
  const paths = input.paths ?? [];
  const samplesChecked = validSamples(samples);
  return {
    schema: CONTENT_SCHEMA, engine: 'old', source: input.source ?? { kind: 'explicit-export', identity: unknown('export source identity unspecified') },
    navigationLinks: { basis: 'exported old-engine world-frame SpatialScene links', records: scene?.links ?? [], status: scene ? 'KNOWN' : 'UNKNOWN' },
    categories: {
      buildings: category(buildings, input.buildings === undefined ? ['building inventory unavailable'] : input.buildingsComplete === false ? ['Only the furnished camp buildings are enumerated; campus backdrop meshes are not an architectural building inventory.'] : [], input.buildings !== undefined && input.buildingsComplete !== false),
      interiors: category(interiors, input.interiorsComplete === false ? ['Camp rooms are inventoried; campus backdrop interior geometry is not exported as rooms.'] : regions.length ? [] : ['old regions/interior export unavailable'], input.interiorsComplete !== false && (input.interiors !== undefined || !!world.regions || input.regions !== undefined)),
      places: category(places, world.regions || input.regions ? [] : ['named regions unavailable'], !!world.regions || input.regions !== undefined),
      paths: category(paths, input.paths ? [] : ['Decorative/painted paths are unavailable; engine navigation links are reported separately.'], input.paths !== undefined),
      hills: category(input.hills ?? [], input.hills ? [] : ['Decorative old hills are not a physical heightfield; no measured hill inventory supplied.'], input.hills !== undefined),
      terrain: category(samplesChecked.map(([x, z]) => ({ id: `${x},${z}`, x, z, height: scene ? legacyGroundHeight(scene, x, z) : unknown('old SpatialScene unavailable') })), ['Physical level-0 support height only; decorative/rendered hills are excluded.'], !!scene),
      skyLighting: hourlyCategory(input.skyHourly, solarHourly),
    },
  };
}

function transformPoint(pose, [x, z]) {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return [pose.x + (x * c + z * s) * pose.s, pose.z + (-x * s + z * c) * pose.s];
}

/** Read compiler/baked physics, not the visual bounding box as a stand-in for rooms. */
export function inventoryCandidate(model, { template, samples = defaultSamples(), solarHourly, skyHourly, source, compilation } = {}) {
  const buildings = [], interiors = [], places = [], paths = [], hills = [], problems = [], navigationLinks = [], namedTargets = [];
  const semanticPlaces = new Map((template?.places ?? []).map((p) => [p.entity, p]));
  for (const entity of model.entities.values()) {
    const def = model.resolvedDef(entity.def), id = model.pathOf(entity.id), pose = model.worldPose(entity);
    if (!def) { problems.push(`${id}: unresolved def ${entity.def}`); continue; }
    let baked;
    try { baked = model.bake(def, entity.params ?? {}, entity.seed ?? 0, entity.shape); }
    catch (error) { problems.push(`${id}: ${error.message}`); continue; }
    const tags = new Set(def.tags ?? []);
    const isBuilding = tags.has('building') || (baked.rooms?.length ?? 0) > 0 || /(?:grotto|vault|temple)/.test(def.name);
    if (isBuilding) buildings.push({
      id, name: entity.state?.label ?? entity.name ?? id, position: [pose.x, pose.y, pose.z], yaw: pose.yaw,
      polygon: unknown('baked collider union is not a single architectural footprint polygon'),
      asset: def.make.kind === 'mesh' ? def.make.asset : unknown('procedural candidate building has no asset ID'),
      // Keep complete footprint evidence for review, without comparing differently
      // segmented wall boxes as if their count measured architectural parity.
      colliders: model.footprint(entity),
    });
    for (const room of baked.rooms ?? []) {
      const path = `${id}/${room.id}`, alias = semanticPlaces.get(path);
      interiors.push({ id: alias?.id ?? path, name: alias?.name ?? room.name, polygon: canonicalPolygon(room.polygon.map((p) => transformPoint(pose, p))), floorY: pose.y + room.y * pose.s, fixtures: sorted([...model.entities.values()].filter((e) => e.in.parent === entity.id && e.in.slot === room.id).map((e) => {
        const q = model.worldPose(e); return { id: e.name ?? model.pathOf(e.id), position: [q.x, q.y, q.z], yaw: q.yaw, def: e.def };
      })) });
    }
    if (entity.shape?.path) paths.push({ id, kind: 'authored-path', path: entity.shape.path, width: entity.shape.width ?? entity.params?.width ?? unknown('width not exported') });
    if (baked.landform) hills.push({ id, position: [pose.x, pose.y, pose.z], shape: entity.shape ?? null, landform: baked.landform, params: entity.params ?? {} });
    for (const link of baked.links ?? []) navigationLinks.push({ ...link, id: `${id}/${link.id}`, frame: 'baked-local', worldPose: pose });
    if (entity.name) namedTargets.push({ id, name: entity.state?.label ?? entity.name, position: [pose.x, pose.y, pose.z], def: entity.def });
  }
  if (template?.places) for (const p of template.places) {
    const room = interiors.find((r) => r.id === p.id), entity = model.get(p.entity);
      const polygon = room?.polygon ?? entity?.shape?.area;
      places.push({ id: p.id, name: p.name ?? p.id, kind: p.kind ?? unknown('place kind unavailable'), polygon: polygon ? canonicalPolygon(polygon) : unknown('place resolves to an entity/point, not a polygon'), floorY: room?.floorY ?? (entity ? model.worldPose(entity).y : unknown(`unresolved place entity ${p.entity}`)), target: p.entity, resolves: !!entity || !!room });
  }
  const partial = (compilation && !compilation.accepted) || problems.length > 0;
  const samplesChecked = validSamples(samples);
  return {
    schema: CONTENT_SCHEMA, engine: 'new', source: source ?? { kind: 'compiler-model', identity: unknown('candidate identity unspecified') },
    compilation: compilation ?? { accepted: true, basis: 'provided compiler model' },
    problems, namedTargets: sorted(namedTargets), navigationLinks: { basis: 'compiler baked-local links with the owning world pose; not asserted engine admission', records: sorted(navigationLinks), status: partial ? 'PARTIAL' : 'KNOWN' }, categories: {
      buildings: category(buildings, problems, !partial),
      interiors: category(interiors, problems, !partial),
      places: category(places, template?.places ? problems : [...problems, 'Candidate has no explicit legacy semantic place map.'], !partial && !!template?.places),
      paths: category(paths, ['Authored path entities; engine navigation links are reported separately.'], !partial),
      hills: category(hills, problems, !partial),
      terrain: category(samplesChecked.map(([x, z]) => ({ id: `${x},${z}`, x, z, height: model.terrain.sample(x, z) })), ['Physical compiler Ground.sample, including applied landforms/pads.'], !partial),
      skyLighting: hourlyCategory(skyHourly, solarHourly, { sky: model.state.sky, weather: model.state.weather }),
    },
  };
}

function deepCompare(a, b, path, out, tolerance) {
  if (isUnknown(a) || isUnknown(b) || a === undefined || b === undefined) {
    out.push({ path, status: 'UNKNOWN', old: a ?? unknown('field unavailable'), candidate: b ?? unknown('field unavailable') }); return;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Number.isFinite(a) || !Number.isFinite(b)) out.push({ path, status: 'UNKNOWN', old: a, candidate: b, reason: 'non-finite measurement' });
    else if (Math.abs(a - b) > tolerance) out.push({ path, status: 'FAIL', old: a, candidate: b, delta: b - a });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push({ path, status: 'FAIL', old: a, candidate: b, reason: 'array length differs' }); return; }
    for (let i = 0; i < a.length; i++) deepCompare(a[i], b[i], `${path}[${i}]`, out, tolerance);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    // Structural evidence that only one engine exposes is retained in inventory.
    // Common normalized fields are comparable; schema-specific extras aren't a
    // fabricated difference. Missing REQUIRED fields remain unknown below.
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (['colliders', 'target', 'resolves'].includes(key)) continue;
      deepCompare(a[key], b[key], `${path}.${key}`, out, tolerance);
    }
    return;
  }
  if (a !== b) out.push({ path, status: 'FAIL', old: a, candidate: b });
}

/** Exact named-ID comparison. UNKNOWN cannot produce an identical verdict. */
export function compareContent(oldInventory, candidateInventory, { numberTolerance = 0 } = {}) {
  if (!Number.isFinite(numberTolerance) || numberTolerance < 0) throw new Error('numberTolerance must be a finite nonnegative number');
  const categories = {};
  for (const name of CATEGORIES) {
    const a = oldInventory.categories?.[name], b = candidateInventory.categories?.[name], checks = [];
    if (!a || !b) checks.push({ path: name, status: 'UNKNOWN', reason: 'category unavailable' });
    else {
      const oldRows = new Map(a.records.map((r) => [r.id, r])), newRows = new Map(b.records.map((r) => [r.id, r]));
      if (oldRows.size !== a.records.length || newRows.size !== b.records.length) checks.push({ path: name, status: 'UNKNOWN', reason: 'duplicate semantic IDs make comparison ambiguous' });
      for (const id of [...new Set([...oldRows.keys(), ...newRows.keys()])].sort()) {
        const old = oldRows.get(id), candidate = newRows.get(id);
        if (!old || !candidate) checks.push({ path: `${name}.${id}`, id, status: (!old ? a : b).status === 'KNOWN' ? 'FAIL' : 'UNKNOWN', reason: !old ? 'only in candidate' : 'missing from candidate', old: old ?? null, candidate: candidate ?? null });
        else {
          const start = checks.length;
          deepCompare(old, candidate, `${name}.${id}`, checks, numberTolerance);
          if (checks.length === start) checks.push({ path: `${name}.${id}`, id, status: 'PASS' });
        }
      }
      if (a.status !== 'KNOWN' || b.status !== 'KNOWN') checks.push({ path: name, status: 'UNKNOWN', reason: 'inventory coverage is incomplete', oldCoverage: a.status, candidateCoverage: b.status });
      if (!checks.length) checks.push({ path: name, status: 'PASS', reason: 'both complete inventories are empty' });
    }
    const status = checks.some((r) => r.status === 'FAIL') ? 'FAIL' : checks.some((r) => r.status === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';
    categories[name] = { status, oldCount: a?.records.length ?? null, candidateCount: b?.records.length ?? null, counts: Object.fromEntries(['PASS', 'FAIL', 'UNKNOWN'].map((s) => [s, checks.filter((r) => r.status === s).length])), checks };
    if (name === 'terrain') {
      const compared = a && b ? a.records.flatMap((r) => { const q = b.records.find((t) => t.id === r.id); return typeof r.height === 'number' && typeof q?.height === 'number' ? [{ id: r.id, delta: q.height - r.height }] : []; }) : [];
      categories[name].sampleMetrics = { requested: a?.records.length ?? 0, comparable: compared.length, maxAbsHeightDelta: compared.length ? Math.max(...compared.map((p) => Math.abs(p.delta))) : null, rmsHeightDelta: compared.length ? Math.sqrt(compared.reduce((s, p) => s + p.delta ** 2, 0) / compared.length) : null };
    }
  }
  const status = Object.values(categories).some((c) => c.status === 'FAIL') ? 'NOT_IDENTICAL' : Object.values(categories).some((c) => c.status === 'UNKNOWN') ? 'UNKNOWN' : 'IDENTICAL';
  return { schema: 'sim-parity-content-diff/1', status, numberTolerance, sources: { old: oldInventory.source, candidate: candidateInventory.source }, categories };
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
async function repoAssets(root) {
  const dir = resolve(root, 'worlds/core-assets'), all = {};
  for (const f of (await readdir(dir)).filter((f) => f === 'index.json' || f.endsWith('.index.json')).sort().reverse()) Object.assign(all, (await readJson(resolve(dir, f))).assets);
  return (hash) => {
    const m = all[hash]; if (!m) return undefined;
    const fp = m.kind === 'footprint' ? m : all[m.footprint];
    return { tris: m.tris, bytes: m.bytes, textures: m.textures, box: m.box, ...(fp?.baked ? { baked: fp.baked } : {}) };
  };
}

/** Same ordered atomic compiler batches as GodMode.applyGenesis, with no server. */
export async function compileTemplate(template, { root = DEFAULT_ROOT, seed = 'parity:content' } = {}) {
  if (template.schema !== 'genesis/1' || !Array.isArray(template.batches)) throw new Error('expected genesis/1 template');
  const { WorldModel, coreLibrary, applyBatch } = await import(pathToFileURL(resolve(root, 'packages/world-compiler/src/index.ts')));
  const model = new WorldModel({ constants: { ground: 'land', extent: 1000, ...template.constants }, seed, assets: await repoAssets(root) });
  model.library = coreLibrary();
  const batches = [...(template.state ? [{ ops: [{ op: 'world', state: template.state }], group: 'genesis:state' }] : []), ...template.batches];
  const results = [];
  for (const [index, batch] of batches.entries()) {
    const { result } = applyBatch(model, { ops: batch.ops, group: batch.group ?? 'genesis' }, 'god', 0);
    results.push({ index, group: batch.group, accepted: result.accepted, failures: result.failures, warnings: result.warnings });
    if (!result.accepted) break;
  }
  return { model, compilation: { accepted: results.length === batches.length && results.every((b) => b.accepted), attempted: results.length, expected: batches.length, results } };
}

async function solarAtHours(root, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('date must be a valid YYYY-MM-DD');
  const [{ solarPosition }, { daylightFactors }] = await Promise.all([
    import(pathToFileURL(resolve(root, 'mars/viewer/engine/env/sun.ts'))),
    import(pathToFileURL(resolve(root, 'mars/viewer/engine/env/daylight.ts'))),
  ]);
  return Array.from({ length: 24 }, (_, hour) => {
    const datetime = `${date}T${String(hour).padStart(2, '0')}:00:00`, s = solarPosition(datetime);
    return { hour, datetime, astronomicalReference: { elevation: s.elevationDeg, azimuth: s.azimuthDeg, direction: s.direction, factors: daylightFactors(s.elevationDeg) } };
  });
}

/** Repo-only default is deliberately labeled a fixture comparison. */
export async function loadRepoComparison(worldName, options = {}) {
  const world = worldName === 'lm' ? 'littlemartians' : worldName;
  if (!['mars', 'littlemartians'].includes(world)) throw new Error('world must be mars or littlemartians');
  const root = resolve(options.root ?? DEFAULT_ROOT), samples = validSamples(options.samples ?? defaultSamples());
  const solarHourly = await solarAtHours(root, options.date ?? '2026-10-15');
  let oldInput = options.oldSnapshot;
  if (!oldInput) {
    if (world === 'mars') {
      const { edenCampWorld, EDEN_CAMP_SCENE, CAMP_BUILDINGS, CAMP_DOORS } = await import(pathToFileURL(resolve(root, 'mars/viewer/engine/scenarios/eden-camp.ts')));
      oldInput = { world: edenCampWorld('parity:mars:old'), scene: EDEN_CAMP_SCENE, buildings: CAMP_BUILDINGS.map((b) => ({ ...b, doors: CAMP_DOORS.filter((d) => d.building === b.id) })) };
      if (options.oldMarsMap) {
        const { mars2026Map, MARS_2026_MAP } = await import(pathToFileURL(resolve(root, 'packages/engine-mars/src/mars-2026-map.ts')));
        const map = mars2026Map(EDEN_CAMP_SCENE);
        oldInput.scene = map.scene;
        for (const r of map.regions) oldInput.world.regions[r.id] = structuredClone(r);
        oldInput.buildingsComplete = false;
        oldInput.interiorsComplete = false;
        oldInput.map = MARS_2026_MAP;
      }
    } else {
      const data = await readJson(resolve(root, 'worlds/littlemartians/scene.json'));
      oldInput = { world: { regions: data.regions }, scene: data.scene, buildings: data.buildings };
    }
    oldInput.source = { kind: 'repo-fixture', world, files: world === 'mars' ? ['mars/viewer/engine/scenarios/eden-camp.ts', 'worlds/mars/camp/manifest.json'] : ['worlds/littlemartians/scene.json'], scope: 'Static repo base, not the deployed old world database, mapped scene or its current residents.' };
    if (oldInput.map) {
      oldInput.source.files.push('packages/engine-mars/src/mars-2026-map.ts', 'mars/viewer/public/engine/campus-2026.json');
      oldInput.source.map = oldInput.map;
      oldInput.source.scope = 'Repo camp with the pinned 2026 campus map applied; not deployed mutable world state. Campus backdrop building/interior mesh inventory is incomplete.';
    }
  }
  const templatePath = options.templatePath ?? `worlds/templates/${world === 'mars' ? 'mars-two' : 'littlemartians-two'}.json`;
  const template = options.template ?? await readJson(resolve(root, templatePath));
  let model, compilation, candidateSource, skyHourly;
  if (options.candidateSnapshot) {
    const bundle = options.candidateSnapshot, snapshot = bundle.snapshot ?? bundle;
    if (!Array.isArray(snapshot.entities) || !snapshot.ground || !Array.isArray(snapshot.defs)) throw new Error('candidate snapshot requires entities, defs and ground');
    const { WorldModel, coreLibrary } = await import(pathToFileURL(resolve(root, 'packages/world-compiler/src/index.ts')));
    model = WorldModel.fromSnapshot({ ...snapshot, defs: [...snapshot.defs, ...(snapshot.library ?? [])], seq: snapshot.counter ?? snapshot.seq ?? 0, editSeq: snapshot.editSeq ?? snapshot.seq ?? 0 }, await repoAssets(root), coreLibrary());
    candidateSource = bundle.source ?? { kind: 'provided-compiler-snapshot', world, seq: snapshot.seq, seed: snapshot.seed };
    skyHourly = bundle.skyHourly;
  } else {
    ({ model, compilation } = await compileTemplate(template, { root, seed: options.seed ?? `parity:${world}:new` }));
    candidateSource = { kind: 'compiled-repo-template', world, file: templatePath, seed: model.seed, scope: 'Ordered genesis batches compiled against this checkout; not the live mutable candidate.' };
  }
  const old = inventoryOldWorld({ ...oldInput, ...(options.oldSkyHourly ? { skyHourly: options.oldSkyHourly } : {}) }, { samples, solarHourly });
  const candidate = inventoryCandidate(model, { template, samples, solarHourly, skyHourly: options.candidateSkyHourly ?? skyHourly, source: candidateSource, compilation });
  return { old, candidate, diff: compareContent(old, candidate) };
}

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--world', '--root', '--out', '--old', '--candidate', '--template', '--samples', '--date', '--seed', '--old-mars-map'].includes(argv[i]) || !argv[i + 1]) throw new Error(`unknown or incomplete option ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.world) throw new Error('--world mars|littlemartians is required');
  if (args['old-mars-map'] !== undefined && !['true', 'false'].includes(args['old-mars-map'])) throw new Error('--old-mars-map must be true or false');
  for (const key of ['root', 'out', 'old', 'candidate', 'template', 'samples']) if (args[key] && !isAbsolute(args[key])) throw new Error(`--${key} must be an absolute path`);
  const result = await loadRepoComparison(args.world, { root: args.root, date: args.date, seed: args.seed, oldMarsMap: args['old-mars-map'] === 'true',
    ...(args.old ? { oldSnapshot: await readJson(args.old) } : {}),
    ...(args.candidate ? { candidateSnapshot: await readJson(args.candidate) } : {}),
    ...(args.template ? { template: await readJson(args.template), templatePath: args.template } : {}),
    ...(args.samples ? { samples: await readJson(args.samples) } : {}),
  });
  const json = JSON.stringify(result, null, 2) + '\n';
  if (args.out) await writeFile(args.out, json); else process.stdout.write(json);
  process.exitCode = result.diff.status === 'IDENTICAL' ? 0 : result.diff.status === 'NOT_IDENTICAL' ? 1 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(JSON.stringify({ status: 'UNKNOWN', error: error.message }) + '\n'); process.exitCode = 2;
});
