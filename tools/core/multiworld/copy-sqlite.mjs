// Read-only SQLite VACUUM copy, including committed WAL history. The built-in
// SQLite avoids the host CLI's observed closed-WAL/read-only VACUUM error14.
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync} from 'node:fs';import {resolve,dirname} from 'node:path';
export function copySqliteReadOnly(source,target){
 source=resolve(source);target=resolve(target);
 if(source===target||existsSync(target))throw Error('SQLite copy requires a fresh separate destination');
 mkdirSync(dirname(target),{recursive:true});const db=new DatabaseSync(source,{readOnly:true});
 try{db.exec(`VACUUM INTO '${target.replaceAll("'","''")}'`);}finally{db.close();}
}
