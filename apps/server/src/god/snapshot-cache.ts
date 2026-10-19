// Lane W1 (tranche 2026-10-19, research B item 8): GET /v1/world/snapshot from a cache, already compressed.
//
// A world's public snapshot (1.7 MB of JSON for Eden 2026) was built, serialised and gzipped again for every visitor:
// ~0.2-0.3 s of server time on eden2, on the first picture's critical path. Here it is built once per state of the
// world (the edit seq, entity counter, builds revision and moderation version; at most a minute old) and kept as
// brotli (q9 at once, ~180 KB; q11, ~160 KB, a few seconds later while the world stays the same) and, for clients
// without brotli, gzip. Hidden entities are filtered out before anything is cached (the moderation middleware only
// re-filters gzip bodies, so a br body must already be clean; `x-snapshot-filtered` tells it this one is).
// `tick` and `now` are those of the moment the entry was built; `Age` says how old that is (the page adds it to
// `now`, as it does for an edge copy, lane O2).
import { brotliCompress, gzip, constants as Z } from 'node:zlib';
import { promisify } from 'node:util';

const br = promisify(brotliCompress), gz = promisify(gzip);
export const SNAPSHOT_FILTERED_HEADER = 'x-snapshot-filtered';

type Entry = { key: string; builtAt: number; json: Buffer; br?: Promise<Buffer>; best?: Buffer; gz?: Promise<Buffer>; upgrading?: boolean };
export type SnapshotBody = { body: Buffer; encoding: 'br' | 'gzip' | null; ageSeconds: number };

export type SnapshotCacheOptions = {
  /** The current public snapshot (built only on a miss). */
  build: () => unknown;
  /** Everything the snapshot is made of except tick/now; a new key is a new entry. */
  key: () => string;
  /** Drop what moderation hides (identity when nothing is hidden). */
  filter?: (snapshot: unknown) => unknown;
  maxAgeMs?: number; now?: () => number;
  /** Delay before the best-compression copy is made (0 in tests). */
  upgradeAfterMs?: number;
};

export class SnapshotCache {
  private entry: Entry | null = null;
  private readonly o: SnapshotCacheOptions;
  constructor(o: SnapshotCacheOptions) { this.o = o; }

  private current(): Entry {
    const now = (this.o.now ?? Date.now)(), key = this.o.key(), e = this.entry;
    if (e && e.key === key && now - e.builtAt < (this.o.maxAgeMs ?? 60_000)) return e;
    const snap = this.o.build(), clean = this.o.filter ? this.o.filter(snap) : snap;
    return (this.entry = { key, builtAt: now, json: Buffer.from(JSON.stringify(clean)) });
  }

  async respond(acceptEncoding: string | undefined): Promise<SnapshotBody> {
    const e = this.current(), accepts = (enc: string) => acceptsEncoding(acceptEncoding, enc);
    const ageSeconds = Math.max(0, Math.floor(((this.o.now ?? Date.now)() - e.builtAt) / 1000));
    if (accepts('br')) {
      if (e.best) return { body: e.best, encoding: 'br', ageSeconds };
      e.br ??= br(e.json, { params: { [Z.BROTLI_PARAM_QUALITY]: 9, [Z.BROTLI_PARAM_SIZE_HINT]: e.json.length } });
      const body = await e.br;
      this.upgrade(e);
      return { body, encoding: 'br', ageSeconds };
    }
    if (accepts('gzip')) return { body: await (e.gz ??= gz(e.json, { level: 6 })), encoding: 'gzip', ageSeconds };
    return { body: e.json, encoding: null, ageSeconds };
  }

  /** One q11 copy per entry, later, only while that entry is still the world's current state. */
  private upgrade(e: Entry) {
    if (e.upgrading || e.best) return; e.upgrading = true;
    setTimeout(() => {
      if (this.entry !== e) return;
      void br(e.json, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_SIZE_HINT]: e.json.length } }).then((b) => { if (this.entry === e) e.best = b; }, () => {});
    }, this.o.upgradeAfterMs ?? 5_000).unref?.();
  }
}

/** Accept-Encoding names `enc` (or `*`) with a q above 0. */
export function acceptsEncoding(header: string | undefined, enc: string): boolean {
  let star = false;
  for (const part of (header ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';').map((x) => x.trim());
    const qp = params.find((x) => x.startsWith('q=')), q = qp ? Number(qp.slice(2)) : 1;
    if (name === enc) return q > 0;
    if (name === '*') star = q > 0;
  }
  return star;
}
