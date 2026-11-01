// Content addressing for world states, plans and takes. Synchronous and
// dependency-free so it runs identically in Node tests, browsers and Workers.

/** E-life P1 (determinism-preserving): an entity-physics/1 value (engine-mars entity-physics.ts) carries `hash`, the
 *  content hash of exactly its `levels`, `byEntity` and `assets`, and is replaced, never mutated, when it changes. Their
 *  stable text (2.6–3.6 MB on Eden 2026, ~45 ms each time) is cached by that hash, so the world's state hash and every
 *  take id hash the same bytes without re-serialising the static physics each time. Output is byte-identical.
 *  An entry is kept only when its text hashes to its key (entityPhysicsHash = sha256 of exactly this composition):
 *  a physics-shaped copy whose text differs under the same `hash` (a snapshot's encoded data writes -0 as {"~n":"-0"})
 *  must never seed the cache, or the world's state hash would read that text and a restart refuses the snapshot. */
const PHYSICS_TEXT = new Map<string, { levels: string; byEntity: string; assets: string }>();
/** srv-hub-physics item 3: texts kept (by physics hash). The current physics and the one before it (a god edit's bridge
 *  and engine, or a take that straddles the edit, may still read the old one); each is ~3.4 MB on Eden 2026 (was 4). */
const PHYSICS_TEXT_KEEP = 2;
/** srv-hub-physics item 3: physics values whose `hash` nextEntityPhysics computed from exactly the texts physicsText
 *  writes (the same writer over the same parts, PART_TEXT included), sealed after: their texts need no re-hash to be
 *  trusted as the cache entry for that hash (was a second full sha256 of ~3.4 MB per god edit). A copy (a decoded
 *  snapshot) is another object and is still checked. */
const TRUSTED_PHYSICS = new WeakSet<object>();
export function trustPhysicsText(v: object) { TRUSTED_PHYSICS.add(v); }
/** G1 (tranche 2026-10-19): the stable text of entity-physics parts, by identity. A part is never mutated (a changed
 *  entity gets a new part), so nextEntityPhysics fills this once per part and a new physics value re-serialises only
 *  its changed parts (was the whole ~3 MB, three times per god edit on Eden 2026). Output is byte-identical. */
export const PART_TEXT = new WeakMap<object, string>();
function physicsText(v: Record<string, unknown>): { levels: string; byEntity: string; assets: string } {
  const key = v.hash as string;
  let hit = PHYSICS_TEXT.get(key);
  if (!hit) {
    hit = { levels: stableStringify(v.levels), byEntity: stableStringify(v.byEntity, PART_TEXT as unknown as ReadonlyMap<object, string>), assets: stableStringify(v.assets, PART_TEXT as unknown as ReadonlyMap<object, string>) };
    hit.byEntity.charCodeAt(0); hit.assets.charCodeAt(0);   // G1: flatten the ropes once (each later hash copies them)
    if (!TRUSTED_PHYSICS.has(v) && sha256(`{"assets":${hit.assets},"byEntity":${hit.byEntity},"levels":${hit.levels}}`) !== key) return hit;
    while (PHYSICS_TEXT.size >= PHYSICS_TEXT_KEEP) PHYSICS_TEXT.delete(PHYSICS_TEXT.keys().next().value!);
    PHYSICS_TEXT.set(key, hit);
  }
  return hit;
}
const isPhysics = (v: Record<string, unknown>) => v.version === 'entity-physics/1' && typeof v.hash === 'string' && (v.hash as string).length === 64;

/** Pin the existing native serializer's selection at an owned checkpoint boundary.
 * This intentionally preserves physicsText's existing validation/cache semantics;
 * callers retain scalar strings, never perform a later cache lookup. */
export function selectPhysicsTextForCapture(value: Record<string, unknown>): Readonly<Record<'levels' | 'byEntity' | 'assets', string>> | undefined {
  return isPhysics(value) ? Object.freeze({ ...physicsText(value) }) : undefined;
}

/** Where the stable text goes: appended to a string, or handed on in pieces (a streamed hash) once it passes `flushAt`.
 *  Pieces are whole tokens (JSON.stringify output, punctuation, cached texts), so a piece never splits a surrogate pair. */
class Sink {
  s = '';
  private readonly flush?: (piece: string) => void;
  constructor(flush?: (piece: string) => void) { this.flush = flush; }
  put(p: string) {
    this.s += p;
    if (this.flush && this.s.length >= 65536) { this.flush(this.s); this.s = ''; }
  }
  end() { if (this.flush && this.s) { this.flush(this.s); this.s = ''; } }
}

