import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { addAll, emptyWorld, FIXTURE, human } from '../world/factory.ts';
import { CATALOG } from '../world/catalog.ts';
import type { Entity } from '../world/types.ts';
import type { ActionDef } from '../actions/types.ts';
import { slotsOf } from '../social/slots.ts';
import { OBJECT_ACTIONS, classroomDisplayClear, classroomDisplayFocus, displayReadout, displaySupport } from '../objects/classroom.ts';
import { walkTo } from '../locomotion/walk.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';

const fixture = (id: string, def: string, x = -5, z = 5): Entity => ({ id, def, kind: 'fixture', pose: { p: [x, 0, z], yaw: 0 }, provenance: FIXTURE });

const session: ActionDef<{ display: string }, null, null> = {
  verb: 'test_session', description: 'test display holder', schema: z.strictObject({ display: z.string() }),
  reservations: (_w, p) => [{ resource: `display:${p.display}`, mode: 'exclusive' }],
  plan: () => ({ ok: true, program: null }), start: () => null,
  step: () => ({ status: 'running' }), cancel: () => ({ ok: true }),
};

function setup(...entities: Entity[]) {
  const base = provingGround();
  const world = addAll(emptyWorld('classroom-objects', base), ...entities);
  return new Runtime(world, new Map<string, ActionDef>([[walkTo.verb, walkTo], ...SOCIAL_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef]), ...OBJECT_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef]), [session.verb, session]]), { spatial: new Spatial(base) });
}

test('display and lectern have physical dimensions, distinct capabilities and a usable presenter stand slot', () => {
  const rt = setup(fixture('screen', 'standing-display'), fixture('lectern', 'speaker-lectern', -2, 5), fixture('chair', 'camp-chair', -7, 5));
  assert.deepEqual(CATALOG['standing-display'].size, [1.6, 1.65, 0.36]);
  assert.equal(CATALOG['standing-display'].obstacle, true);
  assert.equal(CATALOG['speaker-lectern'].capabilities?.presenterStation, true);
  assert.equal(displaySupport(rt, 'screen'), null);
  assert.equal(displaySupport(rt, 'lectern')?.code, 'object.no-display');
  assert.equal(displaySupport(rt, 'missing')?.code, 'object.unknown');
  const slots = slotsOf(rt, 'lectern');
  assert.ok(Array.isArray(slots));
  assert.deepEqual(slots.map((s) => [s.id, s.kind, s.p]), [['lectern#presenter', 'stand', [-2, 4.15]]]);
  assert.equal(CATALOG['camp-chair'].capabilities?.display, undefined);
});

test('presenter can claim and reach the lectern through the existing social verb', () => {
  const rt = setup(fixture('lectern', 'speaker-lectern', -2, 5), human('speaker', -4, 3));
  const a = rt.submit('take_slot', { actor: 'speaker', slot: 'lectern#presenter', activity: 'talk' });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  let ticks = 0;
  while (a.phase !== 'occupied' && a.status === 'executing' && ticks++ < 600) rt.step();
  assert.equal(a.phase, 'occupied', a.diagnostic?.message);
  assert.equal(rt.world.entities.speaker.human?.activity, 'talk');
  assert.deepEqual(rt.holder('slot:lectern#presenter'), [a.id]);
  rt.cancel(a.id);
  assert.deepEqual(rt.holder('slot:lectern#presenter'), []);
});

test('validated standalone command persists on/off content in world state and rejects invalid objects/content', () => {
  const rt = setup(fixture('screen', 'standing-display'), fixture('chair', 'camp-chair'));
  const before = rt.stateHash();
  const on = rt.submit('display_control', { display: 'screen', mode: 'on', content: 'Lightning talks' });
  assert.equal(on.status, 'executing');
  rt.step();
  assert.equal(on.status, 'completed');
  assert.notEqual(rt.stateHash(), before);
  assert.deepEqual(displayReadout(rt, 'screen'), { id: 'screen', available: true, mode: 'on', content: 'Lightning talks' });
  assert.equal(rt.world.entities.screen.equipment?.config.content, 'Lightning talks');
  const off = rt.submit('display_control', { display: 'screen', mode: 'off' });
  rt.step();
  assert.equal(off.status, 'completed');
  assert.equal((displayReadout(rt, 'screen') as { mode: string }).mode, 'off');
  assert.equal(rt.submit('display_control', { display: 'chair', mode: 'on' }).diagnostic?.code, 'object.no-display');
  assert.equal(rt.submit('display_control', { display: 'missing', mode: 'on' }).diagnostic?.code, 'object.unknown');
  assert.equal(rt.submit('display_control', { display: 'screen', mode: 'on', content: 'x'.repeat(161) }).diagnostic?.code, 'action.invalid-params');
  rt.world.entities.screen.equipment = { kind: 'display', config: { available: false, mode: 'off' } };
  assert.equal(displaySupport(rt, 'screen')?.code, 'display.unavailable');
  assert.equal(rt.submit('display_control', { display: 'screen', mode: 'on' }).diagnostic?.code, 'display.unavailable');
});

test('session focus and cleanup require the exact live display claim; a competing command conflicts', () => {
  const rt = setup(fixture('screen', 'standing-display'));
  const a = rt.submit('test_session', { display: 'screen' });
  assert.equal(a.status, 'executing');
  assert.equal(classroomDisplayFocus(rt, { session: 'foreign', displayId: 'screen', phase: 'presenting' })?.code, 'display.not-owned');
  assert.equal(classroomDisplayFocus(rt, { session: a.id, displayId: 'screen', phase: 'presenting', floorHolder: 'p1', content: 'Topic A', attentionTarget: { actor: 'p1' } }), null);
  assert.equal((displayReadout(rt, 'screen') as { floorHolder: string }).floorHolder, 'p1');
  assert.equal(rt.submit('display_control', { display: 'screen', mode: 'off' }).diagnostic?.code, 'reservation.conflict');
  assert.equal(classroomDisplayClear(rt, 'foreign', 'screen')?.code, 'display.not-owned');
  assert.equal((displayReadout(rt, 'screen') as { mode: string }).mode, 'on');
  assert.equal(classroomDisplayClear(rt, a.id, 'screen'), null);
  assert.equal((displayReadout(rt, 'screen') as { mode: string }).mode, 'off');
  assert.equal((displayReadout(rt, 'screen') as { session?: string }).session, undefined);
  rt.cancel(a.id);
  assert.equal(rt.holder('display:screen').length, 0);
  assert.equal(classroomDisplayFocus(rt, { session: a.id, displayId: 'screen', phase: 'presenting' })?.code, 'display.not-owned');
});
