import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Db} from './db.ts';
test('complete backup finishes while a second WAL connection keeps writing and reopens with consistent data',{timeout:10000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'core-backup-concurrent-')),source=join(dir,'source.sqlite'),dest=join(dir,'backup.sqlite'),db=new Db(source);let writer:DatabaseSync|undefined,timer:ReturnType<typeof setInterval>|undefined;
 try{db.db.exec('CREATE TABLE backup_fixture(id INTEGER PRIMARY KEY, value BLOB); CREATE TABLE backup_writes(n INTEGER NOT NULL); INSERT INTO backup_writes VALUES(0)');const insert=db.db.prepare('INSERT INTO backup_fixture VALUES (?,zeroblob(16384))');db.db.exec('BEGIN');for(let i=0;i<1500;i++)insert.run(i);db.db.exec('COMMIT');writer=new DatabaseSync(source);const update=writer.prepare('UPDATE backup_writes SET n=n+1');let writes=0;timer=setInterval(()=>{update.run();writes++;},1);await new Promise(r=>setTimeout(r,15));const started=performance.now();await db.backupTo(dest);const elapsed=performance.now()-started;assert.ok(writes>0);assert.ok(elapsed<5000,'owned25MB backup must finish within the local drain envelope');const copy=new DatabaseSync(dest);try{assert.equal(copy.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM backup_fixture').get()!.n,1500);assert.equal(copy.prepare('SELECT SUM(length(value)) AS n FROM backup_fixture').get()!.n,1500*16384);assert.ok(Number(copy.prepare('SELECT n FROM backup_writes').get()!.n)>=1);}finally{copy.close();}}
 finally{if(timer)clearInterval(timer);writer?.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