/** stableStringify's text, written piece by piece (one implementation for the string and the streamed hash). */
function writeStable(value: unknown, out: Sink, known?: ReadonlyMap<object, string>): void {
  if (value !== null && typeof value === 'object' && known?.has(value)) { out.put(known.get(value)!); return; }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`non-finite number in hashed state: ${value}`);
      out.put(Object.is(value, -0) ? '0' : JSON.stringify(value));
      return;
    }
    out.put(JSON.stringify(value) ?? 'null');
    return;
  }
  if (Array.isArray(value)) {
    // as `[${value.map((v) => (v === undefined ? 'null' : …)).join(',')}]`: a hole writes nothing, undefined writes null
    out.put('[');
    for (let i = 0; i < value.length; i++) {
      if (i) out.put(',');
      if (!(i in value)) continue;
      const v = value[i];
      if (v === undefined) out.put('null');
      else writeStable(v, out, known);
    }
    out.put(']');
    return;
  }
  const keys = Object.keys(value as object)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  const cached = isPhysics(value as Record<string, unknown>) ? physicsText(value as Record<string, unknown>) : null;
  out.put('{');
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (i) out.put(',');
    out.put(JSON.stringify(k));
    out.put(':');
    if (cached && (k === 'levels' || k === 'byEntity' || k === 'assets')) out.put(cached[k]);
    else writeStable((value as Record<string, unknown>)[k], out, known);
  }
  out.put('}');
}

