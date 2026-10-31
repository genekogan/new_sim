// Stage B (lane B-delta): WorldInit v1, the whole replicated state at one stream position, as plain structured-clone data
// (no closures, no engine objects). Entities are L5's shared snapshot view (host.snapshotView(): one entity copy per
// (tick, log seq), shared with the viewer join path); the static layer is the tap's per-epoch copy; the comms objects are
// L8's table.snapshot(). One WorldInit is built per stream state and shared by every consumer that asks for it then.
// Served at any point between ticks: every delta section is an absolute row or an idempotent upsert, so the deltas after
// the init's seq apply cleanly even when a write landed between that delta and the init (see LOAD-CONTRACT §6).
import type {WorldHost} from '../world.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import {mindRow, receiptRow, type DeltaTap} from './delta.ts';
import type {Ent, HoldRow, ObjectRecordRow, ProgramRow, WorldInit} from './read-model.ts';

type Fresh = Omit<WorldInit, 'v' | 'gen' | 'seq' | 'tick' | 'logSeq'>;

/** Every replicated table read fresh from main. `entities` = the snapshot view (cached per tick/seq) unless `cloneEntities`
 *  (the oracle: an independent copy of the live table). */
export function freshTables(host: WorldHost, L: EdgeLedger, tap: DeltaTap, opts: {cloneEntities?: boolean} = {}): Fresh {
  const w = host.engine.world as unknown as {entities: Record<string, Ent>; env: Record<string, unknown>};
  const entities = opts.cloneEntities ? structuredClone(w.entities) : (host.snapshotView().entities as unknown as Record<string, Ent>);
  const minds = [...host.minds.values()].map(mindRow);
  const programs: ProgramRow[] = [], holds: HoldRow[] = [];
  for (const m of minds) {const p = tap.programNow(m.entityId); if (p[1] !== null) programs.push(p); const h = tap.holdsNow(m.entityId); if (h.length) holds.push([m.entityId, h]);}
  const table = tap.objectTable(), snap = table?.snapshot();
  return {
    entities, env: structuredClone(w.env), living: tap.livingNow(),
    static: tap.staticLayer(),
    minds, faded: [...L.faded].sort(),
    receipts: minds.flatMap(m => L.openReceipts(m.soulId).map(receiptRow)),
    programs, holds,
    objects: {gen: snap?.gen ?? 0, records: (snap?.records ?? []) as ObjectRecordRow[]},
    items: tap.itemsNow(), togetherVersion: L.together.version, menuInputs: tap.menuInputsNow(),
    scene: tap.sceneNow(), sceneKey: tap.sceneKeyNow(), pages: tap.pagesNow(), navReady: tap.navReadyNow(),
    ...(tap.extend ? {menu: tap.extend.init()} : {}),
  } as Fresh;
}

let cache: {key: string; init: WorldInit} | null = null;
/** The WorldInit at the stream's current position (between ticks). Built once per (gen, seq, log seq, object gen,
 *  receipts seen, together version): consumers asking at the same state share one object (and one serialization). */
export function worldInit(host: WorldHost, L: EdgeLedger, tap: DeltaTap): WorldInit {
  const pos = tap.pos, key = `${host.worldId}|${pos.gen}|${pos.seq}|${pos.tick}|${pos.logSeq}|${tap.objectTable()?.generation ?? 0}|${tap.receiptCount}|${L.together.version}|${L.faded.size}|${host.minds.size}`;
  if (cache?.key === key) return cache.init;
  const init: WorldInit = {...pos, ...freshTables(host, L, tap)};
  cache = {key, init};
  return init;
}
