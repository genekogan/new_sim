// LINK BODY: the body rule's choices on a synthetic world (fake port): a zombie's shuffles never cross a door or a wall,
// never leave REFLEX_RADIUS and never step into water, over 2 h of rule time; the idle reflex's mix.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {BodyRule, type BodyPort, type BodySoul, type Posture} from './edge/ledger/body-rule.ts';

// A 10 x 10 m house (walls 0.2 m thick) with one door in its south wall at x 4..6; a pond west of x < -8.
const wall = (x: number, z: number) => {const inX = x >= 0 && x <= 10, inZ = z >= 0 && z <= 10;
  const onWall = (inZ && (Math.abs(x) < 0.3 || Math.abs(x - 10) < 0.3)) || (inX && (Math.abs(z - 10) < 0.3 || (Math.abs(z) < 0.3 && !(x > 4 && x < 6))));
  return onWall;};
const inHouse = (x: number, z: number) => x > 0 && x < 10 && z > 0 && z < 10;
const dry = (x: number, z: number) => x >= -8;
function fake(start: [number, number]) {
  const pos = {x: start[0], z: start[1]}, decisions: {option: string; steps: any[]}[] = [];let running = false;
  const soul: BodySoul = {soulId: 's_test', entityId: 'e1', name: 'T', owner: 'o'};
  const port: BodyPort = {
    souls: () => [soul], presence: () => ({listening: false, at: 0}), createdAt: () => 0,
    pose: () => ({x: pos.x, z: pos.z, level: 0}), posture: (): Posture => 'standing', agentBusy: () => false, running: () => running,
    dry, clear: (x, z) => !wall(x, z), places: (x, z) => inHouse(x, z) ? 'house' : '',
    seat: () => null, decide: (_s, option, _l, steps) => {decisions.push({option, steps}); const to = steps.find(s => s.verb === 'walk_to')?.params.to as [number, number] | undefined; if (to) {pos.x = to[0]; pos.z = to[1];}},
    stop: () => {running = false;}, publish: () => {},
  };
  return {pos, decisions, port, soul};
}
for (const [label, start] of [['outdoors by the house and the pond', [-3, 5]], ['inside the house', [5, 5]], ['in the doorway', [5, 1]]] as const)
  test(`zombie ${label}: 2 h of shuffles never cross a door or wall, never leave the radius, never touch water`, () => {
    const db = new DatabaseSync(':memory:'), f = fake([...start]); let now = 1e12;
    const rule = new BodyRule(db as any, 'w', f.port, {now: () => now, knobs: {zombieWanderMs: 3 * 3600e3}});
    const left = now; f.port.presence = () => ({listening: false, at: left}); now += 130e3;
    rule.sweep(); assert.equal(rule.view('s_test')!.state, 'zombie');
    const anchor = [f.pos.x, f.pos.z], room = inHouse(anchor[0], anchor[1]);
    let last = [...anchor];
    for (let t = 0; t < 2 * 3600; t++) {
      now += 1000; rule.sweep();
      // the straight way from the last spot to this one (the body walks it) stays in the same room, off walls, dry
      for (let i = 0; i <= 20; i++) {const x = last[0] + (f.pos.x - last[0]) * i / 20, z = last[1] + (f.pos.z - last[1]) * i / 20;
        assert.equal(inHouse(x, z), room, `crossed a door at ${x},${z}`); assert.ok(!wall(x, z) || i === 0, `through a wall at ${x},${z}`); assert.ok(dry(x, z), 'in water');}
      assert.ok(Math.hypot(f.pos.x - anchor[0], f.pos.z - anchor[1]) <= 20, 'beyond REFLEX_RADIUS');
      last = [f.pos.x, f.pos.z];
    }
    const n = f.decisions.filter(d => d.option === 'body:zombie-shuffle').length;
    assert.ok(n >= 100, `shuffled ${n} times`);
    for (const d of f.decisions) assert.deepEqual(d.steps.map(s => s.verb), ['walk_to']), assert.equal(d.steps[0].params.pace, 'shuffle');
  });
test('idle reflex mix: doze dominates after IDLE_DOZE; never speech or goals (only posture steps)', () => {
  const db = new DatabaseSync(':memory:'), f = fake([20, 20]); let now = 1e12;
  f.port.presence = () => ({listening: true, at: now});
  const rule = new BodyRule(db as any, 'w', f.port, {now: () => now});
  const early: string[] = [], late: string[] = [];
  for (let t = 0; t < 8 * 3600; t++) {now += 1000; rule.sweep(); const v = rule.view('s_test')!; if (v.state === 'idle' && t % 60 === 0) (t < 40 * 60 ? early : t > 60 * 60 ? late : []).push(v.doing!);}
  const share = (a: string[], d: string) => a.filter(x => x === d).length / a.length;
  assert.ok(share(late, 'dozing') > 0.6, 'dozing dominates late: ' + share(late, 'dozing'));
  const verbs = new Set(f.decisions.flatMap(d => d.steps.map(s => s.verb === 'mars:pose_v1' ? 'pose:' + s.params.activity : s.verb)));
  assert.deepEqual([...verbs].filter(v => !['stand', 'rest', 'walk_to', 'pose:nap', 'pose:sit-ground'].includes(v)), [], 'posture steps only');
});

test('zombie path checks lying room between clear endpoints; narrow corridors do not become sleeping spots',()=>{
 const db=new DatabaseSync(':memory:'),f=fake([-3,-5]);let now=1e12,checked=0;
 const left=now;f.port.presence=()=>({listening:false,at:left});
 f.port.clear=(x,_z,_level,lying)=>{assert.equal(lying,true);checked++;return Math.abs(x+1)>0.9;};
 const rule=new BodyRule(db as any,'w',f.port,{now:()=>now,knobs:{zombieWanderMs:3*3600e3}});
 now+=130e3;rule.sweep();let last={...f.pos};
 for(let n=0;n<3600;n++){now+=1000;rule.sweep();for(let i=0;i<=40;i++)assert.ok(Math.abs(last.x+(f.pos.x-last.x)*i/40+1)>0.9,'never cross the narrow band even if the endpoint is clear');last={...f.pos};}
 assert.ok(checked>0);assert.ok(f.decisions.length>=3,'safe shuffling is still available');db.close();
});

test('asleep doing follows observed posture after refusal, admission, and interrupted movement',()=>{
 const db=new DatabaseSync(':memory:'),f=fake([20,20]);let now=1e12,posture:Posture='standing';
 f.port.posture=()=>posture;
 const rule=new BodyRule(db as any,'w',f.port,{now:()=>now});rule.sweep();
 assert.equal(rule.view('s_test')!.doing,'standing','a requested nap is not evidence of lying');
 const attempts=f.decisions.length;now+=1000;rule.sweep();assert.equal(f.decisions.length,attempts,'no immediate retry loop');
 posture='lying';now+=1000;rule.sweep();assert.equal(rule.view('s_test')!.doing,'dozing','observed native posture updates before the next nap retry');
 posture='moving';now+=1000;rule.sweep();assert.equal(rule.view('s_test')!.doing,'drifting');
 posture='water';now+=1000;rule.sweep();assert.equal(rule.view('s_test')!.doing,'floating');
 posture='seated';now+=1000;rule.sweep();assert.equal(rule.view('s_test')!.doing,'sitting');db.close();
});
