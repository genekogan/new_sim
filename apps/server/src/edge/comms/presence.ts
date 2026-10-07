// Arrival/departure fan-out from Ledger place changes. A Soul hears about another
// Soul entering or leaving a place it is itself in, at most once per change (the
// innermost shared place). Enclosed places reach every occupant; open places reach
// only occupants who can perceive the mover within PRESENCE_RADIUS (Ledger's
// perceivedBodies applies the enclosure rule); departures from open places also reach
// those who could perceive the mover at its previous place change.
import type {EdgeLedgerHooks, PlaceRef} from '../contract.ts';

export const PRESENCE_RADIUS = 20;

export type PresenceDeps = {
  ledger: EdgeLedgerHooks;
  liveSoulIds(): string[];
  nameOf(soulId: string): string;
  deliver(soulId: string, kind: string, tick: number, body: Record<string, unknown>): void;
};

export class Presence {
  private paths = new Map<string, string[]>();
  private enclosures = new Map<string, string | null>();
  private parentOf = new Map<string, string | null>();
  /** Who could perceive each mover at its previous place change (for departures). */
  private lastNear = new Map<string, Set<string>>();
  private d: PresenceDeps;
  constructor(d: PresenceDeps) { this.d = d; }

  private learn(path: PlaceRef[]) {
    for (let i = 0; i < path.length; i++) this.parentOf.set(path[i]!.id, path[i + 1]?.id ?? null);
  }
  private chain(placeId: string | null): string[] {
    const out: string[] = [];
    for (let id = placeId; id && out.length < 64 && !out.includes(id); id = this.parentOf.get(id) ?? null) out.push(id);
    return out;
  }
  /** Current place ids of a Soul, innermost first; remembers them for later diffs. */
  pathOf(soulId: string): string[] {
    let path: PlaceRef[] = [];
    try { path = this.d.ledger.placePathOf(soulId); } catch { path = []; }
    this.learn(path);
    const ids = path.map(p => p.id);
    this.paths.set(soulId, ids);
    try { this.enclosures.set(soulId, this.d.ledger.enclosureOf(soulId)); } catch { this.enclosures.set(soulId, null); }
    return ids;
  }
  prime() { for (const id of this.d.liveSoulIds()) this.pathOf(id); }

  onPlaceChange(e: {soulId: string; from: string | null; to: string | null; tick: number}) {
    const mover = e.soulId;
    const oldPath = this.paths.get(mover) ?? this.chain(e.from);
    const oldEnclosure = this.enclosures.get(mover) ?? null;
    const newPath = this.pathOf(mover);
    const newEnclosure = this.enclosures.get(mover) ?? null;
    const entered = newPath.filter(id => !oldPath.includes(id));
    const left = oldPath.filter(id => !newPath.includes(id));
    if (!entered.length && !left.length) return;
    let near: Set<string>;
    try { near = new Set(this.d.ledger.perceivedBodies(mover, PRESENCE_RADIUS).map(b => b.soulId)); } catch { near = new Set(); }
    const before = this.lastNear.get(mover) ?? new Set<string>();
    this.lastNear.set(mover, near);
    const soul = {soulId: mover, name: this.d.nameOf(mover)};
    for (const other of this.d.liveSoulIds()) {
      if (other === mover) continue;
      const theirs = this.pathOf(other);
      const arrival = entered.find(id => theirs.includes(id) && (id === newEnclosure || near.has(other)));
      const departure = left.find(id => theirs.includes(id) && (id === oldEnclosure || near.has(other) || before.has(other)));
      if (departure) this.d.deliver(other, 'departure', e.tick, {placeId: departure, soul, untrusted: true});
      if (arrival) this.d.deliver(other, 'arrival', e.tick, {placeId: arrival, soul, untrusted: true});
    }
  }
}