/** JSON with sorted object keys; undefined fields dropped; -0 normalised. */
export function stableStringify(value: unknown, known?: ReadonlyMap<object, string>): string {
  const out = new Sink();
  writeStable(value, out, known);
  return out.s;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

// Hosts may use an equivalent native digest. Browser/Worker defaults stay
// dependency-free; the provider changes implementation, never hash semantics.
let nativeSha256: ((text: string) => string) | undefined;
/** An incremental digest with the same semantics (UTF-8 of the whole text), for streamed hashes. */
export type Sha256Stream = { update(piece: string): void; digest(): string; /** an independent stream with this state (optional) */ copy?(): Sha256Stream };
let nativeSha256Stream: (() => Sha256Stream) | undefined;
export function setSha256Provider(provider?: (text: string) => string, stream?: () => Sha256Stream) {
  nativeSha256 = provider;
  nativeSha256Stream = provider ? stream : undefined;
}

/** SHA-256 of a UTF-8 string, hex encoded. */
export function sha256(text: string): string {
  if (nativeSha256) return nativeSha256(text);
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (len * 8) >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

/** SHA-256 of stableStringify(value, known). With a streaming provider (the server's native digest) the text is hashed
 *  as it is written (lane L1: no multi-megabyte world text built, joined and flattened per hash); same digest. */
export function hashStable(value: unknown, known?: ReadonlyMap<object, string>): string {
  if (!nativeSha256Stream) return sha256(stableStringify(value, known));
  const h = nativeSha256Stream();
  const out = new Sink((piece) => h.update(piece));
  writeStable(value, out, known);
  out.end();
  return h.digest();
}

export const hashOf = (value: unknown) => hashStable(value);

/** Consume already-canonical JSON text pieces, preserving the writer's yield points.
 * Pieces never split a Unicode surrogate pair. Hosts use the existing native stream;
 * the portable fallback retains text and uses the same SHA implementation. */
export function* hashCanonicalSteps(tokens: Generator<string | void, void, void>): Generator<void, string, void> {
  const stream = nativeSha256Stream?.();
  const parts: string[] = [];
  for (const token of tokens) {
    if (typeof token !== 'string') { yield; continue; }
    if (stream) stream.update(token); else parts.push(token);
  }
  return stream ? stream.digest() : sha256(parts.join(''));
}

/** Where hashStableResumable can pick up next time: the sorted keys and values it hashed, and the digest state after
 *  the first `n` of them (inside the object's opening brace). The state is only ever copied, never updated. */
export type ResumeMark = { keys: string[]; values: unknown[]; n: number; state: Sha256Stream };
/**
 * hashStable(value, known) of a plain object (S1 V7b, take final states), resuming the digest after the longest run of
 * leading (sorted) keys whose values are the very objects the call that left `mark` hashed (an idle god world's base,
 * entity table and entity physics: ~5 MB of its ~5 MB text). Same bytes in the same order, so the same digest; without
 * a native stream that can copy its state it is plain hashStable.
 */
export function hashStableResumable(value: Record<string, unknown>, known: ReadonlyMap<object, string> | undefined, mark: ResumeMark | undefined): { hash: string; mark?: ResumeMark } {
  const mk = nativeSha256Stream;
  if (!mk || (known?.has(value)) || isPhysics(value)) return { hash: hashStable(value, known) };
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  let c = 0;   // leading keys that are the same objects as last time
  if (mark) while (c < keys.length && c < mark.keys.length && mark.keys[c] === keys[c] && value[keys[c]] === mark.values[c] && value[keys[c]] !== null && typeof value[keys[c]] === 'object') c++;
  let h: Sha256Stream, start: number, at: Sha256Stream | undefined;
  if (mark && mark.n <= c && mark.state.copy) { h = mark.state.copy(); start = mark.n; if (start === c) at = mark.state; }
  else { h = mk(); if (!h.copy) return { hash: hashStable(value, known) }; h.update('{'); start = 0; }
  const out = new Sink((piece) => h.update(piece));
  for (let i = start; ; i++) {
    if (i === c && !at) { out.end(); at = h.copy!(); }
    if (i === keys.length) break;
    if (i) out.put(',');
    out.put(JSON.stringify(keys[i]));
    out.put(':');
    writeStable(value[keys[i]], out, known);
  }
  out.put('}');
  out.end();
  return { hash: h.digest(), mark: { keys, values: keys.map((k) => value[k]), n: c, state: at! } };
}

/** Where hashPhysicsResumable can pick up next time: the assets and the sorted entity ids and parts it hashed, and the
 *  digest state before every PHYSICS_MARK_EVERY-th entity of byEntity. States are only ever copied, never updated, so a
 *  mark may be shared by later marks and resumed from by more than one next value. */
export type PhysicsHashMark = { assetKeys: string[]; assetValues: unknown[]; ids: string[]; parts: unknown[]; states: Sha256Stream[] };
const PHYSICS_MARK_EVERY = 16;
/**
 * srv-hub-physics item 2: hashStable({levels, byEntity, assets}, known) of entity physics (entity-physics.ts), resuming
 * the digest at the last checkpoint before the first entity of byEntity (sorted) whose part is not the very one the call
 * that left `mark` hashed, when the assets are the very same too. The text is `{"assets":…,"byEntity":{…},"levels":…}`:
 * same bytes in the same order, so the same digest. A one-entity god edit hashes the entities from its checkpoint on
 * plus the levels (on average half the ~3 MB, was all of it); without a native stream that can copy its state it is
 * plain hashStable.
 */
export function hashPhysicsResumable(p: { levels: unknown; byEntity: Record<string, unknown>; assets: Record<string, unknown> }, known: ReadonlyMap<object, string> | undefined, mark: PhysicsHashMark | undefined): { hash: string; mark?: PhysicsHashMark } {
  const mk = nativeSha256Stream;
  const fresh = mk?.();
  if (!fresh?.copy) return { hash: hashStable({ levels: p.levels, byEntity: p.byEntity, assets: p.assets }, known) };
  const assetKeys = Object.keys(p.assets).filter((k) => p.assets[k] !== undefined).sort(), assetValues = assetKeys.map((k) => p.assets[k]);
  const ids = Object.keys(p.byEntity).filter((k) => p.byEntity[k] !== undefined).sort(), parts = ids.map((k) => p.byEntity[k]);
  const same = (a: readonly unknown[], b: readonly unknown[]) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  let c = 0;   // leading entities that are the same parts as last time (after the same assets)
  if (mark && same(mark.assetKeys, assetKeys) && same(mark.assetValues, assetValues)) {
    while (c < ids.length && c < mark.ids.length && ids[c] === mark.ids[c] && parts[c] === mark.parts[c]) c++;
  } else mark = undefined;
  const block = mark ? Math.min(Math.floor(c / PHYSICS_MARK_EVERY), mark.states.length - 1) : -1;
  const states = mark ? mark.states.slice(0, block + 1) : [];
  let h: Sha256Stream;
  const out = new Sink((piece) => h.update(piece));
  let start: number;
  if (block >= 0) { h = states[block]!.copy!(); start = block * PHYSICS_MARK_EVERY; }
  else {
    h = fresh; start = 0;
    out.put('{"assets":'); writeStable(p.assets, out, known); out.put(',"byEntity":{');
  }
  for (let i = start; i < ids.length; i++) {
    if (i % PHYSICS_MARK_EVERY === 0 && i / PHYSICS_MARK_EVERY >= states.length) { out.end(); states.push(h.copy!()); }
    if (i) out.put(',');
    out.put(JSON.stringify(ids[i]));
    out.put(':');
    writeStable(parts[i], out, known);
  }
  out.put('},"levels":'); writeStable(p.levels, out, known); out.put('}');
  out.end();
  return { hash: h.digest(), mark: { assetKeys, assetValues, ids, parts, states } };
}
