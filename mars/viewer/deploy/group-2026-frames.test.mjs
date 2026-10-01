import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { groupRecords } from './group-2026-frames.mjs';

const post = (id, x, z, height = 4.8768, base = 0) => ({
  id, kind: 'rack_member', assembly: 'test', pos: [x, z], spans: [0.09, 0.09, height], base, top: base + height,
});
const candidate = (id, x, z, length = 3.6576, yaw = Math.PI / 2) => ({
  id, kind: 'beam_candidate', assembly: 'test', pos: [x, z], spans: [0.12, length, 0.125], yaw, base: 2, top: 2.125,
});
const pair = [post('rack_member-0001', 0, 0), post('rack_member-0002', 1.02, 0)];

test('all real 2026 input components appear exactly once, with stable counts', () => {
  const data = JSON.parse(readFileSync(new URL('../../docs/engineering/data/campus-2026-frames.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../public/modular/components.json', import.meta.url), 'utf8'));
  const inputs = manifest.instances.filter((i) => i.kind === 'rack_member' || i.kind === 'beam_candidate').map((i) => i.id);
  const outputs = [...data.frames.flatMap((f) => [...f.posts, ...f.members]), ...data.beams.map((b) => b.component), ...data.unclassified.map((u) => u.component)];
  assert.equal(data.counts.rackMemberComponents, 667);
  assert.equal(data.counts.sceneRackMemberComponents, 660);
  assert.equal(data.counts.beamCandidates, 89);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  assert.deepEqual(outputs.sort(compare), inputs.sort(compare));
  assert.equal(new Set(outputs).size, outputs.length);
});

test('grouping is independent of input order, and committed outputs pass --check', () => {
  const records = [...pair, post('rack_member-0003', 0, 3.6576), post('rack_member-0004', 1.02, 3.6576), candidate('beam_candidate-0001', 0, 1.8288)];
  assert.equal(JSON.stringify(groupRecords(records)), JSON.stringify(groupRecords([...records].reverse())));
  const out = execFileSync(process.execPath, ['deploy/group-2026-frames.mjs', '--check'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.match(out, /byte-identical/);
});

test('valid beam records both frame ends and unsnapped seat evidence', () => {
  const data = groupRecords([...pair, post('rack_member-0003', 0, 3.6576), post('rack_member-0004', 1.02, 3.6576), candidate('beam_candidate-0001', 0, 1.8288)]);
  assert.equal(data.frames.length, 2);
  assert.equal(data.beams.length, 1);
  assert.equal(data.beams[0].seats.length, 2);
  assert.ok(data.beams[0].seats.every((s) => s.nearestCatalogSeat && s.offset !== null));
});

test('a lone post and mismatched-height pair refuse with named reasons', () => {
  assert.equal(groupRecords([pair[0]]).unclassified[0].code, 'lone-post');
  const data = groupRecords([pair[0], post('rack_member-0002', 1.02, 0, 4.3)]);
  assert.equal(data.frames.length, 0);
  assert.ok(data.unclassified.every((u) => u.code === 'post-height-mismatch'));
});

test('beam endpoints must land on two different frames', () => {
  const miss = groupRecords([...pair, post('rack_member-0003', 0, 3.6576), post('rack_member-0004', 1.02, 3.6576), candidate('beam_candidate-0001', 2, 1.8288)]);
  assert.equal(miss.unclassified.find((u) => u.component === 'beam_candidate-0001').code, 'beam-end-miss');
  const cross = groupRecords([...pair, candidate('beam_candidate-0002', 0.51, 0, 1.02, 0)]);
  assert.equal(cross.unclassified.find((u) => u.component === 'beam_candidate-0002').code, 'beam-same-frame');
});

test('non-nominal post height stays provisional and is never snapped to 16 ft', () => {
  const data = groupRecords([post('rack_member-0001', 0, 0, 4.292), post('rack_member-0002', 1.02, 0, 4.292)]);
  assert.equal(data.frames.length, 1);
  assert.equal(data.frames[0].height, 4.292);
  assert.equal(data.frames[0].catalogDef, null);
  assert.equal(data.frames[0].confidence, 'provisional');
});

test('missing scene prism stays counted as manifest input with an explicit refusal', () => {
  const data = groupRecords([{ ...candidate('beam_candidate-missing', 0, 0), pos: null }]);
  assert.equal(data.counts.beamCandidates, 1);
  assert.equal(data.counts.sceneBeamCandidateComponents, 0);
  assert.equal(data.beams.length, 0);
  assert.equal(data.unclassified[0].component, 'beam_candidate-missing');
  assert.equal(data.unclassified[0].code, 'no-scene-prism');
});
