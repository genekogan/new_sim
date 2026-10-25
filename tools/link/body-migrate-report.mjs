#!/usr/bin/env node
// LINK BODY one-time migration, dry-run report (read-only). Lists the Souls the old idle beam took (fade colour `gone`) that
// will come back as sleeping bodies at the first body sweep after the release: live Souls of the world, not away by travel.
// The server does the migration itself at boot (edge/ledger/ledger.ts migrateGone: stays where it was if that is dry, clear
// ground in a place, else the starting point; asleep). SIM_BODY_MIGRATE=dry on a server logs the same list with positions
// and changes nothing.
//   node tools/link/body-migrate-report.mjs --db <world sim.db or a compact copy> [--world <world id>]
import { DatabaseSync } from 'node:sqlite';
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
if (!args.db) { console.error('usage: body-migrate-report.mjs --db <file> [--world <id>]'); process.exit(2); }
const db = new DatabaseSync(args.db, { readOnly: true });
const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
if (!has('edge_comms_activity')) { console.log(JSON.stringify({ db: args.db, gone: 0, note: 'no fading table (fading never ran here)' })); process.exit(0); }
const away = has('travel_incarnations_v1') ? new Set(db.prepare("SELECT world_id||'/'||soul_id k FROM travel_incarnations_v1 WHERE state='away'").all().map((r) => r.k)) : new Set();
const rows = db.prepare(`SELECT a.world_id, a.soul_id, a.last_at, a.contact_at, s.name, s.retired_at, s.world_id AS soul_world FROM edge_comms_activity a LEFT JOIN souls s ON s.id = a.soul_id
  WHERE a.colour = 'gone' ${args.world ? 'AND a.world_id = ?' : ''} ORDER BY a.world_id, a.last_at`).all(...(args.world ? [args.world] : []));
const back = [], skipped = [];
for (const r of rows) {
  const why = !r.name ? 'no soul row' : r.retired_at !== null ? 'retired' : r.soul_world !== r.world_id ? 'lives in another world' : away.has(`${r.world_id}/${r.soul_id}`) ? 'away by travel (stays gone here)' : null;
  (why ? skipped : back).push({ world: r.world_id, soulId: r.soul_id, name: r.name ?? null, lastActionAt: new Date(r.contact_at ?? r.last_at).toISOString(), ...(why ? { why } : {}) });
}
console.log(JSON.stringify({ db: args.db, comesBackAsleep: back.length, back, skipped }, null, 1));
