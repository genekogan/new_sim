// Golden take ids (S1 V7b, tranche 2026-10-19): the take recorder's speed-ups (shared unchanged entities, a cached id
// order, sampling only what the engine moves) must leave every take byte-identical. The pins below were recorded with
// the recorder as it was before them (main 77cc94ce). The run covers what a live god world does between takes: Souls
// walking, entity-world fixtures (never sampled, but in every final state), a fixture moved in place, one replaced,
// one added and one removed, a connection pushed onto an array in place, a plain sampled thing appearing and going,
// and the shared entity physics replaced. Every take is cut the way the engine cuts its chunks (finish, then a new
// recorder seeded with that final state hash).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify } from '../core/hash.ts';
import { humanHumanSeparation, humanStaticClearance } from '../runtime/invariants.ts';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { component, emptyWorld, human } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { TakeRecorder, takeIdOf } from '../take/recorder.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Take } from '../take/types.ts';
import type { Entity } from '../world/types.ts';
import { openGround } from './frame-fixtures.ts';

const fixture = (i: number): Entity => ({ ...component(`f${i}`, 'bench-6ft', [30 + 3 * i, 0, 30], i * 0.1), tags: ['entity-world'], label: `bench ${i}` });
const physics = (n: number) => ({ version: 'entity-physics/1', hash: String(n).repeat(64).slice(0, 64), levels: [{ id: 0, y: 0 }], byEntity: { f1: { n } }, assets: {} });

function run(): Take[] {
  const w = emptyWorld('open', openGround());
  w.entities.a = human('a', 0, -1);
  w.entities.b = human('b', 0, 1);
  for (let i = 0; i < 40; i++) w.entities[`f${i}`] = fixture(i);
  (w as unknown as { entityPhysicsV1: unknown }).entityPhysicsV1 = physics(1);
  const rt = new Runtime(w, new Map<string, ActionDef>([[walkTo.verb, walkTo as ActionDef]]), { spatial: new Spatial(openGround()) }, [humanHumanSeparation, humanStaticClearance]);
  rt.submit('walk_to', { actor: 'a', x: 5, z: -1 });
  rt.submit('walk_to', { actor: 'b', x: -5, z: 2 });
  const opts = { rulesVersion: 'golden', planHash: 'golden' };
  const takes: Take[] = [];
  let rec = new TakeRecorder(rt, opts);
  for (let t = 1; t <= 160; t++) {
    rt.step();
    const ents = rt.world.entities;
    if (t === 30) ents.f3.pose.p[0] += 1;                                                  // moved in place
    if (t === 50) ents.f4 = { ...ents.f4, pose: { ...ents.f4.pose, yaw: 1.5 } };            // replaced
    if (t === 70) { ents.f40 = fixture(40); delete ents.f5; }                                // added, removed
    if (t === 75) ents.box = component('box', 'bench-6ft', [-30, 0, -30]);                  // a sampled thing appears
    if (t === 90) { (ents.f6.connections ??= []).push({ socket: 's', to: 'f7', toSocket: 't' }); ents.f7.state = { on: true }; }
    if (t === 110) (rt.world as unknown as { entityPhysicsV1: unknown }).entityPhysicsV1 = physics(2);
    if (t === 125) delete ents.box;                                                          // and goes
    if (t === 130) ents.f8.pose.p[2] = -0;                                                    // -0 writes as 0
    if (t % 20 === 0) {
      const take = rec.finish();
      takes.push(take);
      rec = new TakeRecorder(rt, opts, take.finalStateHash);
    }
  }
  return takes;
}

const GOLDEN: [string, string][] = [
  ["72bd11189ca5700bec893ab4","5a461c04d7876d05"],
  ["d14a40e75d61c5d44f6fcd5a","b3dd781a7ea54c4f"],
  ["e1ff9bdc6b10985541980431","accb52c526ef9953"],
  ["b66655ffcaa1228bc47b4061","0286724994ae4a91"],
  ["9269ab086083a185838bba6f","9811fc141b54e9d9"],
  ["8c5cd63f1bc2e1fd4e9a96e2","cda84c6b6180e56f"],
  ["18840a3fe488f5035463b200","a77dd093d8060c1c"],
  ["cc22903d178c20f7dfe15666","72f66bcda16591ed"],
];

test('golden take ids: chunked takes over a world with entity-world fixtures stay byte-identical', () => {
  const takes = run();
  const got = takes.map((t) => [t.id, t.finalStateHash.slice(0, 16)] as [string, string]);
  if (process.env.PRINT_GOLDEN) console.log(JSON.stringify(got));
  assert.deepEqual(got, GOLDEN);
  // each take's content address still holds after the run went on (no take shares a live, later-mutated object)
  for (const t of takes) assert.equal(takeIdOf(t), t.id);
  // the final states are exact copies of the world at their cut: the next take starts from them
  for (let k = 1; k < takes.length; k++) assert.equal(takes[k].baselineStateHash, takes[k - 1].finalStateHash);
  assert.equal(stableStringify(takes.at(-1)!.finalState).includes('"f40"'), true);
});
