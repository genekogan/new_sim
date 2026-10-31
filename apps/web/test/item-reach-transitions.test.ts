// Entry 29 on M04: an opted-in item pick-up and put-down on the real rig, drawn through the replay path
// (HumanViews.setFrame) with the engine's own reach clock (presentation.ts) and hand lerp (items/actions.ts:
// from the rest hand to the fixed grasp point, smoothstep over ITEM_REACH_SECONDS). Measured per 50 ms in the body
// frame (palm minus root, the body does not move): the whole transfer, standing, must stay within the day-29
// acceptance's 0.08 m per 50 ms. Take 3's bowl pick-up drew 0.111 mid-reach: the drawn arm blended from the clip to
// the moving engine hand with the same smoothstep as the hand itself (clip + (hand - clip) * s(u), hand = rest +
// (target - rest) * s(u)), so the palm lingered for 0.3 s and then rushed (about 1.3 x a single smoothstep's peak).
// Now the drawn hand goes from its own palm to the grasp point on the reach clock (presentation.ts `goal`), the reach
// is 1 s, and a pick-up out of folded arms fades the gesture over 2 s while the free arm keeps it (no dangle yet).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews,type SampledHuman} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf,type Template} from '../../../mars/viewer/app/engine-view/people.ts';
import {hashId} from '../../../mars/viewer/app/engine-view/people-light.ts';
import {itemPresentation,ITEM_REACH_SECONDS,ITEM_RECOVERY_SECONDS,type ItemTransferV1} from '../../../mars/viewer/engine/items/presentation.ts';
import {BODY_MODEL} from '../../../mars/viewer/engine/body/model.ts';

const DT=.05;
let tpl:Template|null=null;
async function views(){
 if(!tpl){
  const source=readFileSync(new URL('../../../mars/viewer/public/modular/environment/animated-casual.glb',import.meta.url));
  const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
  json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
  let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
  const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const bytes=Buffer.concat([header,chunk,bin]);tpl=templateFromGltf('item-reach-canonical',await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));
 }
 const v=new HumanViews();v.setTemplates([tpl]);return v;
}
/** A person id whose idle variety is off over [t0, t1] s (humans.ts neutralWeight / idleVariant), or (fold) has
 *  Idle_FoldArms_Loop at full weight over that span with Idle_Neutral off. */
function idWith(fold:boolean,t0:number,t1:number){
 for(let i=0;i<20000;i++){const id='h_item'+i,h=hashId(id);
  const n=(t:number)=>((t/25+(h%997)/997)%1)*25<7;
  const g=(t:number)=>{const cyc=t/37+((h>>>7)%991)/991,u=(cyc%1)*37;return u<10.2?{clip:['Idle_LookAround_Loop','Idle_FoldArms_Loop'][(Math.floor(cyc)+h)%2],full:u>=1.2&&u<9}:null;};
  let ok=true;for(let t=t0;t<=t1;t+=.25){const c=g(t);if(n(t)||(fold?!(c&&c.clip==='Idle_FoldArms_Loop'&&c.full):!!c)){ok=false;break;}}
  if(ok)return id;}
 throw new Error('no id');
}
const smooth=(n:number)=>{const k=Math.max(0,Math.min(1,n));return k*k*(3-2*k);};
const lerp3=(a:number[],b:number[],k:number)=>a.map((v,i)=>v+(b[i]-v)*k) as [number,number,number];
const M=BODY_MODEL,REST:[number,number,number]=[M.restHand.fwd,M.restHand.up,M.restHand.side],CARRY:[number,number,number]=[M.carryHand.fwd,M.carryHand.up,M.carryHand.side];

/** One take as the engine records it: idle, pick-up reach to `grasp` (right hand), withdraw to the carry point holding,
 *  hold, put reach to `place`, release at the end of the withdraw to the rest point, recovery, idle. Yaw 0: forward +x,
 *  right +z. */
