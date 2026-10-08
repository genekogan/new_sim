import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {copySqliteReadOnly} from './copy-sqlite.mjs';
test('read-only VACUUM sees committed live WAL rows, preserves source and refuses overwrite',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sim-ro-copy-')),source=join(dir,'source.db'),target=join(dir,'copy.db');let writer,copy;
 try{writer=new DatabaseSync(source);writer.exec('PRAGMA journal_mode=WAL; CREATE TABLE fixture(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO fixture VALUES(1,\'before\'); INSERT INTO fixture VALUES(2,\'committed-wal\')');
  const before=writer.prepare('SELECT * FROM fixture ORDER BY id').all();copySqliteReadOnly(source,target);copy=new DatabaseSync(target,{readOnly:true});assert.deepEqual(copy.prepare('SELECT * FROM fixture ORDER BY id').all(),before);assert.deepEqual(writer.prepare('SELECT * FROM fixture ORDER BY id').all(),before);assert.throws(()=>copySqliteReadOnly(source,target),/fresh separate destination/);assert.throws(()=>copySqliteReadOnly(source,source),/fresh separate destination/);
 }finally{copy?.close();writer?.close();rmSync(dir,{recursive:true,force:true});}
});
