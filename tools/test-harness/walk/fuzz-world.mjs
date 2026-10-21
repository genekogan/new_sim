// Lane BS3F (BUILDSAFE, 2026-10-21): the V3-walk fuzz world. Gene: every building and composition, wild godmode builds
// included, must be walkable and usable without anyone noticing a problem first. The fixture worlds (eden-2026, bench-eden)
// only cover what was built there; this world is generated (fixed seed, no randomness at audit time) to cover the rest:
//   sweep     every building/1 type in the catalogue x 5 yaws {0, 90, 180, 270, 37} relative to the fall line, each yaw on
//             one of three grounds (flat, knoll flank ~0.30, knoll flank ~0.43) so every type stands on all three
//   packed    rows of narrow buildings 0.6 / 1.5 m apart along a street, back-to-back pairs, a packed ring round a knoll
//   furnish   every building is furnished by its own recipe, as a god's `furnish <building>` does (furnish.mjs, at audit time)
//   stacked   pieces on the roofs of flat-roof buildings, a pavilion on a deck, buildings on and straddling a terrace,
//   nested    buildings inside a walled garden (open gate), a hedge ring and a fence ring with default gates
// walk-audit.ts --fuzz <this file> boots the terrain as a genesis, then commits each `build` batch as a god would
// (god.act, one batch per place: a refusal is scored, not fatal), then furnishes each building in `furnish` the same way.
// Each root thing's name is its place; the audit scores per place (bad / one-way / goalless / floats / unusable seats and
// beds), and walk.mjs compares with baseline/fuzz.json like any other world.
import structures from '../../../packages/world-compiler/src/core-kit/structures.json' with { type: 'json' };
import vocabW3 from '../../../packages/world-compiler/src/core-kit/vocab-w3.json' with { type: 'json' };

export const FUZZ_SEED = 'bs3f-fuzz-1';
export const YAWS = [0, 90, 180, 270, 37];
/** grounds: flat, and two rings round knolls h15 r60 (probe team/scratch/t4/bs3f/slope.ts: slope 0.30 at 40 m, 0.43 at 25 m) */
export const GROUNDS = { flat: null, s30: 40, s45: 25 };
const KNOLL = { height: 15, radius: 60, peak: 1, edge: 8 };

/** mulberry32 over a string seed: the only randomness, fixed by FUZZ_SEED */
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r3 = (x) => Math.round(x * 1000) / 1000;
const rad = (deg) => r3((deg * Math.PI) / 180);

/** Every building/1 type with its default footprint (40 types). */
export const BUILDING_TYPES = [...structures, ...vocabW3].filter((d) => d?.make?.gen === 'building/1')
  .map((d) => ({ type: String(d.name).replace(/^core-/, ''), w: d.params?.w?.default ?? 8, d: d.params?.d?.default ?? 8, roof: d.params?.roof?.default }));

