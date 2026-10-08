import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {setImmediate} from 'node:timers/promises';
const [root,dir]=process.argv.slice(2);mkdirSync(dir,{recursive:true});process.env.DATA_DIR=dir;
const load=p=>import(pathToFileURL(join(root,p)).href);
const {Db}=await load('apps/server/src/db.ts'),{WorldHost}=await load('apps/server/src/world.ts'),{marsFactory,LITTLE_MARTIANS_WORLD}=await load('packages/engine-mars/src/index.ts');
const {config}=await load('apps/server/src/config.ts'),{Brain}=await load('apps/server/src/brain.ts'),{Souls}=await load('apps/server/src/souls.ts'),{LivingWorld}=await load('apps/server/src/living.ts'),{FloaterCards}=await load('apps/server/src/floaters.ts');
const definition=JSON.parse(readFileSync(join(root,'worlds/littlemartians/world.json'),'utf8'));
const cfg={...config,worldKey:'littlemartians',worldId:'littlemartians-1',ownerId:'dev:admin',engine:'mars',mindDriver:'central',brainMode:'fake',budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,thinkingBudgetCeiling:1,maxSoulsPerUser:50,inviteRequired:false};
const db=new Db(join(dir,'sim.db')),host=new WorldHost(db,await marsFactory(LITTLE_MARTIANS_WORLD),'sim-genesis-1',1e9,'littlemartians-1');host.boot();
const brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){}});
async function accept(p){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await setImmediate();}return p;}
try{
 const living=new LivingWorld(host);await accept(living.install(definition.customs));db.upsertUser({id:'dev:admin',email:null,wallet:null,role:'admin'});
 for(const n of definition.cast)await accept(new Souls(host,db,brain,cfg).create('dev:admin',n));new FloaterCards(host);host.drainInputs();await setImmediate();
 // The pinned reader predates edge/quiesce services. Use its actual Brain,
 // but park native evaluation deadlines in this scripted fixture before the
 // checkpoint; the dedicated process exits after construction.
 await setImmediate();host.drainInputs();
 for(const mind of host.minds.values())mind.nextEvalTick=1e9;
 host.saveSnapshot(true);const checkpointTick=host.engine.world.tick,checkpointHead=host.seq;
 const cast=[...host.minds.values()],soul=cast[0],peer=cast[1];let phase='conversation',conversationReceipt='started',walkReceipt='started';
 host.listeners.push({onProgram:e=>{if(e.actor===soul.entityId&&['completed','failed','cancelled'].includes(e.kind)){if(phase==='conversation')conversationReceipt=e.kind;else walkReceipt=e.kind;}}});
 await accept(host.enqueue('decision','test:scripted-production-reader',{soulId:soul.soulId,entityId:soul.entityId,option:'scripted-conversation',label:'A native circle of ceramic faces',steps:[{verb:'converse',params:{with:peer.entityId,seconds:1}}],reevalTicks:1e9,fallback:false,trigger:'scripted-fixture',mood:'calm'}));
 if(!host.engine.programOf(soul.entityId))throw Error('Pinned reader did not admit the scripted native conversation');
 for(let i=0;i<9000;i++){host.tickOnce();if(i%5===0)await setImmediate();if(conversationReceipt==='completed')break;}
 if(conversationReceipt!=='completed')throw Error('Pinned native conversation did not complete: '+conversationReceipt);
 phase='glide';
 await accept(host.enqueue('decision','test:scripted-production-reader',{soulId:soul.soulId,entityId:soul.entityId,option:'scripted-tower-glide',label:'Glide to tower-L1',steps:[{verb:'walk_to',params:{to:'tower-L1'}}],reevalTicks:1e9,fallback:false,trigger:'scripted-fixture',mood:'calm'}));
 if(!host.engine.programOf(soul.entityId))throw Error('Pinned reader did not admit the scripted glide');
 for(let i=0;i<9000;i++){host.tickOnce();if(i%5===0)await setImmediate();if(walkReceipt==='completed')break;}
 host.drainInputs();await setImmediate();host.drainInputs();
 await accept(host.enqueue('rules','test:lm-replay',{worldEvent:{id:'fixture-end',text:'The scripted glide completed.'},why:'terminal replay witness at the exact accepted clock'}));
 const expected={checkpointTick,checkpointHead,sourceCommit:'621af256',worldKey:'littlemartians',worldId:host.worldId,tick:host.engine.world.tick,head:host.seq,stateHash:host.engine.stateHash(),rulesVersion:host.engine.rulesVersion,cast:host.minds.size,conversationReceipt,walkReceipt,level:host.engine.world.entities[soul.entityId].human.level,recoveryCount:db.events(host.worldId).filter(e=>e.kind==='rules'&&e.payload?.recovery).length};
 writeFileSync(join(dir,'expected.json'),JSON.stringify(expected,null,2)+'\n');console.log(JSON.stringify(expected));
}finally{host.stop();db.close();}
