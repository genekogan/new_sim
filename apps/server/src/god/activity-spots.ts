// E-life (overnight 2026-10-17): the old worlds' activity spots (activities/1), derived from what a god built.
// Old Eden authored 95 spots by hand (read at library chairs, write at desks, paint at easels, post letters, eat at picnic
// tables, play the piano, sing on the stage, listen from the audience, gym apparatus, park games). On a god's world the
// same affordances come from the things themselves: a bookcase is a shelf to take a book from, a chair near it is a place
// to read, a desk with a chair is a place to write, a computer desk is a computer, an easel is a place to paint, a postbox
// takes letters, a stove is a place to cook, a café chair at a table is a place to eat and drink, a piano's bench is where
// to play it, a stage has a microphone and room for a band, the benches facing it are an audience. The ledger's own
// activities code (edge/ledger/activities.ts) turns these spots into capabilities with ordinary body plans and receipts,
// exactly as on the old worlds. Pure read of the entity world and the engine; cached until the god edits something.
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';
import type { SpotsData, Spot, Shelf } from '../edge/ledger/activities.ts';
import { CATALOG } from '../../../../mars/viewer/engine/world/catalog.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type V2 = [number, number];
export type SpotsHost = {
  model: WorldModel;
  engine: { world: { entities: Record<string, any> }; standableNearV1?(at: V2, level?: number, except?: string, minClear?: number, maxRing?: number): V2 | null };
  /** Bumped by every god edit (not by a Soul carrying a cup about). */
  version(): string | number;
  levelAt(x: number, z: number, y: number): number;
  /** Innermost place holding a point (a room, a building, an area), and its name. */
  placeAt(at: V2, level: number): string | null;
  placeName(id: string): string | null;
};

/** How many seats per place offer the same seated activity (old Eden: 24 reading spots over the whole town). */
const PER_PLACE = { read: 4, eat: 3, write: 2, 'use-computer': 3, listen: 8 } as const;
/** Free spots offered per activity (nearest first) and places to read in. */
const NEAREST = 4;
const SHELF_READ_RADIUS = 8, TABLE_SEAT_GAP = 1.0, AUDIENCE_RADIUS = 30;
const r2 = (n: number) => Math.round(n * 100) / 100;
const d2 = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

type Thing = { id: string; e: Entity; def: StoredDef; name: string; tags: Set<string>; c: Record<string, any>; at: V2; y: number; yaw: number; level: number; size: [number, number, number]; slots: { id: string; kind: string; local: V2; yaw: number }[] };

/** Words that say what a def is (its name without `core-`, its tags). */
const kindOf = (t: Thing) => t.def.name.replace(/^core-/, '');
const is = (t: Thing, ...words: string[]) => words.some(w => t.tags.has(w) || kindOf(t) === w);
const SEAT_KINDS = new Set(['chair', 'armchair', 'sofa', 'stool', 'bench-seat', 'bench', 'pew', 'office-chair', 'dining-chair', 'bar-stool', 'loveseat']);

export class GodActivitySpots {
  private h: SpotsHost;
  private cache: { key: string; value: SpotsData } | null = null;
  /** Last derive time (ms) and counts, for the perf table and diagnostics. */
  stats = { ms: 0, spots: 0, shelves: 0, derives: 0 };
  constructor(h: SpotsHost) { this.h = h; }

  data(): SpotsData {
    const key = `${this.h.version()}:${this.h.model.entities.size}`;
    if (this.cache?.key === key) return this.cache.value;
    const t0 = performance.now(), value = this.derive();
    this.stats = { ms: Math.round(performance.now() - t0), spots: value.spots.length, shelves: value.shelves.length, derives: this.stats.derives + 1 };
    this.cache = { key, value };
    return value;
  }

