import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyOracles } from '../journey-oracles.mjs';
const epoch = Date.parse('2026-10-27T12:00:00Z');
const iso = n => new Date(epoch + n * 1000).toISOString();
const sample = (n, posture = 'seated', x = 1) => ({ t: iso(n), pos: [x, 2], posture });
const phase = { name: 'podium seat', region: { pos: [1, 2], radiusM: 0.5 }, postures: ['seated'], receipt: { capabilities: ['sit:podium-seat'] } };
function score(extra = {}, phases = [phase], receipts = [{ id: 'r', capability: 'sit:podium-seat', acceptedAt: iso(2), phase: 'completed' }]) {
  return Object.fromEntries(journeyOracles({ ev: { sentAt: iso(0), cutoffAt: iso(30), samples: [sample(4), sample(6)], resultAt: iso(6), resultState: 'done', ...extra }, journey: { fixtureId: 'podium-v1', source: 'immutable geometry fixture', phases }, receipts, replies: [], acts: [], acceptedMs: r => Date.parse(r.acceptedAt), endedMs: r => Date.parse(r.endedAt) }).map(r => [r.id, r]));
}
test('exact seat receipt plus physical region and posture completes; prose and nearby ground sit cannot', () => {
  assert.equal(score()['journey-completion'].status, 'pass');
  assert.equal(score({}, [phase], [{ capability: 'sit:here', acceptedAt: iso(2) }])['journey-completion'].status, 'fail');
  assert.equal(score({ samples: [sample(6, 'standing')] })['journey-completion'].status, 'fail');
  assert.equal(score({ samples: [sample(6, 'seated', 3)] })['journey-completion'].status, 'fail');
});
test('false done catches early or expired posture and excludes late samples and stale receipts', () => {
  assert.equal(score({ resultAt: iso(1) })['journey-truthfulness'].status, 'fail');
  assert.equal(score({ samples: [sample(4), sample(6, 'standing')], resultAt: iso(7) })['journey-truthfulness'].status, 'fail');
  assert.equal(score({ samples: [sample(31)] })['journey-completion'].status, 'unknown');
  assert.equal(score({}, [phase], [{ capability: 'sit:podium-seat', acceptedAt: iso(-1) }])['journey-completion'].status, 'fail');
});
test('swim then exit must occur in order, and hold cannot bridge standing sample', () => {
  const swim = { name: 'swim', region: { pos: [1,2], radiusM: 1 }, postures: ['swimming'] };
  const exit = { ...swim, name: 'exit', postures: ['standing'] };
  assert.equal(score({ samples: [sample(2, 'standing'), sample(3, 'swimming')] }, [swim, exit])['journey-completion'].status, 'fail');
  assert.equal(score({ samples: [sample(2, 'swimming'), sample(4, 'standing')] }, [swim, exit])['journey-completion'].status, 'pass');
  assert.equal(score({ samples: [sample(2),sample(3,'standing'),sample(6)] }, [{ ...phase, holdSec: 3 }])['journey-completion'].status, 'fail');
});

test('legitimate alternatives bind each physical region to its own receipt', () => {
  const alternatives={name:'study seat',postures:['seated'],anyOf:[{region:{pos:[1,2],radiusM:0.5},receipt:{capabilities:['sit:chair-a']}},{region:{pos:[10,2],radiusM:0.5},receipt:{capabilities:['sit:chair-b']}}]};
  const receipt=capability=>[{capability,acceptedAt:iso(2)}];
  assert.equal(score({},[alternatives],receipt('sit:chair-a'))['journey-completion'].status,'pass');
  assert.equal(score({samples:[sample(6,'seated',10)]},[alternatives],receipt('sit:chair-b'))['journey-completion'].status,'pass');
  assert.equal(score({},[alternatives],receipt('sit:chair-b'))['journey-completion'].status,'fail');
  assert.equal(score({samples:[sample(4),sample(6,'seated',10)]},[{...alternatives,holdSec:2}],receipt('sit:chair-a'))['journey-completion'].status,'fail');
});

test('shore return needs the real bank place as well as standing near the lake',()=>{
 const bank={name:'bank',region:{pos:[1,2],radiusM:20},postures:['standing'],places:['lake.bank']};
 assert.equal(score({samples:[{...sample(6,'standing'),place:'lake.water'}]},[bank])['journey-completion'].status,'fail');
 assert.equal(score({samples:[{...sample(6,'standing'),place:'lake.bank'}]},[bank])['journey-completion'].status,'pass');
});
