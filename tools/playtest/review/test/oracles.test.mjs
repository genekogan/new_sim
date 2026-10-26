import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadRun } from '../run.mjs';
import { runOracles, runAllOracles, ORACLE_IDS } from '../oracles.mjs';
import { FIX, MAIN } from './helpers.mjs';

const run = loadRun(join(FIX, MAIN));
const all = runAllOracles(run);
const st = (rid, id) => all[rid].find((o) => o.id === id);
const ev = (rid) => structuredClone(run.evidence.find((e) => e.requestId === rid));

test('every oracle reports for every request, with pointers on decisive results', () => {
  for (const rid of ['r1', 'r2', 'r3']) { assert.deepEqual(all[rid].map((o) => o.id), ORACLE_IDS); for (const o of all[rid]) { assert.ok(['pass', 'fail', 'unknown'].includes(o.status)); assert.ok(Array.isArray(o.pointers)); assert.equal(o.requestId, rid); } }
  assert.ok(st('r3', 'arrival').pointers[0].startsWith('evidence/r3.json#samples['));
});
test('r1 clean hit: sit down', () => {
  for (const id of ['ack-latency', 'result-sent', 'listen-open', 'posture', 'duration-held', 'inside-solid', 'truthfulness-basic', 'vocabulary', 'duplicate-acts', 'server-errors', 'first-body-change', 'stuck-receipt']) assert.equal(st('r1', id).status, 'pass', id);
  for (const id of ['arrival', 'no-progress', 'oscillation']) assert.equal(st('r1', id).status, 'unknown', id);
});
test('r2 vocabulary miss with an honest reply', () => {
  assert.equal(st('r2', 'vocabulary').status, 'fail');
  assert.match(st('r2', 'vocabulary').detail, /say hi to the duck/);
  assert.equal(st('r2', 'truthfulness-basic').status, 'pass');
  assert.equal(st('r2', 'ack-latency').status, 'unknown');
  assert.equal(st('r2', 'first-body-change').status, 'unknown');
  assert.equal(st('r2', 'inside-solid').status, 'unknown', 'godSlice without footprints');
});
test('r3 wrong: claims arrival, body stuck in the market, walk never completes', () => {
  for (const id of ['arrival', 'truthfulness-basic', 'no-progress', 'stuck-receipt']) assert.equal(st('r3', id).status, 'fail', id);
  assert.equal(st('r3', 'inside-solid').status, 'unknown', 'no godSlice');
  assert.equal(st('r3', 'oscillation').status, 'pass');
});
test('late samples are excluded: arriving after cutoff does not pass arrival', () => {
  const e = ev('r3'); e.samples.push({ ...e.samples.at(-1), t: '2026-10-24T12:04:30.000Z', place: 'Library', placePath: ['Eden', 'Library'], pos: { x: 60, y: 0, z: 40 } });
  const r = runOracles(e, { run });
  assert.equal(r.find((o) => o.id === 'arrival').status, 'fail');
  assert.equal(r[0].lateSamplesExcluded, 1);
});
test('arrival passes when the body is at the target by cutoff', () => {
  const e = ev('r3'); e.samples.at(-1).place = 'Library';
  assert.equal(runOracles(e, { run }).find((o) => o.id === 'arrival').status, 'pass');
});
test('inside-solid fails when a sample is inside a solid footprint; unknown without footprints', () => {
  const e = ev('r1'); e.samples[0].pos = { x: 5, y: 0, z: 3 };
  assert.equal(runOracles(e, { run }).find((o) => o.id === 'inside-solid').status, 'fail');
  const e2 = ev('r1'); e2.godSlice = { entities: [{ id: 'x' }] };
  assert.equal(runOracles(e2, { run }).find((o) => o.id === 'inside-solid').status, 'unknown');
  const e3 = ev('r1'); delete e3.godSlice;
  assert.equal(runOracles(e3, { run, godSlice: { entities: [{ id: 'tree', footprint: { center: [10, 5], radius: 1 } }] } }).find((o) => o.id === 'inside-solid').status, 'fail', 'ctx godSlice + circle footprint');
});
test('oscillation, duration-held, listen-open, duplicate-acts, server-errors, ack bound fail on synthetic packs', () => {
  const e = ev('r3'); e.samples.forEach((s, i) => { s.pos = { x: i % 2 ? 20 : 14, y: 0, z: 10 }; });
  assert.equal(runOracles(e, { run }).find((o) => o.id === 'oscillation').status, 'fail');
  const e1 = ev('r1'); e1.samples[5].posture = 'standing';
  assert.equal(runOracles(e1, { run }).find((o) => o.id === 'duration-held').status, 'fail');
  const e2 = ev('r1'); e2.legible[1].card.presence = 'offline';
  assert.equal(runOracles(e2, { run }).find((o) => o.id === 'listen-open').status, 'fail');
  const acts = [{ turn: 2, cmd: 'node eden.mjs act "sit down" --wait', output: { accepted: true } }, { turn: 2, cmd: 'node eden.mjs act "sit down"', output: { accepted: true } }];
  assert.equal(runOracles(ev('r1'), { acts }).find((o) => o.id === 'duplicate-acts').status, 'fail');
  const e4 = ev('r1'); e4.serverErrors = 2;
  assert.equal(runOracles(e4, { run }).find((o) => o.id === 'server-errors').status, 'fail');
  const e5 = ev('r1'); e5.ackAt = '2026-10-24T12:00:45.000Z';
  assert.equal(runOracles(e5, { run }).find((o) => o.id === 'ack-latency').status, 'fail');
});
test('vocabulary passes when the world offered a match', () => {
  const acts = [{ turn: 3, cmd: 'node eden.mjs act "pet the duck"', output: { accepted: false, code: 'capability.unknown', did_you_mean: ['feed:ducks'] } }];
  assert.equal(runOracles(ev('r2'), { acts }).find((o) => o.id === 'vocabulary').status, 'pass');
});
