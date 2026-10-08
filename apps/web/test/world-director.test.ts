import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WorldDirector,candidates,landmarkPose,MIN_HOLD,LANDMARK_SCORE,type DirectorInput,type Landmark} from '../src/WorldDirector.ts';
import {subjectFraction} from '../src/WorldBroadcast.ts';

const L:Landmark[]=[{id:'commons',label:'Commons',p:[35,20,35],target:[8,1,0]},{id:'market',label:'Market',p:[83,12,42],target:[70,1,29]}];
const body=(id:string,x:number,z:number,activity='idle',y=0)=>({id,p:[x,y,z],activity});
const run=(d:WorldDirector,input:(t:number)=>DirectorInput,from:number,to:number)=>{const seen:string[]=[];for(let t=from;t<to;t+=.25){const c=d.choose(input(t));if(seen.at(-1)!==c?.key)seen.push(c?.key??'none');}return seen;};

test('VF1 director: opening establishing view, then the town when only walkers are about', () => {
  const d=new WorldDirector(),walkers=(t:number):DirectorInput=>({bodies:[body('a',10+t,0,'walk'),body('b',-20,5,'walk')],speaking:new Map(),now:t,landmarks:L});
  assert.equal(d.choose(walkers(0))?.key,'landmark:commons');
  const keys=run(d,walkers,0,60);
  assert.ok(keys.every(k=>k.startsWith('landmark:')||k.startsWith('soul:')),keys.join());
  assert.ok(keys.filter(k=>k.startsWith('landmark:')).length>=2,'tours the town: '+keys.join());
});

test('VF1 director: the opening waits for the town views (scenery after people)', () => {
  const d=new WorldDirector(),input=(t:number,l:Landmark[]):DirectorInput=>({bodies:[body('a',0,0,'walk')],speaking:new Map(),now:t,landmarks:l});
  d.choose(input(0,[]));d.choose(input(1,[]));
  assert.equal(d.choose(input(3,L))?.key,'landmark:commons');
  assert.equal(d.choose(input(8,L))?.key,'landmark:commons');
});

test('VF1 director: a conversation wins over walkers, gets a two-shot and is held', () => {
  const d=new WorldDirector();
  const input=(t:number):DirectorInput=>({bodies:[body('a',0,0,'sit'),body('b',1.5,0,'sit'),body('w',30+t*2,0,'walk'),body('v',-30,t,'walk')],
    speaking:new Map(t>10?[['a',{thread:'c1',at:10}],['b',{thread:'c1',at:Math.floor(t/4)*4}]]:[]),now:t,landmarks:L});
  run(d,input,0,10.25);
  const c=d.choose(input(14));
  assert.equal(c?.key,'conversation:c1');assert.ok(c?.kind==='subjects'&&c.twoShot&&c.members.length===2);
  const keys=run(d,input,14,14+MIN_HOLD+4);
  assert.deepEqual(keys,['conversation:c1'],'no cutting away to whoever starts walking');
});

test('VF1 director: busy Souls beat walkers; holds, then tours; a speck is rejected', () => {
  const d=new WorldDirector();
  const input=(t:number):DirectorInput=>({bodies:[body('reader',70,-5,'read'),body('dancer',10,5,'dance'),body('w1',0,30+t,'walk'),body('w2',5,-30,'walk')],speaking:new Map(),now:t,landmarks:[]});
  const keys=run(d,input,0,80);
  assert.ok(keys.length>=2&&keys.every(k=>k==='soul:reader'||k==='soul:dancer'),keys.join());
  const first=d.choose(input(100))!;d.reject(first.key,100);
  assert.notEqual(d.choose(input(100.25))?.key,first.key);
  const swim=candidates({bodies:[body('s',-90,0,'swim'),body('w',0,0,'walk')],speaking:new Map(),now:0,landmarks:[]});
  assert.ok(swim[0].score<LANDMARK_SCORE,'a lone swimmer is not worth leaving the town for');
  const wet=candidates({bodies:[body('s',-50,0,'stretch',-3.2),body('w',0,0,'walk')],speaking:new Map(),now:0,landmarks:[]});
  assert.equal(wet[0].key,'soul:w','a busy Soul standing in the pond (body below the ground line) ranks below a walker');
  const d2=new WorldDirector();const only=(t:number):DirectorInput=>({bodies:[body('s',-50,0,'dance',-3.2)],speaking:new Map(),now:t,landmarks:L});
  assert.ok(run(d2,only,0,90).every(k=>k.startsWith('landmark:')),'with only a swimmer about, Broadcast stays on the town');
});

test('VF1 director: balloon riders and groups are candidates; landmark drift is gentle', () => {
  const c=candidates({bodies:[body('r',0,0,'idle',30),body('g1',50,0,'eat'),body('g2',51,1,'sit'),body('g3',52,0,'idle'),body('g4',50.5,2,'paint')],speaking:new Map(),now:0,landmarks:[]});
  assert.equal(c[0].label,'riding');assert.ok(c.some(x=>x.label==='group'&&x.members.length===4));
  const a=landmarkPose(L[0],0),b=landmarkPose(L[0],14);
  assert.ok(Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1],a.position[2]-b.position[2])<6);
  assert.deepEqual(a.target,[8,1,0]);
});

test('VF1: subject size in frame', () => {
  const pose={position:[0,1.6,8],target:[0,1,0],fov:45} as const;
  assert.ok(subjectFraction(pose as never,16/9,[0,0,0],1.75)>.15);
  assert.ok(subjectFraction(pose as never,16/9,[0,0,-300],1.75)<.045);
  assert.equal(subjectFraction(pose as never,16/9,[0,0,30],1.75),0);
});

test('VF1 director: one long-running scene alternates with a wide town view', () => {
  const d=new WorldDirector(),g=(t:number):DirectorInput=>({bodies:[body('a',0,0,'dance'),body('b',1,0,'sit'),body('c',2,1,'sit'),body('d',0,2,'idle')],speaking:new Map(),now:t,landmarks:L});
  const keys=run(d,g,0,120);
  const subjects=keys.filter(k=>!k.startsWith('landmark:')).length,towns=keys.filter(k=>k.startsWith('landmark:')).length;
  assert.ok(subjects>=2&&towns>=3,keys.join());
});

test('VF5 director: sleepers and idle crowds are not a show; the tour runs', () => {
  const d=new WorldDirector(),night=(t:number):DirectorInput=>({bodies:[body('a',0,0,'sleep'),body('b',1,0,'lie'),body('c',2,0,'sleep'),body('d',1,1,'idle'),body('e',0,1,'sit')],speaking:new Map(),now:t,landmarks:L});
  assert.ok(run(d,night,0,60).every(k=>k.startsWith('landmark:')),'only the town');
});
