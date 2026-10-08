import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createDialogueStore,ingestDialogue,hearingLabel,participants,joinNames,THREAD_LINE_LIMIT,ALOUD_GAP_MS} from '../src/dialogue-threads.ts';
import {conversationColour} from '../src/WorldSpectatorSpeech.ts';

const A={soulId:'s_a',name:'Tamsin Quill'},B={soulId:'s_b',name:'His Duckness'},C={soulId:'s_c',name:'Moss'},D={soulId:'s_d',name:'Ione'},E={soulId:'s_e',name:'Bram'};
const names:Record<string,string>={s_a:'Tamsin Quill',s_b:'His Duckness',s_c:'Moss',s_d:'Ione',s_e:'Bram'},nameOf=(id:string)=>names[id]??'someone';
let n=0;
const speech=(from:typeof A,text:string,at:number,channel:unknown={kind:'earshot',placeId:'commons',radius:12},heardBy:string[]=[])=>({type:'edge' as const,kind:'speech',tick:1000+at/50,at,id:'sp'+(++n),from,channel,text,heardBy,untrusted:true});
const turn=(cv:string,seq:number,from:typeof A,text:string,at:number,extra={})=>({type:'edge' as const,kind:'conversation.turn',tick:1000+at/50,at,conversation:cv,turn:{seq,tick:1000+at/50,at,from,text},untrusted:true,...extra});

test('a private conversation is one thread: members, colour matching its tether, lines in order, label once', () => {
  const s=createDialogueStore();
  ingestDialogue(s,[
    {type:'edge',kind:'conversation.start',tick:1,at:1000,conversation:'cv1',from:A,invited:[B]},
    turn('cv1',1,A,'Can I ask you something quietly?',1000),
    {type:'edge',kind:'conversation.member',tick:2,at:1500,conversation:'cv1',soul:B,change:'joined'},
    turn('cv1',2,B,'Of course.',2000),turn('cv1',3,A,'A night swim?',3000),
  ],[],5000);
  assert.equal(s.threads.size,1);
  const t=[...s.threads.values()][0];
  assert.deepEqual([t.kind,t.colour,t.members,t.lines.map(l=>l.text)],['private',conversationColour('cv1'),['s_a','s_b'],['Can I ask you something quietly?','Of course.','A night swim?']]);
  assert.equal(joinNames(participants(t).map(nameOf)),'Tamsin Quill & His Duckness');
  assert.deepEqual(hearingLabel(t,nameOf,5000),{icon:'🔒',text:'private · only they hear'});
  ingestDialogue(s,[{type:'edge',kind:'conversation.closed',tick:9,at:9000,conversation:'cv1',reason:'empty'}],[],9000);
  assert.equal(hearingLabel(t,nameOf).text,'private · ended');
});

test('repeats and server replay fold once; replayed history sorts before later live lines; members from replay', () => {
  const s=createDialogueStore(),live=turn('cv2',5,B,'live line',50_000);
  ingestDialogue(s,[live],[],60_000);
  const replay=[turn('cv2',3,A,'older',10_000,{replay:true,members:[A,B],state:'open'}),turn('cv2',4,B,'older too',20_000,{replay:true,members:[A,B],state:'open'})];
  assert.equal(ingestDialogue(s,[...replay,live],[],60_000),true);
  assert.equal(ingestDialogue(s,[...replay,live],[],60_000),false,'nothing new on a reconnect repeat');
  const t=[...s.threads.values()][0];
  assert.deepEqual(t.lines.map(l=>[l.text,l.replay]),[['older',true],['older too',true],['live line',false]]);
  assert.deepEqual(t.members,['s_a','s_b']);
});

test('two clusters on the same big lawn who cannot hear each other are two scenes', () => {
  const s=createDialogueStore();
  ingestDialogue(s,[speech(A,'Over here!',1000,{kind:'earshot',placeId:'field',radius:12},['s_b']),speech(C,'Bees!',1500,{kind:'earshot',placeId:'field',radius:12},['s_d']),
    speech(B,'Coming.',2000,{kind:'earshot',placeId:'field',radius:12},['s_a']),speech(D,'Where?',2500,{kind:'earshot',placeId:'field',radius:12},['s_c'])],[],3000);
  assert.deepEqual([...s.threads.values()].map(t=>participants(t)),[['s_a','s_b'],['s_c','s_d']]);
});

