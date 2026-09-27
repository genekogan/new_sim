// TakeLibrary: immutable takes + separately versioned camera tracks.
// Camera tracks reference a take by id; they are never part of the take body.
import { hashOf } from '../core/hash.ts';
import type { CameraTrack, Take } from './types.ts';
import { takeIdOf } from './recorder.ts';

export class TakeLibrary {
  private takes = new Map<string, Take>();
  private cams = new Map<string, CameraTrack>();

  /** Store a take (frozen). Rejects a take whose id does not match its content. */
  put(take: Take): string {
    const id = takeIdOf(take);
    if (id !== take.id) throw new Error(`take id ${take.id} does not match its content (${id})`);
    if (!this.takes.has(id)) this.takes.set(id, deepFreeze(structuredClone(take)));
    return id;
  }

  get(id: string): Take {
    const t = this.takes.get(id);
    if (!t) throw new Error(`no take ${id}`);
    return t;
  }

  has(id: string) {
    return this.takes.has(id);
  }

  /** Attach or replace a camera track. The take itself is untouched. */
  attachCamera(track: CameraTrack): CameraTrack {
    if (!this.takes.has(track.takeId)) throw new Error(`camera track ${track.id}: no take ${track.takeId}`);
    const c = structuredClone(track);
    this.cams.set(track.id, c);
    return c;
  }

  detachCamera(id: string) {
    return this.cams.delete(id);
  }

  cameras(takeId: string): CameraTrack[] {
    return [...this.cams.values()].filter((c) => c.takeId === takeId).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((c) => structuredClone(c));
  }

  /** Hash of the take body alone — identical however many camera tracks are attached. */
  takeHash(id: string) {
    return hashOf(this.get(id));
  }

  toJSON() {
    return { takes: [...this.takes.values()], cameras: [...this.cams.values()] };
  }

  static fromJSON(j: ReturnType<TakeLibrary['toJSON']>) {
    const lib = new TakeLibrary();
    for (const t of j.takes) lib.put(t);
    for (const c of j.cameras) lib.attachCamera(c);
    return lib;
  }
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}