export function fuzzWorld(seed = FUZZ_SEED) {
  const rand = rng(seed);
  const terrain = [], build = [], furnish = [];
  const add = (place, ops, opts = {}) => { build.push({ place, ops }); if (opts.furnish) furnish.push(place); };
  const ref = (type) => `core/${type}@1`;

  // knolls: a 4 x 7 lattice east of x = 0 (140 m apart); rings are filled in order, a new knoll when one is full
  const knolls = []; let kn = 0;
  const knoll = () => { const i = kn++, c = [60 + 140 * (i % 3), -420 + 140 * Math.floor(i / 3)]; const name = `knoll-${String(i).padStart(2, '0')}`; terrain.push({ op: 'place', def: 'core/knoll@1', name, p: c, params: KNOLL }); return { name, c, used: 0 }; };
  const ring = { s30: null, s45: null };
  /** a site on the `g` ring: the building's centre at the ring radius, angle advanced by its own arc (+ gap) */
  const ringSite = (g, size, gap = 4) => {
    const R = GROUNDS[g], arc = size + gap, cap = 2 * Math.PI * R;
    if (!ring[g] || ring[g].used + arc > cap) { ring[g] = knoll(); knolls.push(ring[g]); }
    const k = ring[g], th = (k.used + arc / 2) / R; k.used += arc;
    return { p: [r3(k.c[0] + R * Math.cos(th)), r3(k.c[1] + R * Math.sin(th))], down: Math.atan2(Math.sin(th), Math.cos(th)) };
  };
  // the flat sweep: a 40 m lattice west of x = -100
  let fl = 0;
  const flatSite = () => { const i = fl++; return { p: [-460 + 42 * (i % 9), -230 + 42 * Math.floor(i / 9)], down: 0 }; };

  // 1. sweep: type i, yaw j stands on ground (i + j) mod 3 (a Latin square, so every type sees every ground)
  const order = ['flat', 's30', 's45'];
  BUILDING_TYPES.forEach(({ type, w, d }, i) => YAWS.forEach((yaw, j) => {
    const g = order[(i + j) % 3], size = Math.hypot(w, d);
    const site = g === 'flat' ? flatSite() : ringSite(g, size);
    // r = the fall line (outward from the knoll) + yaw: at yaw 0 a front-'s' door faces downhill (door out = (-sin r, -cos r))
    const name = `f-${type}-${yaw}-${g}`;
    add(name, [{ op: 'place', def: ref(type), name, p: site.p, r: r3(-(site.down + Math.PI / 2) + rad(yaw)) }], { furnish: true });
  }));

  // 2. packed rows on the flat north strip, along a street (z = 330)
  terrain.push({ op: 'place', def: 'core/street@1', name: 'row-street', shape: { path: [[-470, 330], [-110, 330]] } });
  const narrow = BUILDING_TYPES.filter((b) => b.w <= 9 && b.d <= 11 && b.type !== 'shed' && b.type !== 'pavilion');
  for (const [row, gap, z, yaw] of [['row-a', 0.6, 318, 0], ['row-b', 1.5, 342, 180]]) {
    let x = -460;
    narrow.forEach(({ type, w, d }, k) => {
      const name = `${row}-${String(k).padStart(2, '0')}-${type}`;
      // a front-'s' door faces -z at r = 0: row a (south of the street) turns round, row b faces it as placed
      const jitter = r3((rand() - 0.5) * 0.2);
      add(name, [{ op: 'place', def: ref(type), name, p: [r3(x + w / 2), r3(z + (yaw ? 1 : -1) * (d / 2) + jitter)], r: yaw ? 0 : rad(180) }], { furnish: true });
      x += w + gap;
    });
  }
  // back-to-back pairs: two cottages / townhouses sharing a 0.8 m back gap
  [['cottage', 8, 6], ['townhouse', 6, 10], ['cabin', 6, 5]].forEach(([type, , d], k) => {
    const x = -460 + 30 * k, z = 400;
    add(`pair-${type}-a`, [{ op: 'place', def: ref(type), name: `pair-${type}-a`, p: [x, r3(z - d / 2 - 0.4)], r: 0 }], { furnish: true });
    add(`pair-${type}-b`, [{ op: 'place', def: ref(type), name: `pair-${type}-b`, p: [x, r3(z + d / 2 + 0.4)], r: rad(180) }], { furnish: true });
  });
  // a packed ring of homes round a knoll flank (1 m apart, doors facing downhill)
  { const k = knoll(); const R = 40; let used = 0, n = 0;
    for (const type of ['cottage', 'townhouse', 'house', 'cabin', 'shop', 'corner-shop', 'cafe', 'roundhouse', 'mobile-home', 'tower']) {
      const b = BUILDING_TYPES.find((t) => t.type === type); const arc = Math.max(b.w, b.d) + 1;
      const th = (used + arc / 2) / R; used += arc;
      const name = `ring-${String(n++).padStart(2, '0')}-${type}`;
      add(name, [{ op: 'place', def: ref(type), name, p: [r3(k.c[0] + R * Math.cos(th)), r3(k.c[1] + R * Math.sin(th))], r: r3(-(th + Math.PI / 2)) }], { furnish: true });
    } }

  // 3. stacked: pieces on the roofs of the flat-roof sweep buildings (yaw 0 of each), as eden-2026's roof planters
  for (const { type, roof } of BUILDING_TYPES) {
    if (roof !== 'flat') continue;
    const host = build.find((b) => b.place.startsWith(`f-${type}-0-`));
    host.ops.push(
      { op: 'place', def: 'core/planter-box@1', name: `${host.place}-roof-planter`, in: { parent: host.place, slot: 'roof' }, p: [-1, 0, 1] },
      { op: 'place', def: 'core/bench@1', name: `${host.place}-roof-bench`, in: { parent: host.place, slot: 'roof' }, p: [1, 0, -1] });
  }
  // compositions on the flat south strip (z < -300)
  const cz = -380;
  // a pavilion and a shed on a deck
  terrain.push({ op: 'place', def: 'core/deck@1', name: 'deck-a', shape: { area: [[-460, cz - 10], [-440, cz - 10], [-440, cz + 10], [-460, cz + 10]] }, params: { height: 0.6 } });
  add('deck-pavilion', [{ op: 'place', def: ref('pavilion'), name: 'deck-pavilion', p: [-450, cz - 4], r: 0 }], { furnish: true });
  add('deck-shed', [{ op: 'place', def: ref('shed'), name: 'deck-shed', p: [-450, cz + 5], r: rad(90) }], { furnish: true });
  // a terrace 1.5 m up with a cottage on it and a cabin straddling its edge
  terrain.push({ op: 'place', def: 'core/terrace@1', name: 'terrace-a', shape: { area: [[-420, cz - 15], [-390, cz - 15], [-390, cz + 15], [-420, cz + 15]] }, params: { level: 1.5, edge: 3 } });
  add('terrace-cottage', [{ op: 'place', def: ref('cottage'), name: 'terrace-cottage', p: [-405, cz - 5], r: 0 }], { furnish: true });
  add('terrace-cabin-edge', [{ op: 'place', def: ref('cabin'), name: 'terrace-cabin-edge', p: [-390, cz + 8], r: rad(90) }], { furnish: true });
  // nested: a walled garden with an open gate round a cottage and its bench, a hedge ring and a fence ring with default gates
  const loop = (cx, cz2, hw, hd) => [[cx - hw, cz2 - hd], [cx + hw, cz2 - hd], [cx + hw, cz2 + hd], [cx - hw, cz2 + hd], [cx - hw, cz2 - hd]];
  add('garden-wall', [{ op: 'place', def: 'core/garden-wall@1', name: 'garden-wall', shape: { path: loop(-350, cz, 12, 10) }, params: { gates: [{ at: 12, width: 2.2, state: 'open' }] } }]);
  add('garden-cottage', [{ op: 'place', tmp: '$g', def: ref('cottage'), name: 'garden-cottage', p: [-350, cz + 2], r: 0 },
    { op: 'place', def: 'core/bench@1', name: 'garden-cottage-bench', in: { parent: '$g' }, p: [0, 0, 5] }], { furnish: true });
  add('hedge-ring', [{ op: 'place', def: 'core/hedge@1', name: 'hedge-ring', shape: { path: loop(-300, cz, 9, 9) }, params: { gates: [{ at: 9 }] } }]);
  add('hedge-cabin', [{ op: 'place', def: ref('cabin'), name: 'hedge-cabin', p: [-300, cz], r: rad(37) }], { furnish: true });
  add('fence-ring', [{ op: 'place', def: 'core/fence@1', name: 'fence-ring', shape: { path: loop(-255, cz, 8, 8) }, params: { gates: [{ at: 8, width: 1.4 }] } }]);
  add('fence-pavilion', [{ op: 'place', def: ref('pavilion'), name: 'fence-pavilion', p: [-255, cz], r: 0 }], { furnish: true });

  const genesis = { schema: 'genesis/1', name: 'Walk fuzz', description: `BUILDSAFE fuzz world (${seed}): every building type x yaws x slopes, packed, furnished, stacked and nested.`,
    constants: { extent: 1000, ground: 'land' }, state: { constitution: '# Walk fuzz\nA generated test world.' }, batches: [{ note: 'terrain', ops: terrain }] };
  return { seed, genesis, build, furnish };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const w = fuzzWorld(process.argv[2] ?? FUZZ_SEED);
  console.log(JSON.stringify({ seed: w.seed, terrain: w.genesis.batches[0].ops.length, build: w.build.length, furnish: w.furnish.length, types: BUILDING_TYPES.length }));
}
