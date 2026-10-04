// Serialized finite crash fixture. No models, server or autonomous worker.
import {workerData} from 'node:worker_threads';
import {Db} from '../../src/db.ts';
const db=new Db(workerData.path),prepare=db.db.prepare.bind(db.db),exec=db.db.exec.bind(db.db);
db.db.prepare=((sql:string)=>{
  const statement=prepare(sql);
  if(workerData.phase==='before-take'&&sql.startsWith('INSERT OR IGNORE INTO take_chunks'))process.exit(23);
  return statement;
}) as typeof db.db.prepare;
db.db.exec=((sql:string)=>{
  if(sql==='COMMIT'&&workerData.phase==='before-commit')process.exit(23);
  exec(sql);
  if(sql==='COMMIT'&&workerData.phase==='after-commit')process.exit(23);
}) as typeof db.db.exec;
db.saveTake('eden-proof',workerData.chunk,workerData.capture);
throw new Error('worker missed requested crash boundary');
