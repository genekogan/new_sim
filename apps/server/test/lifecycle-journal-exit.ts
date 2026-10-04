// Actual serialized SQLite exits; private storage only, no native/public proof.
import { Db } from '../src/db.ts';
import { LifecycleJournal } from '../src/lifecycle-journal.ts';
const [path,boundary]=process.argv.slice(2);
if(!path||!['create-write','create-commit','event-write','event-commit','retire-write','retire-commit'].includes(boundary))throw new Error('Unknown lifecycle exit boundary');
const db=new Db(path);db.upsertUser({id:'owner',email:null,wallet:null,role:'user'});db.createWorld({id:'world',schema:'storage-fixture',rules_version:'storage/1',dt:.05,seed:'fixture'});
const journal=new LifecycleJournal(db),scope={worldId:'world',soulId:'s_A',entityId:'h_A',owner:'owner'},requestId='lc_'+'a'.repeat(32);
if(boundary==='create-write'){const write=db.createSoul.bind(db);db.createSoul=input=>{write(input);process.exit(23);};}
journal.acceptCreate(scope,requestId,{name:'Alice',description:'private fixture',native:false},()=>true);
if(boundary==='create-commit')process.exit(23);
if(boundary==='event-write'){const write=db.appendEvent.bind(db);db.appendEvent=(world,event)=>{write(world,event);process.exit(23);};}
journal.record(scope,requestId,{seq:1,tick:0,kind:'birth',author:'soul:s_A',at:1,payload:{soulId:'s_A',entityId:'h_A',owner:'owner',name:'Alice',description:'private fixture'}},()=>true);
if(boundary==='event-commit')process.exit(23);
journal.complete(scope,requestId,()=>true);db.setSoulToken('s_A','fixture-hash');
if(boundary==='retire-write'){const write=db.retireSoul.bind(db);db.retireSoul=id=>{write(id);process.exit(23);};}
journal.acceptRetire(scope,'lc_'+'b'.repeat(32),()=>true);
if(boundary==='retire-commit')process.exit(23);
throw new Error('Expected lifecycle exit not reached');
