// Lane W3b (2026-10-19): what /assets/<sha>.<ext> puts on the wire.
// - Renditions: a core mesh asset may have a smaller encoding of the same look, listed in
//   worlds/core-assets/renditions.json (tools/blobs/def-renditions.mjs: shared parts, sub-pixel detail dropped, AVIF).
//   The viewer route serves it under the source sha, so defs, def hashes and live worlds stay exactly as they are; the
//   god routes (/v1/god/assets/<sha>) keep serving the source bytes.
// - Brotli: GLBs (meshopt streams, quantized attributes, JSON) shrink by about half again under brotli 11. A file is
//   compressed once, in the background (one at a time, so the libuv threadpool stays free for the world), kept on disk
//   beside the store (<dir>/wire/<sha>.<ext>.br) and in a small memory LRU; until it is ready the plain bytes go out.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompress, constants as Z } from 'node:zlib';

export type Rendition = { sha: string; path: string; bytes: number };
export type RenditionIndex = { schema: 'core-renditions/1'; renditions: Record<string, Rendition> };
const SHA = /^[0-9a-f]{64}$/;

/** source sha -> rendition, from a repo index; malformed rows and missing files are skipped. */
export function readRenditions(indexFile: string, repoRoot: string): Map<string, Rendition & { file: string }> {
  const out = new Map<string, Rendition & { file: string }>();
  if (!existsSync(indexFile)) return out;
  try {
    const idx = JSON.parse(readFileSync(indexFile, 'utf8')) as RenditionIndex;
    if (idx.schema !== 'core-renditions/1') return out;
    for (const [src, r] of Object.entries(idx.renditions ?? {})) {
      if (!SHA.test(src) || !SHA.test(r?.sha ?? '') || typeof r.path !== 'string' || r.path.includes('..')) continue;
      const file = join(repoRoot, r.path); if (existsSync(file)) out.set(src, { ...r, file });
    }
  } catch { /* an unreadable index means no renditions */ }
  return out;
}

const MEMORY = 96 * 1024 * 1024;
/** Brotli-11 copies of served files, made one at a time and kept on disk + in a byte-capped LRU. */
export class WireCache {
  private mem = new Map<string, Buffer>(); private memBytes = 0;
  private queue: { key: string; file: string }[] = []; private queued = new Set<string>(); private busy = false; private plain = new Set<string>();
  private readonly dir: string | null; private readonly minBytes: number;
  constructor(dir: string | null, minBytes = 1024) { this.dir = dir; this.minBytes = minBytes; }
  private diskPath(key: string) { return this.dir ? join(this.dir, `${key}.br`) : null; }
  private remember(key: string, br: Buffer) {
    this.mem.delete(key); this.mem.set(key, br); this.memBytes += br.length;
    for (const [k, v] of this.mem) { if (this.memBytes <= MEMORY) break; this.mem.delete(k); this.memBytes -= v.length; }
  }
  /** The brotli bytes for this file if ready; otherwise null, and the file is queued. `key` names the exact content. */
  brotli(key: string, file: string): Buffer | null {
    const hit = this.mem.get(key); if (hit) { this.mem.delete(key); this.mem.set(key, hit); return hit; }
    const disk = this.diskPath(key);
    if (disk && existsSync(disk)) { try { const b = readFileSync(disk); this.remember(key, b); return b; } catch { /* rebuilt below */ } }
    if (!this.queued.has(key) && !this.plain.has(key)) { try { if (statSync(file).size < this.minBytes) return null; } catch { return null; } this.queued.add(key); this.queue.push({ key, file }); this.pump(); }
    return null;
  }
  private pump() {
    if (this.busy) return; const job = this.queue.shift(); if (!job) return; this.busy = true;
    let raw: Buffer; try { raw = readFileSync(job.file); } catch { this.busy = false; this.queued.delete(job.key); this.pump(); return; }
    brotliCompress(raw, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_SIZE_HINT]: raw.length } }, (err, br) => {
      this.busy = false; this.queued.delete(job.key);
      if (!err && br.length < raw.length * 0.95) {
        this.remember(job.key, br);
        const disk = this.diskPath(job.key);
        if (disk) try { mkdirSync(this.dir!, { recursive: true }); writeFileSync(`${disk}.tmp`, br); renameSync(`${disk}.tmp`, disk); } catch { /* memory copy still serves */ }
      } else if (!err) this.plain.add(job.key); // does not compress (AVIF/PNG-heavy): always plain
      this.pump();
    });
  }
  /** Test hook: resolves when the queue is empty. */
  async idle() { while (this.busy || this.queue.length) await new Promise((r) => setTimeout(r, 5)); }
}

export const acceptsBrotli = (header: string | undefined) => (header ?? '').split(',').some((x) => x.trim().split(';')[0] === 'br');