test('aloud lines group per local scene: the people who hear each other; another place with nobody is another thread; walking on keeps the thread', () => {
  const s=createDialogueStore();
  ingestDialogue(s,[
    speech(C,'Where did the bees go?',1000,undefined,['s_d','s_e']),
    speech(D,'Over by the lavender.',2000,undefined,['s_c','s_e']),
    speech(E,'I can build a hive.',3000,undefined,['s_c','s_d','s_a']),
    speech(A,'Breakfast is ready!',3500,{kind:'earshot',placeId:'commons-kitchen',radius:12},[]),
    // Moss walks on to the pergola, still talking with Ione: same scene.
    speech(C,'Come and look.',4000,{kind:'earshot',placeId:'eden-pergola-court',radius:12},['s_d']),
  ],[],5000);
  const threads=[...s.threads.values()];
  assert.equal(threads.length,2);
  const scene=threads.find(t=>t.lines.length===4)!;
  assert.deepEqual(scene.lines.map(l=>l.soulId),['s_c','s_d','s_e','s_c']);
  assert.equal(scene.placeId,'eden-pergola-court');
  assert.equal(joinNames(participants(scene).map(nameOf)),'Moss, Ione & Bram');
  assert.match(hearingLabel(scene,nameOf,5000).text,/^aloud · .+ · also heard by Tamsin Quill$/);
  // Long silence: the same place starts a fresh scene.
  ingestDialogue(s,[speech(C,'Morning again.',4000+ALOUD_GAP_MS+1,{kind:'earshot',placeId:'eden-pergola-court',radius:12},[])],[],4000+ALOUD_GAP_MS+2);
  assert.equal(s.threads.size,3);
});

test('inside and audience channels are their own threads with their own who-can-hear label', () => {
  const s=createDialogueStore();
  ingestDialogue(s,[
    speech(A,'shh',1000,{kind:'enclosure',placeId:'eden-library-1'},[]),
    speech(B,'welcome',1100,{kind:'audience',object:'talk-1',base:{kind:'enclosure',placeId:'eden-classroom-1'}},['s_c']),
  ],[],2000);
  const [inside,audience]=[...s.threads.values()];
  assert.deepEqual([inside.kind,audience.kind],['inside','audience']);
  assert.match(hearingLabel(inside,nameOf).text,/^inside .+ · only those inside hear$/);
  assert.match(hearingLabel(audience,nameOf).text,/^to the audience/);
  const alone=createDialogueStore();ingestDialogue(alone,[speech(B,'Hear ye!',1000,{kind:'earshot',placeId:'eden',radius:12},[])],[],2000);
  assert.equal(hearingLabel([...alone.threads.values()][0],nameOf,2000).text,'aloud','the world itself is not a place name');
});

test('each thread keeps its last lines; brain talk only when recent', () => {
  const s=createDialogueStore();
  ingestDialogue(s,Array.from({length:THREAD_LINE_LIMIT+20},(_,i)=>turn('cv3',i+1,i%2?A:B,'line '+i,1000+i)),[],5000);
  const t=[...s.threads.values()][0];
  assert.equal(t.lines.length,THREAD_LINE_LIMIT);assert.equal(t.lines.at(-1)!.text,'line 99');assert.ok(THREAD_LINE_LIMIT>=50);
  const talk=(id:number,at:number)=>({id,tick:id,at,from:'s_c',to:'s_d',fromName:'Moss',toName:'Ione',act:'say',text:'hi '+id,place:null});
  const now=10*3600_000;
  ingestDialogue(s,[],[talk(1,now-3*3600_000),talk(2,now-1000)],now);
  const pair=[...s.threads.values()].find(x=>x.conversation==='talk:s_c|s_d')!;
  assert.deepEqual(pair.lines.map(l=>l.text),['hi 2']);
});
