// E-life B2 (overnight 2026-10-17): finite meals on a god's world, as old Eden's commons provisions were finite.
// A resident who cooks at a kitchen's stove (or a prep table with a pot) makes a pot of food: 4 portions for that kitchen.
// Eating at a table draws one portion from the kitchen of the same building (a café's tables from the café's kitchen, a
// house's kitchen table from its stove), or from the nearest kitchen within 60 m for a table outdoors. The portion is
// reserved when the act is accepted, eaten when its receipt completes, and given back if it fails or is replaced. A
// table with no kitchen near is a picnic: you eat what you brought (unchanged). Drinks are always free. Server-side
// policy (like the layers economy), persisted per world; the engine and its replay are untouched.
import type { Db } from '../db.ts';
import type { EdgeCapability, EdgeReceipt } from '../edge/contract.ts';
import type { Spot, SpotsData } from '../edge/ledger/activities.ts';

type V2 = [number, number];
type PlaceLite = { id: string; name: string; kind: string; parent: string | null };
export type MealsHost = { db: Db; worldId: string; spots(): SpotsData; place(id: string): PlaceLite | undefined;
  /** The world day ('' when the world keeps no day): each kitchen starts every day with a morning pot. */
  day?(): string };

export const PORTIONS_PER_POT = 4, MAX_PORTIONS = 12, OUTDOOR_REACH = 60;
const DISHES = ['vegetable soup', 'bean stew', 'fresh bread and salad', 'pasta with tomatoes', 'lentil curry', 'roast vegetables', 'barley risotto', 'potato and leek pie'];
type Kitchen = { key: string; name: string; at: V2; cook: string };

export class GodMeals {
  private h: MealsHost;
  constructor(h: MealsHost) {
    this.h = h;
    h.db.db.exec(`CREATE TABLE IF NOT EXISTS god_meals_v1 (world_id TEXT NOT NULL, kitchen TEXT NOT NULL, portions INTEGER NOT NULL, dish TEXT NOT NULL, cooked_by TEXT, pots INTEGER NOT NULL DEFAULT 0, day TEXT, PRIMARY KEY (world_id, kitchen)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS god_meal_claims_v1 (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, kitchen TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (world_id, receipt_id)) WITHOUT ROWID;`);
  }

  /** The building (or kitchen zone) a place belongs to: the kitchen key its tables and stoves share. */
  private buildingOf(place: string | undefined): string | null {
    for (let p = place ? this.h.place(place) : undefined, i = 0; p && i < 8; p = p.parent ? this.h.place(p.parent) : undefined, i++) if (p.kind === 'building' || /kitchen/i.test(p.name) && p.kind !== 'room') return p.id;
    return null;
  }
  private kitchens(): Kitchen[] {
    const out = new Map<string, Kitchen>();
    for (const s of this.h.spots().spots) {
      if (s.activity !== 'cook') continue;
      const key = this.buildingOf(s.place) ?? `spot:${s.id}`;
      if (!out.has(key)) out.set(key, { key, name: (key.startsWith('spot:') ? s.label : this.h.place(key)?.name) ?? key, at: s.at, cook: s.id });
    }
    return [...out.values()];
  }
  /** The kitchen a spot cooks for or eats from (null: no kitchen near; a picnic). */
  kitchenFor(s: Spot): Kitchen | null {
    const ks = this.kitchens(), b = this.buildingOf(s.place);
    if (b) { const k = ks.find((x) => x.key === b); if (k) return k; }
    if (s.activity === 'cook') return ks.find((x) => x.cook === s.id) ?? null;
    if (b && this.h.place(b)?.kind === 'building') return null;   // a building with no kitchen of its own: bring your own
    return ks.map((k) => ({ k, d: Math.hypot(k.at[0] - s.at[0], k.at[1] - s.at[1]) })).filter((x) => x.d <= OUTDOOR_REACH).sort((a, b) => a.d - b.d || (a.k.key < b.k.key ? -1 : 1))[0]?.k ?? null;
  }
  stock(key: string): { portions: number; dish: string | null; pots: number } {
    // the morning pot: on a world with days, a kitchen that has not been stocked today gets one pot (4 portions)
    const today = this.h.day?.() ?? '';
    if (today) {
      const cur = this.h.db.db.prepare('SELECT day, pots FROM god_meals_v1 WHERE world_id=? AND kitchen=?').get(this.h.worldId, key) as { day: string | null; pots: number } | undefined;
      if (!cur) this.h.db.db.prepare('INSERT INTO god_meals_v1(world_id, kitchen, portions, dish, cooked_by, pots, day) VALUES (?,?,?,?,NULL,0,?)').run(this.h.worldId, key, PORTIONS_PER_POT, DISHES[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % DISHES.length], today);
      else if (cur.day !== today) this.h.db.db.prepare('UPDATE god_meals_v1 SET portions=MAX(portions, ?), day=? WHERE world_id=? AND kitchen=?').run(PORTIONS_PER_POT, today, this.h.worldId, key);
    }
    const r = this.h.db.db.prepare('SELECT portions, dish, pots FROM god_meals_v1 WHERE world_id=? AND kitchen=?').get(this.h.worldId, key) as { portions: number; dish: string; pots: number } | undefined;
    return r ? { portions: r.portions, dish: r.dish, pots: r.pots } : { portions: 0, dish: null, pots: 0 };
  }
  private spotOf(capability: string): Spot | undefined { const id = capability.slice(capability.indexOf(':') + 1); return this.h.spots().spots.find((s) => s.id === id); }

