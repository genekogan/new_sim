// Compact, consistent, read-only copy of a world SQLite DB (Gene: never whole-copy a world DB).
// Port of team/ops/compact-copy.py on the built-in node:sqlite (which also avoids the host CLI's closed-WAL error14).
//
// ONE transaction on a fresh destination with the source ATTACHed `mode=ro` (never written; committed WAL rows are
// seen; concurrent writers are not blocked). The exact schema is recreated (same CREATE statements, page size,
// user_version, application_id). Every row of every table is copied with its rowid, except the dead recordings
// take_chunks / take_archives (tables kept, empty; >99% of Eden's sim.db; servers neither read nor write them with
// TAKES_PERSIST unset) unless keepTakes. Before commit, inside the same snapshot, every copied table is compared
// (count + SHA-256 in rowid / primary-key order), and sqlite_sequence too. Indexes are created after the data and
// triggers last, so no trigger fires during the copy. Views/virtual tables/generated columns are refused.
// Written to <target>.part, quick_check'ed, then renamed. Returns a report {tables, dropped, rowsCopied, bytes, ms}.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,renameSync,rmSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

export const DROPPED_TABLES=Object.freeze(['take_chunks','take_archives']);
const q=name=>`"${String(name).replaceAll('"','""')}"`;

function rowHash(db,schema,table,cols,order){
  const h=createHash('sha256');let n=0;
  const st=db.prepare(`SELECT ${cols} FROM ${schema}.${q(table)} ORDER BY ${order}`);st.setReadBigInts(true);
  for(const row of st.iterate()){
    h.update(JSON.stringify(Object.values(row).map(v=>v instanceof Uint8Array?{b:Buffer.from(v).toString('hex')}:typeof v==='bigint'?{i:v.toString()}:v)));h.update('\n');n++;
  }
  return {rows:n,sha256:h.digest('hex')};
}

export function copySqliteReadOnly(source,target,{keepTakes=false}={}){
  source=resolve(source);target=resolve(target);
  if(source===target||existsSync(target))throw Error('SQLite copy requires a fresh separate destination');
  if(!existsSync(source))throw Error(`SQLite source missing: ${source}`);
  mkdirSync(dirname(target),{recursive:true});
  const part=`${target}.part`,drop=new Set(keepTakes?[]:DROPPED_TABLES),t0=Date.now();
  for(const p of [part,`${part}-journal`,`${part}-wal`,`${part}-shm`])rmSync(p,{force:true});
  const db=new DatabaseSync(part);let open=true;
  const report={source,target,tables:{},dropped:{}};
  try{
    db.prepare('ATTACH ? AS s').run(`${pathToFileURL(source).href}?mode=ro`);
    db.exec(`PRAGMA main.page_size=${Number(db.prepare('PRAGMA s.page_size').get().page_size)}`);
    db.exec('PRAGMA main.journal_mode=DELETE');
    db.exec('BEGIN'); // one transaction: the read snapshot of s and the whole write of main
    const objs=db.prepare('SELECT type,name,sql FROM s.sqlite_master ORDER BY rowid').all();
    const bad=objs.filter(o=>o.type==='view'||/^\s*CREATE\s+VIRTUAL/i.test(o.sql||''));
    if(bad.length)throw Error(`unsupported schema objects: ${bad.map(o=>o.name).join(',')}`);
    const tables=objs.filter(o=>o.type==='table'&&!o.name.startsWith('sqlite_'));
    for(const t of tables)db.exec(t.sql);
    for(const {name,sql} of tables){
      const info=db.prepare(`PRAGMA s.table_xinfo(${q(name)})`).all();
      if(info.some(c=>c.hidden!==0))throw Error(`hidden/generated columns in ${name}`);
      const cols=info.map(c=>q(c.name)).join(',');
      if(drop.has(name)){
        const r=name==='take_chunks'?db.prepare(`SELECT count(*) n, max(to_tick) mx FROM s.${q(name)}`).get():db.prepare(`SELECT count(*) n FROM s.${q(name)}`).get();
        report.dropped[name]={rows:Number(r.n),maxToTick:r.mx??null};continue;
      }
      const pk=info.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk);let order='rowid',sel=cols;
      if(/WITHOUT\s+ROWID/i.test(sql)){order=pk.map(c=>q(c.name)).join(',');db.exec(`INSERT INTO main.${q(name)} (${cols}) SELECT ${cols} FROM s.${q(name)}`);}
      else if(pk.length===1&&String(pk[0].type).toUpperCase()==='INTEGER')db.exec(`INSERT INTO main.${q(name)} (${cols}) SELECT ${cols} FROM s.${q(name)}`); // INTEGER PRIMARY KEY is the rowid
      else{sel=`rowid,${cols}`;db.exec(`INSERT INTO main.${q(name)} (rowid,${cols}) SELECT rowid,${cols} FROM s.${q(name)}`);}
      const a=rowHash(db,'s',name,sel,order),b=rowHash(db,'main',name,sel,order);
      if(a.rows!==b.rows||a.sha256!==b.sha256)throw Error(`copy mismatch in ${name}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      report.tables[name]=a.rows;
    }
    if(objs.some(o=>o.name==='sqlite_sequence')){
      db.exec('DELETE FROM main.sqlite_sequence; INSERT INTO main.sqlite_sequence(name,seq) SELECT name,seq FROM s.sqlite_sequence');
      const seq=s=>JSON.stringify(db.prepare(`SELECT name,seq FROM ${s}.sqlite_sequence ORDER BY name`).all());
      if(seq('main')!==seq('s'))throw Error('sqlite_sequence differs');
    }
    for(const o of objs)if(o.type==='index'&&o.sql)db.exec(o.sql);
    for(const o of objs)if(o.type==='trigger'&&o.sql)db.exec(o.sql);
    for(const p of ['user_version','application_id'])db.exec(`PRAGMA main.${p}=${Number(db.prepare(`PRAGMA s.${p}`).get()[p])}`);
    db.exec('COMMIT');db.exec('DETACH s');
    const ok=db.prepare('PRAGMA quick_check').get().quick_check;
    if(ok!=='ok')throw Error(`quick_check: ${ok}`);
    db.close();open=false;
    renameSync(part,target);
  }catch(e){
    if(open){try{if(db.isTransaction)db.exec('ROLLBACK');}catch{}try{db.close();}catch{}}
    rmSync(part,{force:true});rmSync(`${part}-journal`,{force:true});
    throw e;
  }
  report.rowsCopied=Object.values(report.tables).reduce((a,b)=>a+b,0);report.bytes=statSync(target).size;report.ms=Date.now()-t0;
  return report;
}
