// Lane AMBIENT: recorded ambient beds (no real WebAudio; a fake AudioContext records the graph).
//   node --test apps/web/src/gen-mesh/ambient-beds.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BED_URLS, bedMix, createBeds, DUCK, LAYERS, LEVEL, MAX_PAN, presence, STOP_AFTER_MS, type BedHeard } from './ambient-beds.ts';

const at = (kind: string, gain: number, p: [number, number, number], source = 'ambient', d = 20, follow = false): BedHeard => ({ kind, source, gain, d, e: { pts: [p], follow } });
const L = { x: 0, z: 0, right: [1, 0] as [number, number] };
const calm = { exposure: 0, covered: false, music: false };

test('each layer follows the strongest procedural emitter of its kind, never stacking two', () => {
  const m = bedMix([at('birds', 0.1, [-10, 0, 0]), at('birds', 0.2, [10, 0, 0]), at('crickets', 0.05, [0, 0, 10])], L, calm);
  assert.equal(m.birds.gain, LEVEL.birds * presence(0.2)); assert.equal(presence(0.2), 1); assert.equal(presence(0.004), 0);
  assert.equal(m.crickets.gain, LEVEL.crickets * presence(0.05)); assert.ok(m.crickets.gain > 0.3 * LEVEL.crickets && m.crickets.gain < LEVEL.crickets);
  assert.equal(m.water.gain, 0); assert.equal(m.chatter.gain, 0); assert.equal(m.wind.gain, 0);
});

test('pan points toward the strongest source: right is positive, straight ahead and following sources are centred', () => {
  assert.equal(bedMix([at('birds', 0.2, [10, 0, 0])], L, calm).birds.pan, MAX_PAN);
  assert.equal(bedMix([at('birds', 0.2, [-10, 0, 0])], L, calm).birds.pan, -MAX_PAN);
  assert.ok(Math.abs(bedMix([at('birds', 0.2, [0, 0, -10])], L, calm).birds.pan) < 1e-9);
  assert.equal(bedMix([at('waves', 0.2, [10, 0, 0], 'ambient', 0, true)], L, calm).water.pan, 0);
  // an area of water: the nearest point decides the direction
  const lake: BedHeard = { kind: 'waves', source: 'ambient', gain: 0.2, d: 5, e: { pts: [[-40, 0, 0], [5, 0, 0], [-40, 0, 30]] } };
  assert.equal(bedMix([lake], L, calm).water.pan, MAX_PAN);
});

test('chatter bed only for Souls (resident sources), wind only on exposed open ground', () => {
  assert.equal(bedMix([at('chatter', 0.2, [0, 0, 5], 'visitor')], L, calm).chatter.gain, 0);
  assert.ok(bedMix([at('chatter', 0.2, [0, 0, 5], 'resident')], L, calm).chatter.gain > 0);
  assert.equal(bedMix([], L, { ...calm, exposure: 0.5 }).wind.gain, 0);
  assert.equal(bedMix([], L, { ...calm, exposure: 1 }).wind.gain, LEVEL.wind);
  assert.equal(bedMix([], L, { ...calm, exposure: 1, covered: true }).wind.gain, 0);
});

test('the Sim Score ducks every bed', () => {
  const a = bedMix([at('birds', 0.2, [1, 0, 0])], L, { exposure: 1, covered: false, music: false });
  const b = bedMix([at('birds', 0.2, [1, 0, 0])], L, { exposure: 1, covered: false, music: true });
  assert.equal(b.birds.gain, a.birds.gain * DUCK); assert.equal(b.wind.gain, a.wind.gain * DUCK);
});

test('every bed file exists, is small, and is a real mp3', () => {
  for (const l of LAYERS) {
    const p = fileURLToPath(BED_URLS[l]); assert.ok(existsSync(p), p);
    const n = statSync(p).size; assert.ok(n > 50_000 && n < 250_000, `${l} ${n}`);
    const h = readFileSync(p).subarray(0, 3); assert.ok(h.toString('latin1') === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0), `${l} is not an mp3`);
  }
});

// ---- fake WebAudio
class Param { value = 0; calls: number[] = []; setTargetAtTime(v: number) { this.value = v; this.calls.push(v); } }
class Node { to: Node[] = []; connect(n: Node) { this.to.push(n); return n; } disconnect() { this.to = []; } }
class Src extends Node { buffer: unknown = null; loop = false; loopStart = 0; loopEnd = 0; started: number[] | null = null; stopped = false; start(t: number, off: number) { this.started = [t, off]; } stop() { this.stopped = true; } }
class FakeCtx { currentTime = 0; srcs: Src[] = []; createGain() { return Object.assign(new Node(), { gain: new Param() }); } createStereoPanner() { return Object.assign(new Node(), { pan: new Param() }); } createBufferSource() { const s = new Src(); this.srcs.push(s); return s; } }
const flush = () => new Promise((r) => setTimeout(r, 0));

test('graph: a layer loads lazily, plays one looping source, fades, and stops after a quiet spell', async () => {
  const ctx = new FakeCtx(), out = new Node(), loads: string[] = [];
  const beds = createBeds(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, BED_URLS, async (_c, url) => { loads.push(url); return { duration: 24.6 } as AudioBuffer; }, () => 0.5);
  const quiet = bedMix([], L, calm), birds = bedMix([at('birds', 0.2, [10, 0, 0])], L, calm);
  beds.update(quiet, 0); assert.equal(loads.length, 0, 'nothing fetched while no layer is heard');
  beds.update(birds, 100); await flush(); beds.update(birds, 200); beds.update(birds, 300); await flush(); beds.update(birds, 400);
  assert.deepEqual(loads, [BED_URLS.birds], 'only the heard layer is fetched, once');
  assert.equal(ctx.srcs.length, 1, 'one source, never stacked');
  const s = ctx.srcs[0]; assert.equal(s.loop, true); assert.ok(s.loopEnd - s.loopStart > 23.9); assert.ok(s.started![1] > s.loopStart && s.started![1] < s.loopEnd);
  const st = beds.state().find((b) => b.layer === 'birds')!; assert.equal(st.playing, true); assert.equal(st.pan, MAX_PAN);
  beds.update(quiet, 1000); beds.update(quiet, 1000 + STOP_AFTER_MS / 2); assert.equal(s.stopped, false, 'a short quiet spell keeps the loop');
  beds.update(quiet, 1000 + STOP_AFTER_MS + 1); assert.equal(s.stopped, true);
  beds.update(birds, 30000); assert.equal(ctx.srcs.length, 2, 'comes back from the cached buffer without a second fetch'); assert.equal(loads.length, 1);
  beds.stop(); assert.equal(ctx.srcs[1].stopped, true);
});

test('graph: a failed fetch is not retried every tick', async () => {
  const ctx = new FakeCtx(); let n = 0;
  const beds = createBeds(ctx as unknown as BaseAudioContext, new Node() as unknown as AudioNode, BED_URLS, async () => { n++; throw new Error('404'); });
  const birds = bedMix([at('birds', 0.2, [1, 0, 0])], L, calm);
  for (let t = 0; t < 2000; t += 100) { beds.update(birds, t); await flush(); }
  assert.equal(n, 1); assert.equal(ctx.srcs.length, 0);
});
