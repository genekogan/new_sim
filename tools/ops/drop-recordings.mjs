#!/usr/bin/env node
// Drop stored take recordings from world databases and compact them.
//
//   node tools/ops/drop-recordings.mjs [--dry-run] <sim.db ...>
//
// Take recordings (take_chunks, take_archives) are a pose-keyframe cache, not the source of truth:
// the event log rebuilds a world, and since RECOFF the server writes no recordings unless
// TAKES_PERSIST=1. This deletes every take_chunks and take_archives row, checkpoints the WAL and
// VACUUMs, printing before/after sizes. render_scene_captures (tiny, public scenery) are kept.
//
// Run it with the world's service STOPPED. It refuses any database another process has open
// (the db, -wal or -shm file, checked via /proc on Linux or lsof elsewhere) and takes an
// exclusive lock with no busy wait before deleting. Deletion has no undo: keep a backup if needed.
import {DatabaseSync} from 'node:sqlite';
import {existsSync,statSync,readdirSync,readlinkSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2),dry=args.includes('--dry-run'),files=args.filter(a=>a!=='--dry-run');
if(!files.length){console.error('usage: drop-recordings.mjs [--dry-run] <sim.db ...>');process.exit(2);}

const mb=n=>(n/1048576).toFixed(1)+' MB';
const size=f=>['','-wal','-shm'].reduce((n,s)=>n+(existsSync(f+s)?statSync(f+s).size:0),0);

function holders(file){
  const targets=new Set(['','-wal','-shm'].map(s=>file+s).filter(existsSync).map(f=>realpathSync(f)));
  if(process.platform==='linux'){
    const pids=[];
    for(const pid of readdirSync('/proc')){
      if(!/^\d+$/.test(pid)||Number(pid)===process.pid)continue;
      let fds=[];try{fds=readdirSync(`/proc/${pid}/fd`);}catch{continue;}
      for(const fd of fds){try{if(targets.has(readlinkSync(`/proc/${pid}/fd/${fd}`))){pids.push(Number(pid));break;}}catch{}}
    }
    return pids;
  }
  try{return execFileSync('lsof',['-t',...targets],{encoding:'utf8'}).split('\n').filter(Boolean).map(Number).filter(p=>p!==process.pid);}
  catch(e){if(e.status===1)return [];throw Error('cannot check open handles (lsof failed); refusing');}
}

let failed=0,freed=0;
for(const file of files){
  try{
    if(!existsSync(file))throw Error('no such file');
    const open=holders(file);
    if(open.length)throw Error(`open by running process(es) ${open.join(',')}; stop the world's service first`);
    const before=size(file);
    const db=new DatabaseSync(file);
    try{
      db.exec('PRAGMA busy_timeout=0');
      const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
      const count=t=>tables.has(t)?Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n):0;
      const rows={take_chunks:count('take_chunks'),take_archives:count('take_archives')};
      if(dry){console.log(`${file}: ${mb(before)}; would delete take_chunks=${rows.take_chunks} take_archives=${rows.take_archives}`);continue;}
      db.exec('BEGIN EXCLUSIVE');
      try{for(const t of ['take_chunks','take_archives'])if(tables.has(t))db.exec(`DELETE FROM ${t}`);db.exec('COMMIT');}
      catch(e){db.exec('ROLLBACK');throw e;}
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.exec('VACUUM');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const ok=db.prepare('PRAGMA quick_check').get();
      if(Object.values(ok)[0]!=='ok')throw Error('quick_check after VACUUM: '+JSON.stringify(ok));
    }finally{db.close();}
    const after=size(file);freed+=before-after;
    console.log(`${file}: ${mb(before)} -> ${mb(after)} (freed ${mb(before-after)}); deleted take_chunks and take_archives rows`);
  }catch(e){failed++;console.error(`${file}: REFUSED/FAILED: ${e.message}`);}
}
if(!dry)console.log(`total freed ${mb(freed)} across ${files.length-failed} database(s)`);
process.exit(failed?1:0);