function frames(id:string,grasp:[number,number,number],place:[number,number,number]){
 const R=Math.round(ITEM_REACH_SECONDS/DT),Rec=Math.round(ITEM_RECOVERY_SECONDS/DT),out:{k:number;f:SampledHuman}[]=[];
 const push=(k:number,activity:string,hand:[number,number,number]|undefined,transfer:ItemTransferV1|undefined,held:boolean)=>
  out.push({k,f:{id,p:[0,0,0],yaw:0,walk:0,walkDist:0,restAge:30+k*DT,speed:0,activity,...(hand?{hands:{right:hand}}:{}),itemPose:itemPresentation(transfer,held?{right:'bowl'}:undefined,k,DT)}});
 let k=600;
 for(let j=0;j<20;j++)push(k++,'idle',undefined,undefined,false);
 const take:ItemTransferV1={item:'bowl',hand:'right',action:'a1',mode:'take',startTick:k-10,reachTick:k-1,target:grasp};
 for(let t=1;t<=R;t++)push(k++,'reach',lerp3(REST,grasp,smooth(t/R)),take,false);           // reach (not holding)
 for(let t=1;t<=R;t++)push(k++,'reach',lerp3(grasp,CARRY,smooth(t/R)),take,true);           // withdraw (holding)
 for(let j=0;j<30;j++)push(k++,'idle',CARRY,undefined,true);                                // holding
 const put:ItemTransferV1={item:'bowl',hand:'right',action:'a2',mode:'put',startTick:k-10,reachTick:k-1,target:place};
 for(let t=1;t<=R;t++)push(k++,'reach',lerp3(CARRY,place,smooth(t/R)),put,true);            // put reach (holding)
 for(let t=1;t<=R;t++)push(k++,'reach',lerp3(place,REST,smooth(t/R)),put,false);            // withdraw (released at the end)
 put.releaseTick=k-1;
 for(let t=1;t<=Rec;t++)push(k++,'idle',REST,put,false);                                    // recovery
 for(let j=0;j<30;j++)push(k++,'idle',undefined,undefined,false);
 return out;
}
async function measure(id:string,grasp:[number,number,number],place:[number,number,number]){
 const v=await views(),rows=frames(id,grasp,place).map(({k,f})=>{v.setFrame([f],k*DT);v.render(1);
  const b=v.bones(id)[id] as unknown as {arms:{side:string;palm:number[]}[];variety:number};return {k,act:f.activity,variety:b.variety,palms:b.arms.map(a=>a.palm)};});
 let worst=0,at=0;
 for(let i=1;i<rows.length;i++)for(let j=0;j<2;j++){const s=Math.hypot(...rows[i].palms[j].map((x,n)=>x-rows[i-1].palms[j][n]));if(s>worst){worst=s;at=rows[i].k;}}
 return {worst,at,rows};
}

test('an item pick-up and put-down drawn on the real rig: no palm faster than 0.08 m per 50 ms, standing',async()=>{
 // Take 3's two pick-ups, in the body frame: the lantern 0.58 m ahead, the bowl 0.78 m ahead, both at table height.
 for(const [name,grasp] of [['lantern',[.58,.75,0]],['bowl',[.78,.75,0]]] as const){
  const r=await measure(idWith(false,29.5,39),[...grasp],[.6,.76,.05]);
  if(process.env.ITEM_DEBUG)console.log(name,'worst',r.worst.toFixed(3),'@',r.at);
  assert.ok(r.worst<=.08,`${name}: palm step ${r.worst.toFixed(3)} m per 50 ms at tick ${r.at}`);
 }
});

test('a pick-up out of folded arms: the gesture fades out over the reach and the withdraw, no palm faster than 0.08',async()=>{
 const id=idWith(true,29.5,34),r=await measure(id,[.78,.75,0],[.6,.76,.05]);
 const start=r.rows.findIndex(x=>x.act==='reach');
 if(process.env.ITEM_DEBUG)console.log('fold worst',r.worst.toFixed(3),'@',r.at,'variety at reach',r.rows[start].variety.toFixed(2),'at grasp',r.rows[start+Math.round(ITEM_REACH_SECONDS/DT)].variety.toFixed(2));
 assert.ok(r.rows[start].variety>.9,'folded arms are playing when the reach starts');
 assert.ok(r.worst<=.08,`palm step ${r.worst.toFixed(3)} m per 50 ms at tick ${r.at}`);
});
