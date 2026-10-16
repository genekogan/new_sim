// W6: art in world-engine worlds — owners' agents hang and change images and looping videos in frames, screens and
// gallery walls, and the world records who made each piece (provenance, shown on hover in the viewer).
//
// Who may do what:
//   - the world creator's agent (a god token) may hang, change or clear art in any display;
//   - a resident's agent (a Soul token) may hang art in an empty slot, change or clear art it hung itself, and do
//     anything with a display its Soul owns (owner `soul:<id or name>`). It may not overwrite anyone else's art.
// The maker is written by the server from the caller's credential, never taken from the request:
//   `creator:<owner id>:<label>` or `soul:<soul id>:<name>`.
// Media must be an http(s) URL or a same-site path (e.g. one returned by POST /v1/art/media); videos are .mp4/.webm/
// .mov/.m4v and loop muted in the viewer. Every display def stores `media`, `title`, `maker`, one line per slot.
import type { Entity, Op, StoredDef, WorldModel } from '@sim/world-compiler';

export type Caller = { kind: 'creator'; owner: string | null; label?: string } | { kind: 'soul'; id: string; name: string };
export type HangRequest = { frame: string; media?: string | null; title?: string; slot?: number };
export type ArtFailure = { ok: false; status: number; code: string; message: string };
export type ArtPlan = { ok: true; id: string; slot: number; ops: Op[]; note: string };
export type DisplayInfo = { id: string; name: string | null; def: string; slots: number; p: [number, number, number]; yaw: number; owner: string | null; art: { slot: number; media: string; kind: 'image' | 'video'; title: string; maker: string }[] };

const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
export function mediaKind(url: string): 'image' | 'video' | null {
  if (typeof url !== 'string' || !url || url.length > 480 || /[\s"'<>\\]/.test(url)) return null;
  if (!/^(https:\/\/|http:\/\/|\/)/.test(url) || url.startsWith('//')) return null;
  return VIDEO.test(url.split(/[?#]/)[0]) ? 'video' : 'image';
}
const fail = (status: number, code: string, message: string): ArtFailure => ({ ok: false, status, code, message });
const clean = (s: string, max: number) => s.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const lines = (v: unknown, n: number) => { const a = typeof v === 'string' ? v.split('\n') : []; while (a.length < n) a.push(''); return a.slice(0, n); };

/** A def that shows media: it declares `components.display` and string `media`/`maker` state fields. */
export function displayOf(def: StoredDef | undefined): { slots: number; withMaker: boolean } | null {
  const d = (def?.components as { display?: { slots?: number } } | undefined)?.display;
  if (!def || !d || def.state?.media?.type !== 'string') return null;
  return { slots: Math.max(1, Math.min(8, d.slots ?? 1)), withMaker: def.state.maker?.type === 'string' && def.state.title?.type === 'string' };
}
export function makerOf(c: Caller): string {
  return c.kind === 'soul' ? `soul:${c.id}:${clean(c.name, 60)}` : `creator:${c.owner ?? ''}:${clean(c.label ?? '', 60)}`;
}
/** Does the caller's Soul own this display (owner `soul:<id>` or `soul:<name>`)? */
const ownsIt = (e: Entity, c: Extract<Caller, { kind: 'soul' }>) => e.owner === `soul:${c.id}` || e.owner === `soul:${c.name}`;

/** The edit that hangs (or, with media null/'', clears) one slot, or why the caller may not. */
export function planHang(model: WorldModel, caller: Caller, req: HangRequest): ArtPlan | ArtFailure {
  const e = model.entities.get(req.frame) ?? (model as unknown as { get?(n: string): Entity | undefined }).get?.(req.frame);
  if (!e) return fail(404, 'art.no-frame', `no display ${req.frame}`);
  const def = model.resolvedDef(e.def), disp = displayOf(def);
  if (!def || !disp) return fail(400, 'art.not-display', `${req.frame} is not a frame, screen or gallery wall`);
  if (!disp.withMaker) return fail(409, 'art.old-frame', `${req.frame} was placed from an older revision without a maker record; place a new frame to hang art with provenance`);
  const slot = req.slot ?? 0;
  if (!Number.isInteger(slot) || slot < 0 || slot >= disp.slots) return fail(400, 'art.slot', `slot must be 0..${disp.slots - 1}`);
  const clear = req.media === null || req.media === '' || req.media === undefined;
  if (!clear && !mediaKind(req.media!)) return fail(400, 'art.media', 'media must be an https URL or a same-site path (images, or .mp4/.webm/.mov/.m4v video), at most 480 characters, no spaces');
  const st = e.state ?? {}, media = lines(st.media, disp.slots), title = lines(st.title, disp.slots), maker = lines(st.maker, disp.slots);
  if (caller.kind === 'soul' && !ownsIt(e, caller)) {
    const mine = maker[slot].startsWith(`soul:${caller.id}:`);
    if (media[slot].trim() && !mine) return fail(403, 'art.not-yours', `slot ${slot} of ${req.frame} holds someone else's art; residents may fill empty slots and change their own`);
    if (clear && !mine) return fail(403, 'art.not-yours', 'you may only clear art you hung');
  }
  media[slot] = clear ? '' : req.media!;
  title[slot] = clear ? '' : clean(req.title ?? '', 120);
  maker[slot] = clear ? '' : makerOf(caller);
  const join = (a: string[]) => a.join('\n').replace(/\n+$/, '');
  const state = { media: join(media), title: join(title), maker: join(maker) };
  for (const [k, v] of Object.entries(state)) { const max = (def.state[k] as { max?: number }).max ?? 500; if (v.length > max) return fail(413, 'art.too-long', `${k} would exceed ${max} characters on this display`); }
  const who = caller.kind === 'soul' ? `${caller.name} (${caller.id})` : 'the world creator';
  return { ok: true, id: e.id, slot, ops: [{ op: 'set', id: e.id, state } as Op], note: `art: ${who} ${clear ? 'cleared' : 'hung'} ${req.frame}#${slot}${clear ? '' : ` ${state.title ? `"${title[slot]}" ` : ''}${req.media}`}` };
}

/** Every display in the world and what hangs in it (public: placements and art are visible to every viewer). */
export function listDisplays(model: WorldModel): DisplayInfo[] {
  const out: DisplayInfo[] = [];
  for (const e of model.entities.values()) {
    const def = model.resolvedDef(e.def), disp = displayOf(def); if (!disp) continue;
    const st = e.state ?? {}, media = lines(st.media, disp.slots), title = lines(st.title, disp.slots), maker = lines(st.maker, disp.slots);
    let p: { x: number; y: number; z: number; yaw: number }; try { p = model.worldPose(e); } catch { p = { x: 0, y: 0, z: 0, yaw: 0 }; }
    out.push({ id: e.id, name: (e as { name?: string }).name ?? null, def: e.def, slots: disp.slots, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], yaw: +p.yaw.toFixed(3), owner: e.owner ?? null,
      art: media.flatMap((m, slot) => { const kind = mediaKind(m.trim()); return kind ? [{ slot, media: m.trim(), kind, title: title[slot], maker: maker[slot] }] : []; }) });
  }
  return out;
}
