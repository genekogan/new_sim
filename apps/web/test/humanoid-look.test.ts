// core/humanoid@2 looks: def-driven params, stable seeds and keys, edits, body records, legacy migration.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bodyV1Schema} from '@sim/protocol';
import {CORE_KIT, WorldModel} from '@sim/world-compiler';
import * as L from '../src/humanoid/look.ts';
import {legacyLook, socialLook} from '../src/humanoid/legacy.ts';
import {SOCIAL_HUMAN_PRESETS, SOCIAL_PUBLIC_ASSIGNMENTS} from '../../../mars/viewer/app/engine-view/content/details/human-presets/presets.mjs';

test('the def is core/humanoid@2, extends @1, and the compiler defines it', () => {
  const w = new WorldModel({constants: {extent: 1000, ground: 'land'}, seed: 'look'}); for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  const d = w.resolvedDef('core/humanoid@2')!; assert.ok(d, 'core/humanoid@2 resolves');
  assert.equal(d.components.body?.rig, 'humanoid', 'body component inherited unchanged from @1');
  assert.equal(Object.keys(L.HUMANOID_PARAMS).length, 23); assert.ok(Object.keys(L.HUMANOID_PARAMS).length <= 24);
  for (const p of L.PRESETS) assert.deepEqual(L.checkLook(L.PRESET_LOOKS[p]), L.PRESET_LOOKS[p], p + ' preset fits the def');
});
test('appearanceFromSeed is stable, complete and varied', () => {
  // golden: a change here changes every seeded Soul's look (bump the def version instead)
  assert.equal(L.lookKey(L.appearanceFromSeed(7)), L.lookKey(L.appearanceFromSeed(7)));
  assert.deepEqual(L.appearanceFromSeed(123456), L.appearanceFromSeed(123456));
  const looks = Array.from({length: 200}, (_, i) => L.appearanceFromSeed(i));
  for (const l of looks) assert.deepEqual(L.resolveLook(l), l, 'seeded looks are canonical');
  assert.ok(new Set(looks.map(L.lookKey)).size === 200, 'no two of 200 seeds collide');
  for (const k of ['frame', 'face', 'hair', 'top', 'bottom', 'shoes', 'hat', 'glasses', 'bag', 'pattern'] as const) {
    const seen = new Set(looks.map(l => l[k])); assert.deepEqual([...seen].sort(), [...(L.HUMANOID_PARAMS[k] as {values: string[]}).values].sort(), `every ${k} value appears`);
  }
  const fem = looks.filter(l => l.frame === 'fem').length; assert.ok(fem > 70 && fem < 130, `frames balanced (${fem}/200 fem)`);
});
test('keys: equal looks share a key; presets resolve exactly; compact round-trips', () => {
  assert.equal(L.lookKey({}), L.lookKey(L.resolveLook({})));
  assert.equal(L.lookKey({hat: 'cap'}), L.lookKey({hat: 'cap', glasses: 'none', headScale: 1.001}), 'defaults and rounding do not split keys');
  assert.notEqual(L.lookKey({hat: 'cap'}), L.lookKey({hat: 'beanie'}));
  assert.match(L.lookKey({}), L.LOOK_MODEL);
  for (const p of L.PRESETS) { assert.deepEqual(L.compactLook(L.resolveLook({preset: p})), {preset: p}); assert.equal(L.lookKey({preset: p, hat: 'cap'}), L.lookKey({preset: p}), 'a preset wins'); }
  const look = L.appearanceFromSeed(99); assert.deepEqual(L.resolveLook(L.compactLook(look)), look);
});
test('edits keep the rest; refusals name the field', () => {
  const e = L.editLook({preset: 'punk'}, {hair: 'bob'}); assert.equal(e.preset, 'none'); assert.equal(e.hair, 'bob'); assert.equal(e.top, 'jacket'); assert.equal(e.hair1, '#7c0f1f');
  assert.deepEqual(L.editLook(e, {preset: 'woman'}), L.resolveLook({preset: 'woman'}));
  assert.throws(() => L.checkLook({wings: 'big'}), /unknown field wings/); assert.throws(() => L.checkLook({skin: 'red'}), /#rrggbb/); assert.throws(() => L.checkLook({headScale: 1.3}), /> 1.1/);
});
test('body records fit BODY-v1 and requests behave', () => {
  const b = L.lookBody(L.appearanceFromSeed(5)); assert.ok(bodyV1Schema.safeParse(b).success);
  assert.ok(!bodyV1Schema.safeParse({...b, model: 'humanoid2-zz'}).success, 'params need a look key model');
  assert.ok(!bodyV1Schema.safeParse({family: 'floater', params: {hat: 'cap'}, model: b.model}).success, 'params are humanoid only');
  assert.deepEqual(L.lookRequest(null, {random: true, seed: 5}, {}, () => 0), b);
  assert.equal(L.lookRequest(b, {hat: 'sunhat'}, {}, () => 0).params.hat, 'sunhat');
  assert.equal(L.lookRequest(undefined, {hat: 'cap'}, {preset: 'woman'}, () => 0).params.top, 'tank', 'edits start from today\'s look');
  assert.throws(() => L.lookRequest(null, {random: true, hat: 'cap'}, {}, () => 0), L.LookError);
});
test('legacy migration: hash template preset; the 8 social Souls keep their palettes as explicit colours', () => {
  for (const id of ['h_a', 'h_b', 'h_c', 'h_006a68883b']) assert.equal(legacyLook(id).preset, L.legacyPreset(id));
  for (const row of SOCIAL_PUBLIC_ASSIGNMENTS as unknown as {actorId: string; stableSoulKey: string; template: string; presetId: string}[]) {
    const look = legacyLook(row.actorId, row.stableSoulKey, true);
    if (L.legacyPreset(row.actorId) !== row.template) { assert.equal(look.preset, L.legacyPreset(row.actorId), 'template drift stays Simple, as the adapter does'); continue; }
    const p = (SOCIAL_HUMAN_PRESETS as unknown as {id: string; materialSlots: {name: string; sRGBHex: string | null}[]}[]).find(x => x.id === row.presetId)!;
    assert.equal(look.preset, 'none'); assert.deepEqual(socialLook(row.presetId), look);
    const skin = p.materialSlots.find(m => m.name === 'Skin')!.sRGBHex!.toLowerCase(); assert.equal(look.skin, skin, row.actorId + ' skin');
    // palette linear values equal the adapter's toLinear(hex) for every painted slot
    const {palette} = L.paletteOf(look), lin = (h: string) => [1, 3, 5].map(i => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
    assert.deepEqual(Array.from(palette.slice(0, 3)).map(v => +v.toFixed(6)), lin(skin).map(v => +v.toFixed(6)));
  }
});
