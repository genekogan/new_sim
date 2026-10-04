// Finite serialized child. Actual candidate journal/host/native boundaries;
// no production bootstrap, auth/model/provider, sockets or private sources.
import { fixture,settle,scope,requestId,retireId,input } from './lifecycle-native-fixture.ts';
const [path,boundary]=process.argv.slice(2);
if(!path||!['create-commit','birth-write','birth-commit','birth-applied','retire-commit','retire-write','terminal-write','terminal-commit'].includes(boundary))throw new Error('Unknown native lifecycle exit');
const f=fixture(path);f.journal.acceptCreate(scope,requestId,input,()=>true);
if(boundary==='create-commit')process.exit(23);
const append=f.db.appendEvent.bind(f.db);f.db.appendEvent=(world,event)=>{
  append(world,event);
  if((boundary==='birth-write'&&event.kind==='birth')||(boundary==='retire-write'&&event.kind==='retire')
    ||(boundary==='terminal-write'&&event.payload?.checkpoint==='lifecycle-removal-confirmed'))process.exit(23);
};
const exec=f.db.db.exec.bind(f.db.db);f.db.db.exec=sql=>{
  exec(sql);
  if(sql==='COMMIT'&&((boundary==='birth-commit'&&f.journal.get(scope,requestId)?.state==='recorded')
    ||(boundary==='terminal-commit'&&f.journal.get(scope,retireId)?.state==='complete')))process.exit(23);
};
if(boundary==='birth-applied')f.host.listeners.push({onApplied:e=>{if(e.kind==='birth')process.exit(23);}});
await settle(f);if(f.journal.get(scope,requestId)?.state!=='complete')throw new Error('Native birth did not complete');
f.db.setSoulToken('s_A','local-token-hash');f.journal.acceptRetire(scope,retireId,()=>true);
if(boundary==='retire-commit')process.exit(23);
await settle(f);throw new Error('Expected native lifecycle exit not reached');
