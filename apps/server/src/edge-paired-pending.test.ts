// Quality case 32: an invitation nobody has answered is not a shared activity. The host's receipt reads `waiting`
// (with who it waits for) and `here` reads `inviting` until the guest accepts; then the receipt is `started` again.
import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
import {hereFrame} from './edge/perception/here.ts';

test('an unanswered hug invite keeps the host waiting and inviting until the guest accepts', {timeout: 300000}, async t => {
  const w = await edenNavWorld(2); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a, b] = w.souls;
  const hug: any = await w.act(a, 'hug:' + b.soulId); assert.equal(hug.accepted, true, JSON.stringify(hug));
  for (let i = 0; i < 40; i++) w.f.host.tickOnce();
  const pending: any = w.ledger.receipt(a.soulId, hug.receipt.id);
  assert.equal(pending.phase, 'waiting', JSON.stringify(pending));
  assert.deepEqual(pending.awaitingAnswer.waitingFor.map((g: any) => g.soulId), [b.soulId]);
  assert.match(pending.awaitingAnswer.note, /has not accepted yet/);
  const frame: any = hereFrame(w.ledger, a);
  assert.equal(frame.me.activity.kind, 'inviting', JSON.stringify(frame.me.activity));
  assert.deepEqual(frame.me.activity.with, [b.name]);

  const yes: any = await w.act(b, 'accept'); assert.equal(yes.accepted, true, JSON.stringify(yes));
  for (let i = 0; i < 5; i++) w.f.host.tickOnce();
  const after: any = w.ledger.receipt(a.soulId, hug.receipt.id);
  assert.notEqual(after.phase, 'waiting', JSON.stringify(after)); assert.equal(after.awaitingAnswer, undefined);
  assert.notEqual(hereFrame(w.ledger, a).me.activity.kind, 'inviting');
  await w.run([{soulId: a.soulId, id: hug.receipt.id}, {soulId: b.soulId, id: yes.receipt.id}], 3000);
  assert.equal(w.ledger.receipt(a.soulId, hug.receipt.id)!.phase, 'completed');
});
