import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { projectSoul, projectGodSlice, entityOf, serverWindow } from './world-truth.mjs';
const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));
const clock = { t: '2026-10-24T00:00:00.000Z', mono: 1 };

test('public only: place, posture, receipts and position from the last receipt', () => {
  const s = projectSoul({ soulId: 's_6021854a99', pub: fx('public-soul'), world: fx('world'), clock });
  assert.equal(s.name, 'Pip'); assert.equal(s.place, 'field'); assert.deepEqual(s.placePath, ['Green field', 'World']);
  assert.equal(s.posture, 'standing'); assert.equal(s.activity, 'idle'); assert.equal(s.doing, 'standing around');
  assert.deepEqual(s.pos, { x: 0, z: 0, region: null, src: 'lastReceipt' });
  assert.equal(s.lastReceipt.capability, 'sit:here'); assert.equal(s.receipts.length, 1);
  assert.equal(s.fade.colour, 'green'); assert.equal(s.inbox, null); assert.equal(s.world.souls.length, 2);
  assert.equal(s.tick, fx('world').tick);
});

test('owner view adds position, needs, nearby and the inbox', () => {
  const s = projectSoul({ soulId: 's_d0d67e0f21', pub: fx('public-soul'), owner: fx('owner-status'), inbox: fx('owner-inbox'), world: fx('world'), clock });
  assert.equal(s.pos.src, 'owner'); assert.equal(s.pos.region, 'field'); assert.equal(s.mood, 'curious');
  assert.ok(s.needs.energy > 0); assert.equal(s.near[0].who, 'Pip');
  assert.equal(s.inbox.presence, 'away'); assert.equal(s.inbox.latest.text, 'go to the knoll'); assert.equal(s.agent.attached, true);
});

test('soul id maps to world entity id', () => assert.equal(entityOf('s_d0d67e0f21'), 'h_d0d67e0f21'));

test('god slice: radius filter, footprints, souls are not solid obstacles', () => {
  const g = projectGodSlice({ around: [0, 0], radius: 10, where: fx('god-where'), describes: { pip: fx('god-describe-pip'), mira: fx('god-describe-mira'), plaza: fx('god-describe-plaza') } });
  assert.deepEqual(g.entities.map((e) => e.path).sort(), ['mira', 'pip', 'plaza']);
  assert.equal(g.footprints, true); assert.deepEqual(g.insideSolid, []);
  assert.ok(g.inside.some((x) => x.path === 'pip' && x.soul));
  const c = projectGodSlice({ around: [42, 11], radius: 10, where: fx('god-where-cottage'), describes: { cottage: fx('god-describe-cottage') } });
  assert.ok(c.insideSolid.some((x) => x.path === 'cottage'));
  const cot = c.entities.find((e) => e.path === 'cottage');
  assert.equal(cot.layer, 'solid'); assert.ok(cot.footprint.maxX > cot.footprint.minX); assert.ok(cot.slots.length > 0);
});

test('god slice without describes still lists entities, footprints false', () => {
  const g = projectGodSlice({ around: [0, 0], radius: 10, where: fx('god-where'), describes: {} });
  assert.equal(g.footprints, false); assert.ok(g.entities.length >= 3);
});

test('serverWindow slices by time', () => {
  const d = mkdtempSync(join(tmpdir(), 'pt-log-')), log = join(d, 'world.log'), t0 = Date.parse('2026-10-24T10:00:00Z');
  writeFileSync(log, ['2026-10-24T09:59:59.000Z boot', '2026-10-24T10:00:01.000Z a', 'continuation', JSON.stringify({ t: t0 + 3000, msg: 'error x' }), '2026-10-24T10:00:09.000Z late'].join('\n'));
  const w = serverWindow({ log, fromMono: 0, toMono: 5000, runStartMs: t0 });
  assert.equal(w.lines.length, 3); assert.equal(w.errors, 1);
});
