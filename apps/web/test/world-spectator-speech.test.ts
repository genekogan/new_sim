import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { enclosingPlace, speechFromTalk, channelChip, conversationColour, SpectatorSpeechLayer } from '../src/WorldSpectatorSpeech.ts';

const line=(over:Record<string,unknown>={})=>({id:1,tick:10,at:1000,from:'s_alice',to:'s_bob',fromName:'Alice',toName:'Bob',act:'chat',text:'Hello',place:null,...over}) as any;

test('enclosure: innermost enclosed place by position; outdoors is none', () => {
  assert.equal(enclosingPlace(74,0,-7)?.id,'eden-library-1');
  assert.equal(enclosingPlace(42,0,-8)?.id,'eden-classroom-1');
  assert.equal(enclosingPlace(34,3.2,26.5)?.id,'eden-house-3-upper-room');
  assert.equal(enclosingPlace(0,0,0),null);
  assert.equal(enclosingPlace(99.2,0,36.5),null,'open dome is not enclosed');
});

test('talk lines are two-member conversations with a stable id and colour; speaker enclosure recorded', () => {
  const a=speechFromTalk(line(),[74,0,-7]),b=speechFromTalk(line({id:2,from:'s_bob',to:'s_alice',fromName:'Bob'}),[0,0,0]);
  assert.equal(a.channel.kind,'conversation');assert.equal(b.channel.kind,'conversation');
  assert.equal((a.channel as any).conversationId,(b.channel as any).conversationId);
  assert.equal(conversationColour((a.channel as any).conversationId),conversationColour((b.channel as any).conversationId));
  assert.equal(a.within,'eden-library-1');assert.equal(b.within,null);
});

test('chips say who can hear', () => {
  const names:Record<string,string>={s_alice:'Alice',s_bob:'Bob'},nameOf=(id:string)=>names[id]??'?';
  const c=channelChip(speechFromTalk(line(),[74,0,-7]),nameOf);assert.match(c.text,/with Bob · inside Library — only they hear/);assert.equal(c.private,true);
  assert.match(channelChip({...speechFromTalk(line({to:''}),[0,0,0])},nameOf).text,/aloud — heard within ~10 m/);
  assert.match(channelChip({...speechFromTalk(line({to:''}),[74,0,-7])},nameOf).text,/Library — only those inside hear/);
});

test('cue layer: tethers for live conversations, outline for enclosed speech; pooled', () => {
  const layer=new SpectatorSpeechLayer(),pos:Record<string,THREE.Vector3>={s_alice:new THREE.Vector3(74,1.95,-7),s_bob:new THREE.Vector3(75,1.95,-6)};
  const sp=speechFromTalk(line(),[74,0,-7]);
  for(let i=0;i<3;i++)layer.update([sp],2000,id=>pos[id]?.clone()??null);
  const visible=layer.group.children.filter(c=>c.visible);
  assert.equal(visible.filter(c=>(c as any).isLine&&!(c as any).isLineLoop).length,1,'one tether');
  assert.equal(visible.filter(c=>(c as any).isLineLoop).length,1,'library outline');
  assert.equal(layer.group.children.length,2,'pooled, not re-created per frame');
  layer.update([sp],60000,id=>pos[id]?.clone()??null);assert.equal(layer.group.children.filter(c=>c.visible).length,0,'old speech fades out');
  layer.dispose();
});

import { speechFromEdge } from '../src/WorldSpectatorSpeech.ts';
import { fadingFromEdge, FADING } from '../src/WorldFading.ts';
test('edge feed: conversation members tracked; enclosure and audience channels kept exactly', () => {
  const A={soulId:'s_a',name:'Alice'},B={soulId:'s_b',name:'Bob'};
  const msgs=[
    {type:'edge',kind:'conversation.start',tick:1,at:1000,conversation:'cv1',from:A,invited:[B]},
    {type:'edge',kind:'conversation.member',tick:2,at:1100,conversation:'cv1',soul:B,change:'joined'},
    {type:'edge',kind:'conversation.turn',tick:3,at:1200,conversation:'cv1',turn:{seq:1,tick:3,at:1200,from:A,text:'hi'}},
    {type:'edge',kind:'speech',tick:4,at:1300,id:'sp1',from:B,channel:{kind:'enclosure',placeId:'eden-library-1'},text:'shh',heardBy:[]},
    {type:'edge',kind:'speech',tick:5,at:1400,id:'sp2',from:A,channel:{kind:'audience',object:'talk-1',base:{kind:'enclosure',placeId:'eden-classroom-1'}},text:'welcome',heardBy:['s_b']},
  ] as any[];
  const out=speechFromEdge(msgs,()=>[0,0,0]);
  assert.equal(out.length,3);
  assert.deepEqual(out[0].channel,{kind:'conversation',conversationId:'cv1',members:['s_a','s_b']});
  assert.deepEqual(out[1].channel,{kind:'enclosure',placeId:'eden-library-1'});assert.equal(out[1].within,'eden-library-1');
  assert.equal(out[2].channel.kind,'audience');assert.equal(out[2].within,'eden-classroom-1');
});
test('edge feed: fade colours map to ring phases; removed beams, reclaimed falls, green clears', () => {
  const m=fadingFromEdge([
    {kind:'fade',at:10,soulId:'s_a',colour:'yellow',change:'warn'},{kind:'fade',at:20,soulId:'s_b',colour:'red',change:'warn'},
    {kind:'fade',at:30,soulId:'s_c',colour:'gone',change:'removed'},{kind:'fade',at:40,soulId:'s_d',colour:'green',change:'reclaimed'},
    {kind:'fade',at:50,soulId:'s_a',colour:'green',change:'warn'}],a=>a+5);
  assert.equal(m.has('s_a'),false);assert.ok(m.get('s_b')!.idleMinutes>=FADING.redAt);
  assert.equal(m.get('s_c')!.beamedAt,35);assert.equal(m.get('s_d')!.reclaimedAt,45);
});
