// Explore shots (3.74 rollback): place-shot steps never run while the visitor is interacting and are spaced out.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ShotPacer,type PacerClock} from './place-shot-pacer.ts';

/** A virtual clock: wait() advances time, idle() takes 5 ms; `during` runs callbacks at given virtual times. */
function clock(during:[number,()=>void][]=[]):PacerClock&{t:number}{
 const c={t:0,now:()=>c.t,wait:async(ms:number)=>{const end=c.t+ms;for(const [at,fn] of during)if(at>c.t&&at<=end){c.t=at;fn();}c.t=Math.max(c.t,end);},idle:async()=>{await c.wait(5);}};
 return c;
}

test('a step waits until the visitor has been still for 800 ms', async()=>{
 const c=clock(),pacer=new ShotPacer(c,800,120);
 c.t=1000;pacer.input();
 assert.equal(await pacer.turn(),true);
 assert.ok(c.t>=1800,`ran at ${c.t}, input at 1000`);
});

test('input that arrives while waiting pushes the step out again', async()=>{
 const p:{pacer?:ShotPacer}={},c=clock([[1500,()=>p.pacer!.input()],[2200,()=>p.pacer!.input()]]);p.pacer=new ShotPacer(c,800,120);
 c.t=1000;p.pacer.input();
 await p.pacer.turn();
 assert.ok(c.t>=3000,`ran at ${c.t}, last input at 2200`);
});

test('steps are spaced at least the gap apart, measured from the end of the previous step', async()=>{
 const c=clock(),pacer=new ShotPacer(c,800,120),starts:number[]=[];
 for(let i=0;i<4;i++){await pacer.turn();starts.push(c.t);c.t+=30;pacer.done();}
 for(let i=1;i<starts.length;i++)assert.ok(starts[i]-(starts[i-1]+30)>=120,`gap ${starts[i]-starts[i-1]-30}`);
});

test('a closed pacer stops waiting', async()=>{
 const c=clock(),pacer=new ShotPacer(c,800,120);
 c.t=1000;pacer.input();
 assert.equal(await pacer.turn(()=>false),false);
 assert.equal(c.t,1000);
});

test('listen() counts pointer, key and wheel input and the remover detaches', ()=>{
 const c=clock(),pacer=new ShotPacer(c,800,120),target=new EventTarget();
 const off=pacer.listen(target);c.t=500;target.dispatchEvent(new Event('pointermove'));
 return pacer.turn().then(()=>{assert.ok(c.t>=1300);off();const before=c.t;target.dispatchEvent(new Event('keydown'));c.t+=1;return pacer.turn().then(()=>assert.ok(c.t-before<800));});
});
