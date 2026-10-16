// W7 soundscape planning (no WebAudio): lists of sounds per def, variants per instance, ambience by place and time,
// residents' chatter and footsteps, the visitor's feet, and settings that persist.
//   node --test apps/web/src/gen-mesh/sound-plan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentsSchema } from '@sim/world-compiler';
import { ambienceAt, DEFAULT_SETTINGS, emittersOf, loadSettings, Movement, saveSettings, SETTINGS_KEY, specsOf, variantOf, VARIANTS, KINDS, MASTER_DEFAULT } from './sound-plan.ts';

test('a def may carry one sound or a list; unknown kinds are dropped; the schema accepts both', () => {
  assert.equal(specsOf({ components: { sound: { kind: 'water', radius: 10, volume: 0.5 } } } as never).length, 1);
  const two = specsOf({ components: { sound: [{ kind: 'water', radius: 10, volume: 0.5 }, { kind: 'hum', radius: 6, volume: 0.2 }, { kind: 'nope' }] } } as never);
  assert.deepEqual(two.map((s) => s.kind), ['water', 'hum']);
  assert.ok(componentsSchema.safeParse({ sound: [{ kind: 'water' }, { kind: 'chatter', variant: 2 }] }).success);
  assert.ok(componentsSchema.safeParse({ sound: { kind: 'crickets' } }).success);
  assert.ok(!componentsSchema.safeParse({ sound: { kind: 'kazoo' } }).success);
  assert.ok(!componentsSchema.safeParse({ sound: [] }).success);
});

test('every kind has more than one voicing, and instances spread over them', () => {
  for (const k of KINDS) assert.ok(VARIANTS[k] >= 2, k);
  const seen = new Set<number>(); for (let i = 0; i < 40; i++) seen.add(variantOf('birds', `fountain-${i}`));
  assert.equal(seen.size, VARIANTS.birds);
  assert.equal(variantOf('music', 'x', 6), 6 % VARIANTS.music);   // a pinned variant wins
});

test('emittersOf: each spec of a multi-sound def is its own emitter with its own variant', () => {
  const def = { components: { sound: [{ kind: 'water', radius: 10, volume: 0.5 }, { kind: 'birds', radius: 20, volume: 0.3 }] }, state: { on: { default: true } }, form: 'point', size: { box: [1, 2, 1] } };
  const model = {
    entities: new Map([['f1', { id: 'f1', def: 'd', in: { parent: 'world' }, params: { soundVariant: 2 } }], ['f2', { id: 'f2', def: 'd', in: { parent: 'world' }, params: {} }]]),
    resolvedDef: () => def, worldPose: () => ({ x: 1, y: 0, z: 2, s: 1 }), terrain: { sample: () => 0 },
  };
  const em = emittersOf(model as never);
  assert.deepEqual(em.map((e) => e.id), ['f1#0', 'f1#1', 'f2#0', 'f2#1']);
  assert.equal(em[0].spec.variant, 2);
  assert.deepEqual(em[0].pts, [[1, 1, 2]]);
  assert.ok(em.every((e) => e.source === 'object' && e.state.on === true));
});

test('ambience: wind always, birds by day, crickets by night, waves near water, muffled indoors', () => {
  const base = { x: 10, y: 1.7, z: 10, ground: 0, night: 0, covered: false, waters: [] as never[] };
  const day = ambienceAt(base), night = ambienceAt({ ...base, night: 1 });
  assert.ok(day.some((e) => e.spec.kind === 'wind'));
  assert.ok(day.some((e) => e.spec.kind === 'birds') && !day.some((e) => e.spec.kind === 'crickets'));
  assert.ok(night.some((e) => e.spec.kind === 'crickets') && !night.some((e) => e.spec.kind === 'birds'));
  const lake = ambienceAt({ ...base, waters: [{ area: [[0, 0], [5, 0], [5, 5], [0, 5]], level: 0 }] });
  assert.ok(lake.some((e) => e.spec.kind === 'waves' && e.area));
  const inside = ambienceAt({ ...base, covered: true });
  assert.ok(inside.find((e) => e.spec.kind === 'wind')!.spec.volume < day.find((e) => e.spec.kind === 'wind')!.spec.volume);
  // deterministic: the same place gives the same singers
  assert.deepEqual(ambienceAt(base).map((e) => e.id), day.map((e) => e.id));
});

test('residents: footsteps where they walk, chatter where two or more stand together; the visitor walks at eye height', () => {
  const m = new Movement(), cam = { x: 0, y: 1.7, z: 0, ground: 0 };
  m.emitters([{ id: 'a', p: [0, 0, 0] }, { id: 'b', p: [2, 0, 0] }, { id: 'c', p: [20, 0, 0] }], cam, 0);
  const out = m.emitters([{ id: 'a', p: [0, 0, 0] }, { id: 'b', p: [2, 0, 0] }, { id: 'c', p: [20.5, 0, 0] }], { ...cam, x: 0.5 }, 0.5);
  assert.ok(out.some((e) => e.id === 'res:steps:c' && e.spec.kind === 'footsteps'));
  assert.ok(out.some((e) => e.id === 'res:chatter:a+b' && e.spec.kind === 'chatter' && e.state.size === 2));
  assert.ok(out.some((e) => e.id === 'me:steps' && e.source === 'visitor'));
  const high = m.emitters([], { x: 3, y: 40, z: 0, ground: 0 }, 1.0);
  assert.ok(!high.some((e) => e.id === 'me:steps'), 'no footsteps from an overhead camera');
});

test('settings: quiet by default, music opt-in, remembered, robust to junk and to storage failures', () => {
  assert.deepEqual(loadSettings(null), { ...DEFAULT_SETTINGS });
  assert.ok(MASTER_DEFAULT <= 0.35 && DEFAULT_SETTINGS.music === false && DEFAULT_SETTINGS.muted === false);
  const mem = new Map<string, string>(), store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  saveSettings(store, { muted: true, volume: 0.2, music: true });
  assert.deepEqual(loadSettings(store), { muted: true, volume: 0.2, music: true });
  mem.set(SETTINGS_KEY, '{bad'); assert.deepEqual(loadSettings(store), { ...DEFAULT_SETTINGS });
  saveSettings({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, DEFAULT_SETTINGS);   // must not throw
});
