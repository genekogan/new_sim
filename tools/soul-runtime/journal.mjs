// Local event handoff for one Soul. No tokens, model calls or world writes.
// Receipt into this journal and handling by the decision owner are distinct facts.
import {DatabaseSync} from 'node:sqlite';
import {attachControl} from './control.mjs';
import {mkdirSync, lstatSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const text = (value, max, name) => {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f]/.test(value)) throw Error(`Invalid ${name}`);
  return value;
};
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
};
const encode = value => {
  const raw = JSON.stringify(canonical(value));
  if (raw === undefined || Buffer.byteLength(raw) > 65536) throw Error('Event must be JSON <=64KiB');
  return raw;
};
const hash = value => createHash('sha256').update(value).digest('hex');
function refuseLink(path) {
  try { if (lstatSync(path).isSymbolicLink()) throw Error('Linked journal path refused'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}

/** directory is private, owned runtime storage, separate from CLI credentials.
 * SQLite commits event payloads and the source cursor together; a cursor never
 * claims delivery of an event whose payload wasn't retained in the same commit.
 * Source cursor equality is an optimistic guard, not an ordering comparison.
 */
export function openJournal(directory, {worldId, soulId, now = Date.now}) {
  text(worldId, 200, 'world'); text(soulId, 200, 'Soul');
  refuseLink(directory); mkdirSync(directory, {recursive:true, mode:0o700});
  const file = join(directory, 'continuity.sqlite'); refuseLink(file);
  for (const suffix of ['-wal', '-shm', '-journal']) refuseLink(file + suffix);
  const db = new DatabaseSync(file); chmodSync(file, 0o600);
  db.exec(`PRAGMA busy_timeout=2000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), world TEXT NOT NULL, soul TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources (source TEXT PRIMARY KEY, cursor TEXT);
    CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, source TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, received_at INTEGER NOT NULL, handled_at INTEGER, outcome TEXT, UNIQUE(source,event_id));
    CREATE TABLE IF NOT EXISTS gaps (seq INTEGER PRIMARY KEY, source TEXT NOT NULL, before_cursor TEXT, after_cursor TEXT NOT NULL, noticed_at INTEGER NOT NULL, reconciled_at INTEGER, evidence TEXT);`);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const r=fn();db.exec('COMMIT');return r; }
    catch(e) {db.exec('ROLLBACK');throw e;}
  };
  try {
    transaction(() => {
      const old=db.prepare('SELECT world,soul FROM identity WHERE singleton=1').get();
      if(old && (old.world!==worldId || old.soul!==soulId)) throw Error('Journal belongs to another world/Soul');
      if(!old)db.prepare('INSERT INTO identity VALUES (1,?,?)').run(worldId,soulId);
    });
  } catch(e) {db.close();throw e;}
  const sourceName = source => text(source,100,'source');
  const cursorValue = cursor => cursor===null ? null : text(cursor,200,'cursor');
  const getCursor = source => db.prepare('SELECT cursor FROM sources WHERE source=?').get(source)?.cursor ?? null;
  return {
    control:attachControl(db,{now,transaction}),
    cursor(source) {return getCursor(sourceName(source));},
    ingest({source, after, cursor, events, gap=false}) {
      sourceName(source); cursorValue(after);cursorValue(cursor);
      if(!Array.isArray(events)||events.length>1000)throw Error('Expected <=1000 events');
      if(typeof gap!=='boolean')throw Error('gap must be boolean');
      if(gap && cursor===null)throw Error('Gap needs a recovery cursor');
      // Validate the entire batch before opening a write transaction.
      const batch=events.map(event=>{text(event?.id,200,'event id');const payload=encode(event);return {id:event.id,payload,digest:hash(payload)};});
      return transaction(()=>{
        if(getCursor(source)!==after)throw Error('Stale receiver cursor; reload before polling');
        let inserted=0;
        for(const event of batch){
          const old=db.prepare('SELECT digest FROM events WHERE source=? AND event_id=?').get(source,event.id);
          if(old){if(old.digest!==event.digest)throw Error('Event identity reused with different content');continue;}
          db.prepare('INSERT INTO events(source,event_id,payload,digest,received_at) VALUES (?,?,?,?,?)').run(source,event.id,event.payload,event.digest,now());inserted++;
        }
        let gapId=null;
        if(gap)gapId=Number(db.prepare('INSERT INTO gaps(source,before_cursor,after_cursor,noticed_at) VALUES (?,?,?,?)').run(source,after,cursor,now()).lastInsertRowid);
        db.prepare('INSERT INTO sources(source,cursor) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET cursor=excluded.cursor').run(source,cursor);
        return {inserted,cursor,gapId};
      });
    },
    pending(limit=100, afterSequence=0) {
      if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid pending limit');
      if(!Number.isSafeInteger(afterSequence)||afterSequence<0)throw Error('Invalid pending sequence');
      return db.prepare('SELECT seq,source,event_id,payload,received_at FROM events WHERE handled_at IS NULL AND seq>? ORDER BY seq LIMIT ?').all(afterSequence,limit).map(r=>({sequence:r.seq,source:r.source,event:JSON.parse(r.payload),receivedAt:r.received_at}));
    },
    attention(limit=100) {
      if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid attention limit');
      return db.prepare(`SELECT seq,source,event_id,payload,received_at FROM events WHERE handled_at IS NULL
        ORDER BY CASE WHEN source='owner' THEN 4 ELSE COALESCE(json_extract(payload,'$.salience'),2) END DESC,seq LIMIT ?`).all(limit)
        .map(r=>({sequence:r.seq,source:r.source,event:JSON.parse(r.payload),receivedAt:r.received_at}));
    },
    handled(source,id,outcome) {
      sourceName(source);text(id,200,'event id');text(outcome,2000,'handling outcome');
      return transaction(()=>{
        const row=db.prepare('SELECT handled_at,outcome FROM events WHERE source=? AND event_id=?').get(source,id);
        if(!row)throw Error('Cannot handle an unknown event');
        if(row.handled_at!==null){if(row.outcome!==outcome)throw Error('Handling outcome already recorded');return {alreadyHandled:true};}
        db.prepare('UPDATE events SET handled_at=?,outcome=? WHERE source=? AND event_id=?').run(now(),outcome,source,id);
        return {alreadyHandled:false};
      });
    },
    gaps() {return db.prepare('SELECT seq,source,before_cursor,after_cursor,noticed_at FROM gaps WHERE reconciled_at IS NULL ORDER BY seq').all();},
    reconcileGap(id,evidence) {
      if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid gap id');text(evidence,2000,'reconciliation evidence');
      const result=db.prepare('UPDATE gaps SET reconciled_at=?,evidence=? WHERE seq=? AND reconciled_at IS NULL').run(now(),evidence,id);
      if(result.changes!==1)throw Error('Gap absent or already reconciled');
    },
    close(){db.close();},
  };
}