  /** Labels and refusals on eat/cook offers (bridge capabilities). */
  capabilities(caps: EdgeCapability[]) {
    for (const c of caps) {
      if (c.verb !== 'eat' && c.verb !== 'cook') continue;
      const s = this.spotOf(c.id); if (!s) continue;
      const k = this.kitchenFor(s); if (!k) continue;
      const st = this.stock(k.key);
      if (c.verb === 'cook') { c.label = `${c.label}; makes ${PORTIONS_PER_POT} portions for ${k.name}${st.portions ? ` (${st.portions} ready now)` : ''}`; continue; }
      if (st.portions > 0) c.label = `${c.label}; ${st.dish} from ${k.name} (${st.portions} portion${st.portions === 1 ? '' : 's'} left)`;
      else { c.available = false; c.blocked = { code: 'meal.none', reason: `Nothing is cooked in ${k.name} yet: someone cooks there first (${k.cook ? `cook:${k.cook}` : 'cook'}; a pot makes ${PORTIONS_PER_POT} portions), or eat at a picnic table with your own food.` }; }
    }
  }
  /** An accepted eat act takes its portion now (two hungry residents cannot eat the last one). */
  reserve(capability: string, receiptId: string): { dish: string; kitchen: string; left: number } | null {
    if (!/^eat:/.test(capability)) return null;
    const s = this.spotOf(capability), k = s ? this.kitchenFor(s) : null; if (!k) return null;
    const st = this.stock(k.key); if (st.portions <= 0) return null;
    this.h.db.db.prepare('UPDATE god_meals_v1 SET portions=portions-1 WHERE world_id=? AND kitchen=?').run(this.h.worldId, k.key);
    this.h.db.db.prepare('INSERT OR REPLACE INTO god_meal_claims_v1(world_id, receipt_id, kitchen, state) VALUES (?,?,?,?)').run(this.h.worldId, receiptId, k.key, 'held');
    return { dish: st.dish!, kitchen: k.name, left: st.portions - 1 };
  }
  /** Receipts end: a cook adds a pot; an eat that did not finish gives its portion back. */
  onReceipt(r: EdgeReceipt) {
    if (r.phase === 'waiting' || r.phase === 'started') return;
    const claim = this.h.db.db.prepare('SELECT kitchen, state FROM god_meal_claims_v1 WHERE world_id=? AND receipt_id=?').get(this.h.worldId, r.id) as { kitchen: string; state: string } | undefined;
    if (claim?.state === 'held') {
      const eaten = r.phase === 'completed';
      this.h.db.db.prepare('UPDATE god_meal_claims_v1 SET state=? WHERE world_id=? AND receipt_id=?').run(eaten ? 'eaten' : 'refunded', this.h.worldId, r.id);
      if (!eaten) this.h.db.db.prepare('UPDATE god_meals_v1 SET portions=MIN(?, portions+1) WHERE world_id=? AND kitchen=?').run(MAX_PORTIONS, this.h.worldId, claim.kitchen);
    }
    if (r.phase === 'completed' && /^cook:/.test(r.capability)) {
      const s = this.spotOf(r.capability), k = s ? this.kitchenFor(s) : null; if (!k) return;
      // receipts can be announced more than once (restart re-delivery): one pot per completed cook receipt
      if (!Number(this.h.db.db.prepare('INSERT OR IGNORE INTO god_meal_claims_v1(world_id, receipt_id, kitchen, state) VALUES (?,?,?,?)').run(this.h.worldId, r.id, k.key, 'cooked').changes)) return;
      const st = this.stock(k.key), dish = st.portions > 0 && st.dish ? st.dish : DISHES[st.pots % DISHES.length];
      this.h.db.db.prepare('INSERT INTO god_meals_v1(world_id, kitchen, portions, dish, cooked_by, pots) VALUES (?,?,?,?,?,1) ON CONFLICT(world_id, kitchen) DO UPDATE SET portions=MIN(?, portions+?), dish=excluded.dish, cooked_by=excluded.cooked_by, pots=pots+1')
        .run(this.h.worldId, k.key, Math.min(MAX_PORTIONS, PORTIONS_PER_POT), dish, r.soulId, MAX_PORTIONS, PORTIONS_PER_POT);
    }
  }
}