  private things(): Thing[] {
    const m = this.h.model, ents = this.h.engine.world.entities, out: Thing[] = [];
    for (const [id, x] of Object.entries(ents)) {
      if (!x?.tags?.includes('entity-world') || x.kind === 'human' || x.support?.kind === 'in-hand') continue;
      const e = m.entities.get(id); if (!e) continue;
      const def = m.resolvedDef(e.def); if (!def) continue;
      const a = CATALOG[x.def]; if (!a) continue;
      const at: V2 = [x.pose.p[0], x.pose.p[2]], y = x.pose.p[1];
      out.push({ id, e, def, name: (e.name ?? kindOf({ def } as Thing)).replace(/-/g, ' '), tags: new Set(def.tags), c: def.components as Record<string, any>, at, y, yaw: x.pose.yaw ?? 0,
        level: this.h.levelAt(at[0], at[1], y), size: a.size as [number, number, number], slots: (a.slots ?? []).map(s => ({ id: s.id, kind: s.kind, local: s.local as V2, yaw: s.yaw })) });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** A local (x, z) of a thing in world coordinates (engine poses carry Mars yaw: x' = x cos − z sin). */
  private world(t: Thing, l: V2): V2 { const c = Math.cos(t.yaw), s = Math.sin(t.yaw); return [r2(t.at[0] + l[0] * c - l[1] * s), r2(t.at[1] + l[0] * s + l[1] * c)]; }
  /** Where a body stands to use a thing: its own `stand` slot (a postbox's letter slot, a bookcase's browse point), else
   *  in front of it (+z local, the def's front). */
  private standAt(t: Thing, slot?: string): V2 | null {
    const s = t.slots.find(q => q.kind === 'stand' && (!slot || q.id === slot));
    // No standing-ground probe here (it paged in fine nav tiles across the whole world: 18 s on Eden 2026); the ledger's
    // activities step a spot that lies inside furniture back out at offer time, near the Soul, from warm tiles.
    return s ? this.world(t, s.local) : this.world(t, [0, t.size[2] / 2 + 0.45]);
  }
  private place(at: V2, level: number) { return this.h.placeAt(at, level) ?? undefined; }
  private label(t: Thing, place?: string) { const p = place ? this.h.placeName(place) : null; return `${t.name}${p && p.toLowerCase() !== t.name.toLowerCase() ? ` in ${p}` : ''}`.slice(0, 80); }

  private derive(): SpotsData {
    const all = this.things(), spots: Spot[] = [], shelves: Shelf[] = [], used = new Set<string>();
    const seats = all.filter(t => SEAT_KINDS.has(kindOf(t)) && t.slots.some(s => s.kind === 'seat'));
    const seatHeight = (t: Thing) => { const h = Number(t.c.seat?.height); return Number.isFinite(h) && h >= 0.2 && h <= 1.2 ? h : undefined; };
    const add = (s: Spot) => { if (!used.has(s.id)) { used.add(s.id); spots.push(s); } };
    const standSpot = (t: Thing, activity: string, extra: Partial<Spot> = {}, slot?: string) => {
      const at = this.standAt(t, slot); if (!at) return;
      const place = this.place(at, t.level);
      add({ id: `${activity}.${t.id}`.toLowerCase(), activity, base: 'idle', at, faceTo: [r2(t.at[0]), r2(t.at[1])], label: this.label(t, place), ...(place ? { place } : {}), ...(t.level ? { level: t.level } : {}), ...extra });
    };
    const seatSpot = (seat: Thing, activity: string, faceTo: V2 | undefined, extra: Partial<Spot> = {}) => {
      const place = this.place(seat.at, seat.level), h = seatHeight(seat);
      add({ id: `${activity}.${seat.id}`.toLowerCase(), activity, base: 'sit', at: [r2(seat.at[0]), r2(seat.at[1])], seat: seat.id, ...(faceTo ? { faceTo } : {}), ...(h ? { seatHeight: h } : {}), label: this.label(seat, place), ...(place ? { place } : {}), ...(seat.level ? { level: seat.level } : {}), ...extra });
    };
    /** Seats beside a table or desk (within a metre of its edge), nearest first. */
    const seatsAt = (t: Thing) => seats.filter(s => s.level === t.level && d2(s.at, t.at) <= Math.hypot(t.size[0], t.size[2]) / 2 + TABLE_SEAT_GAP).sort((a, b) => d2(a.at, t.at) - d2(b.at, t.at) || (a.id < b.id ? -1 : 1));
    const perPlace = new Map<string, number>(), room = (activity: keyof typeof PER_PLACE, place: string | undefined) => { const k = `${activity}|${place ?? ''}`, n = perPlace.get(k) ?? 0; if (n >= PER_PLACE[activity]) return false; perPlace.set(k, n + 1); return true; };

    // B1 read: every bookcase or bookshelf is a shelf (take a book, put it back); a lectern is read standing; the chairs,
    // armchairs and sofas near shelves in the same place are where to sit and read.
    const shelfThings = all.filter(t => is(t, 'bookcase', 'bookshelf', 'books', 'library') && (t.c.container || t.c.readable) && !t.c.carryable);
    for (const t of shelfThings) {
      const at = this.standAt(t, 'browse'); if (!at) continue;
      const place = this.place(at, t.level);
      shelves.push({ id: `shelf.${t.id}`.toLowerCase(), at, faceTo: [r2(t.at[0]), r2(t.at[1])], ...(place ? { place } : {}), ...(t.level ? { level: t.level } : {}) });
    }
    for (const s of seats) {
      if (kindOf(s) === 'office-chair') continue;
      const shelf = shelves.filter(q => (q.level ?? 0) === s.level && d2(q.at, s.at) <= SHELF_READ_RADIUS).sort((a, b) => d2(a.at, s.at) - d2(b.at, s.at))[0]; if (!shelf) continue;
      const place = this.place(s.at, s.level); if (shelf.place && place && shelf.place !== place) continue;
      if (room('read', place)) seatSpot(s, 'read', undefined, { prop: 'book' });
    }
    for (const t of all) if (is(t, 'lectern') && t.c.readable) standSpot(t, 'read', { prop: 'book' }, 'reader');

    // B1 write / B4 computers: a desk with a chair is a place to write (or to use its computer); without one, standing
    for (const t of all) {
      const computer = t.c.workstation?.kind === 'computer', desk = computer || t.c.workstation?.kind === 'desk' || is(t, 'school-desk', 'desk', 'office-desk');
      if (!desk) continue;
      const activity = computer ? 'use-computer' : 'write', chair = seatsAt(t).find(s => !used.has(`write.${s.id}`) && !used.has(`use-computer.${s.id}`) && !used.has(`read.${s.id}`));
      const place = this.place(t.at, t.level); if (!room(activity, place)) continue;
      if (chair) seatSpot(chair, activity, [r2(t.at[0]), r2(t.at[1])], { label: this.label(t, place), ...(computer ? { also: ['write'] } : { prop: 'pen' }) });
      else standSpot(t, activity, computer ? { also: ['write'] } : {}, 'user');
    }
    // B4 paint at easels; other workstations by kind
    for (const t of all) {
      const k = t.c.workstation?.kind;
      if (k === 'painting' || is(t, 'easel')) standSpot(t, 'paint');
      else if (k === 'cooking' || is(t, 'stove', 'hearth')) standSpot(t, 'cook');
      else if (is(t, 'arcade-cabinet', 'pool-table', 'dartboard', 'foosball')) standSpot(t, 'play-game', {}, t.slots.find(s => s.kind === 'stand')?.id);
    }
    // B8 post letters at postboxes and mailboxes
    for (const t of all) if (is(t, 'postbox', 'mailbox', 'post-box', 'letterbox')) standSpot(t, 'post-letter', {}, 'post');

    // B2 eat and drink: a picnic or parasol table seats its own diners; a café or dining table, the chairs round it
    for (const t of all) {
      if (!t.c.surface || !(is(t, 'table', 'cafe', 'picnic-table', 'parasol-table', 'round-table', 'long-table') || t.tags.has('table'))) continue;
      if (t.c.workstation || is(t, 'school-desk', 'desk', 'office-desk', 'workbench')) continue;
      const place = this.place(t.at, t.level), face: V2 = [r2(t.at[0]), r2(t.at[1])];
      // not in a library, a classroom, an office or a study: their tables are for reading and work (old Eden: book club)
      if (/librar|classroom|school|office|study|reading|lecture/i.test(`${place ?? ''} ${place ? this.h.placeName(place) ?? '' : ''} ${t.name}`)) continue;
      if (t.slots.some(s => s.kind === 'seat')) { if (room('eat', place)) seatSpot(t, 'eat', face, { also: ['drink'], prop: 'plate' }); continue; }
      for (const s of seatsAt(t).slice(0, 2)) { if (used.has(`eat.${s.id}`) || used.has(`read.${s.id}`) || !room('eat', place)) continue; seatSpot(s, 'eat', face, { also: ['drink'], label: `${this.label(t, place)}` }); }
    }

    // B3 the piano from its own bench; a stage: the microphone at its centre and a band behind; audience seats facing it
    for (const t of all) if (t.c.instrument?.kind === 'piano' || is(t, 'piano')) {
      if (t.slots.some(s => s.kind === 'seat')) seatSpot(t, 'play-piano', undefined, { instrument: 'piano' }); else standSpot(t, 'play-piano', { instrument: 'piano' });
    }
    for (const t of all) {
      const inst = INSTRUMENT_TAGS.find(([tag]) => t.tags.has(tag));
      if (inst) standSpot(t, 'play-music', { instrument: inst[1] });
      if (is(t, 'microphone', 'mic-stand')) standSpot(t, 'sing');
    }
    for (const t of all) {
      if (!t.c.venue) continue;
      const floorY = Number(t.c.floor?.y ?? 0), level = floorY > 0.3 ? this.h.levelAt(t.at[0], t.at[1], t.y + floorY) : t.level, place = this.place(t.at, t.level);
      const on = (l: V2): V2 => this.world(t, l), stage = is(t, 'stage', 'bandstand');
      if (stage) {
        const hw = t.size[0] / 2, hd = t.size[2] / 2, front: V2 = this.world(t, [0, hd + 6]);
        add({ id: `sing.${t.id}`.toLowerCase(), activity: 'sing', base: 'idle', at: on([0, Math.min(0.5, hd - 0.6)]), faceTo: front, label: `the microphone on ${this.label(t, place)}`, ...(place ? { place } : {}), ...(level ? { level } : {}) });
        for (const [k, inst, x] of [['guitar', 'guitar', -0.45], ['keyboard', 'keyboard', 0], ['drums', 'drums', 0.45]] as const)
          add({ id: `play-music.${t.id}.${k}`.toLowerCase(), activity: 'play-music', base: inst === 'drums' ? 'sit' : 'idle', at: on([r2(x * hw), r2(-hd * 0.45)]), faceTo: front, instrument: inst, label: `the ${inst} on ${this.label(t, place)}`, ...(place ? { place } : {}), ...(level ? { level } : {}) });
      }
      // the audience: free seats in front of it (its +z side), nearest first
      const fp = this.world(t, [0, 1]), fwd: V2 = [fp[0] - t.at[0], fp[1] - t.at[1]];
      const crowd = seats.filter(s => s.level === t.level && d2(s.at, t.at) <= AUDIENCE_RADIUS && ((s.at[0] - t.at[0]) * fwd[0] + (s.at[1] - t.at[1]) * fwd[1]) > 1).sort((a, b) => d2(a.at, t.at) - d2(b.at, t.at) || (a.id < b.id ? -1 : 1));
      let n = 0; for (const s of crowd) { if (n >= PER_PLACE.listen) break; if (used.has(`read.${s.id}`) || used.has(`eat.${s.id}`)) continue; seatSpot(s, 'listen', [r2(t.at[0]), r2(t.at[1])], { label: `a seat facing ${this.label(t, place)}` }); n++; }
    }

    // B5 the playground and the gym and courts the god put up (tags say which apparatus)
    for (const t of all) {
      if (is(t, 'swings') && t.slots.some(s => s.kind === 'seat')) seatSpot(t, 'swing', undefined);
      if (is(t, 'see-saw') && t.slots.some(s => s.kind === 'seat')) seatSpot(t, 'seesaw', undefined, { together: { group: `seesaw-${t.id}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80), need: 1, wait: 60, alone: 'fail' } });
      for (const [tag, activity, base] of APPARATUS) if (t.tags.has(tag)) {
        if (base === 'lie') { const h = Number(t.c.seat?.height ?? t.size[1]); const at = this.standAt(t); if (!at) continue; const place = this.place(t.at, t.level);
          add({ id: `${activity}.${t.id}`.toLowerCase(), activity, base: 'lie', at: [r2(t.at[0]), r2(t.at[1])], seatHeight: Math.min(1.2, Math.max(0.2, h)), label: this.label(t, place), ...(place ? { place } : {}) }); }
        else standSpot(t, activity);
      }
      if (t.tags.has('garden-bed') || kindOf(t) === 'garden-bed') standSpot(t, 'garden');
    }
    // B5 courts: a volleyball net gives two places a side; a pétanque piste two throwing places at one end
    for (const t of all) {
      const place = this.place(t.at, t.level);
      if (t.tags.has('volleyball-net')) for (const [k, l, f] of [['a1', [-1.5, -3], [-1.5, 3]], ['a2', [1.5, -3], [1.5, 3]], ['b1', [-1.5, 3], [-1.5, -3]], ['b2', [1.5, 3], [1.5, -3]]] as const)
        add({ id: `play-volleyball.${t.id}.${k}`.toLowerCase(), activity: 'play-volleyball', base: 'idle', at: this.world(t, l as unknown as V2), faceTo: this.world(t, f as unknown as V2), label: this.label(t, place), ...(place ? { place } : {}) });
      if (t.tags.has('petanque')) for (const [k, x] of [['a', -0.6], ['b', 0.6]] as const)
        add({ id: `play-petanque.${t.id}.${k}`.toLowerCase(), activity: 'play-petanque', base: 'idle', at: this.world(t, [x, -t.size[2] / 2 + 0.6]), faceTo: this.world(t, [x, t.size[2] / 2]), label: this.label(t, place), ...(place ? { place } : {}) });
    }
    return { contract: 'activity-spots/1', spots, shelves, interiors: [], solids: [], rings: [], platforms: [], nearest: NEAREST };
  }
}

/** Def tags that name a playable instrument (the body pose draws it). */
const INSTRUMENT_TAGS: [string, string][] = [['drum-kit', 'drums'], ['drums', 'drums'], ['guitar', 'guitar'], ['bass-guitar', 'bass'], ['violin', 'violin'], ['cello', 'cello'], ['keyboard-stand', 'keyboard'], ['flute', 'flute'], ['ukulele', 'ukulele']];
/** Def tags of gym apparatus and the activity done at it (lying ones on its top). */
const APPARATUS: [string, string, 'idle' | 'lie'][] = [['pull-up-bar', 'pull-ups', 'idle'], ['dip-bars', 'dips', 'idle'], ['weight-bench', 'bench-press', 'lie'], ['dumbbells', 'lift-weights', 'idle'], ['yoga-mat', 'yoga', 'lie'], ['exercise-mat', 'situps', 'lie']];
