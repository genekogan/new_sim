// Read only structured refusal facts from this run's isolated local DB; never prose or credentials.
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
export function attachRefusals(runDir,evidence,seats){
 const path=join(runDir,'server','data','sim.db');if(!existsSync(path))return;
 let db;try{
  db=new DatabaseSync(path,{readOnly:true});
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='edge_refusals_v1'").get())return;
  const query=db.prepare('SELECT at,capability,code FROM edge_refusals_v1 WHERE soul_id=? AND at>=? AND at<=? ORDER BY at');
  for(const e of evidence){const soul=seats[e.seat]?.seat?.soulId,start=Date.parse(e.budgetStartAt??e.sentAt),end=Date.parse(e.cutoffAt);if(soul&&Number.isFinite(start)&&Number.isFinite(end))e.refusals=query.all(soul,start,end);}
 }finally{db?.close();}
}
