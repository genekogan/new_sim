// C9: fading rule (vision §8; Gene §13: yellow at 30 min, red from 50, beam at exactly
// 60, idle clock resets on any accepted action). SHIPS FLAG-OFF: with `enabled` false
// nothing is recorded, no events are sent and status() is null. The ledger owns the
// body effects: it listens with onFade() to remove the body at 60 and to land it at a
// starting place on reclaim. Comms owns the clock, stream warnings and narration items.
import type {CommsCore} from './core.ts';
import type {Steward} from './steward.ts';
import {tx} from './store.ts';

export type FadeColour = 'green' | 'yellow' | 'red' | 'gone';
export const YELLOW_MS = 30 * 60_000, RED_MS = 50 * 60_000, GONE_MS = 60 * 60_000;
export type FadeChange = {soulId: string; colour: FadeColour; change: 'warn' | 'removed' | 'reclaimed'; idleSeconds: number};

const colourAt = (idle: number): FadeColour => idle >= GONE_MS ? 'gone' : idle >= RED_MS ? 'red' : idle >= YELLOW_MS ? 'yellow' : 'green';

export class Fading {
  private core: CommsCore; private steward: Steward; readonly enabled: boolean;
  private listeners: ((c: FadeChange) => void)[] = [];
  constructor(core: CommsCore, steward: Steward, enabled: boolean) {
    this.core = core; this.steward = steward; this.enabled = enabled;
    if (enabled) core.db.exec('CREATE TABLE IF NOT EXISTS edge_comms_activity (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, last_at INTEGER NOT NULL, colour TEXT NOT NULL, PRIMARY KEY (world_id, soul_id)) WITHOUT ROWID;');
  }
  onFade(l: (c: FadeChange) => void) { this.listeners.push(l); }
  private row(soulId: string) { return this.core.db.prepare('SELECT last_at, colour FROM edge_comms_activity WHERE world_id = ? AND soul_id = ?').get(this.core.worldId, soulId) as {last_at: number; colour: FadeColour} | undefined; }
  private set(soulId: string, lastAt: number, colour: FadeColour) {
    this.core.db.prepare('INSERT INTO edge_comms_activity (world_id, soul_id, last_at, colour) VALUES (?,?,?,?) ON CONFLICT (world_id, soul_id) DO UPDATE SET last_at = excluded.last_at, colour = excluded.colour').run(this.core.worldId, soulId, lastAt, colour);
  }
  private announce(c: FadeChange, text: string) {
    const tick = this.core.tick();
    this.core.streams.deliver(c.soulId, 'fade', tick, {colour: c.colour, change: c.change, idleSeconds: c.idleSeconds, text});
    this.core.spectate({kind: 'fade', tick, soulId: c.soulId, colour: c.colour, change: c.change});
    for (const l of this.listeners) { try { l(c); } catch { /* ledger listener faults never block the rule */ } }
  }

  /** Any accepted action by the Soul. Reclaims a faded Soul. */
  touch(soulId: string) {
    if (!this.enabled) return;
    const now = this.core.now();
    tx(this.core.db, () => {
      const prior = this.row(soulId);
      this.set(soulId, now, 'green');
      if (prior?.colour === 'gone') {
        const c: FadeChange = {soulId, colour: 'green', change: 'reclaimed', idleSeconds: 0};
        this.announce(c, 'You are back: you land on your feet at a starting place.');
        this.steward.narrate({soulId, what: 'reclaimed', data: {after: 'fading'}});
      }
    });
  }

  sweep() {
    if (!this.enabled) return;
    const now = this.core.now();
    for (const soulId of this.core.liveSoulIds()) tx(this.core.db, () => {
      const r = this.row(soulId);
      if (!r) { this.set(soulId, now, 'green'); return; }    // first sight after the flag goes on starts the clock
      const idle = now - r.last_at, colour = colourAt(idle);
      if (colour === r.colour || r.colour === 'gone' || colour === 'green') return;
      this.set(soulId, r.last_at, colour);
      const c: FadeChange = {soulId, colour, change: colour === 'gone' ? 'removed' : 'warn', idleSeconds: Math.floor(idle / 1000)};
      if (colour === 'gone') { this.announce(c, 'A light comes down; you recline, rise and fade from the world. Act again to return.'); this.steward.narrate({soulId, what: 'faded', data: {idleSeconds: c.idleSeconds}}); }
      else this.announce(c, colour === 'yellow' ? 'You have been idle 30 minutes. Act within 30 more to stay.' : 'Mist gathers; you fade at 60 minutes idle. Act now to stay.');
    });
  }

  status(soulId: string): {colour: FadeColour; idleSeconds: number} | null {
    if (!this.enabled) return null;
    const r = this.row(soulId);
    if (!r) return {colour: 'green', idleSeconds: 0};
    const idle = this.core.now() - r.last_at;
    return {colour: r.colour === 'gone' ? 'gone' : colourAt(idle), idleSeconds: Math.floor(idle / 1000)};
  }
}
