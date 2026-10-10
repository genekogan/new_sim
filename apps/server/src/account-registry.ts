import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
/** Identity only. World histories, ownership and grants remain world scoped.
 * SQLite serializes allocation across processes; email never merges accounts. */
export class AccountRegistry {
 readonly db:DatabaseSync;
 constructor(path:string){
  if(path!==':memory:')mkdirSync(dirname(resolve(path)),{recursive:true});
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS provider_accounts_v1(account_id TEXT PRIMARY KEY,issuer TEXT NOT NULL,subject TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(issuer,subject))');
 }
 bind(issuer:string,subject:string){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   let row=this.db.prepare('SELECT account_id FROM provider_accounts_v1 WHERE issuer=? AND subject=?').get(issuer,subject) as {account_id:string}|undefined;
   if(!row){row={account_id:'acct_'+randomUUID()};this.db.prepare('INSERT INTO provider_accounts_v1 VALUES(?,?,?,?)').run(row.account_id,issuer,subject,Date.now());}
   this.db.exec('COMMIT');return row.account_id;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 identity(id:string){return this.db.prepare('SELECT issuer,subject FROM provider_accounts_v1 WHERE account_id=?').get(id) as {issuer:string;subject:string}|undefined;}
 close(){this.db.close();}
}
