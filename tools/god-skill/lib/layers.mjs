// LAYERS: the god's controls over a world's invisible systems (schedules, ownership, land use; and, only in a world
// that opts in with LAYERS=1, relationships and the economy: price, currency, give, pay, relate — deferred by default,
// the world refuses them with layers.deferred). Each verb is one validated, undoable edit (POST /v1/god/act); `layers`
// reads them back.
//   hours <ref> --open 07:00-15:00[@sat,sun] … [--event "market 09:00 240 sat"] [--follow locked@open=false/true] [--clear]
//   own <ref> <soul|god|group:name|none> [--private|--public] · access <ref> private|public|none
//   price <ref> <amount|none> [--service "a coffee"] · currency <name> · give <soul|group:x> <amount> · pay <from> <to> <amount>
//   zone <name> <use> --rect cx,cz,w,d|--circle cx,cz,r|--area '[[x,z],…]' · zone-suggest <use>
//   relate <a> <rel> <b> [--off]   (rel: friend neighbour family works-at lives-at member-of; ends: soul names, things, group:x)
//   layers   (the whole picture: zones, owners, hours, prices, relationships, wallets)
import { call, ok } from './state.mjs';
import { invalidate } from './mirror.mjs';
import { rectArea, circleArea } from './solver.mjs';

const RELS = ['friend', 'neighbour', 'family', 'works-at', 'lives-at', 'member-of'];
const USES = ['residential', 'commercial', 'park', 'farm', 'civic', 'industrial', 'wild'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const hhmm = (s, what) => { const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(s).trim()); if (!m || Number(m[1]) > 24 || Number(m[2] ?? 0) > 59) throw new Error(`${what}: a time is HH:MM (e.g. 07:00), got "${s}"`); return `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`; };
const days = (s, what) => { if (!s) return undefined; const d = String(s).toLowerCase().split(/[,/ ]+/).filter(Boolean).map((x) => x.slice(0, 3)); for (const x of d) if (!DAYS.includes(x)) throw new Error(`${what}: days are ${DAYS.join(',')}, got "${x}"`); return d; };
const list = (v) => (v === undefined ? [] : [].concat(v));
const val = (s) => (s === 'true' ? true : s === 'false' ? false : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s);

async function souls() { try { return ok(await call('/v1/god/layers'), 'layers').souls ?? []; } catch { return []; } }
/** soul name or id → soul:<id> (a Soul not here yet keeps its name); god; group:x; none → null. */
async function who(s, what = 'owner') {
  const v = String(s ?? '').trim(); if (!v) throw new Error(`${what}: whose? a Soul's name, god, group:<name> or none`);
  if (v === 'none') return null; if (v === 'god' || /^group:[a-z0-9][a-z0-9-]*$/.test(v)) return v;
  const n = v.replace(/^soul:/, ''), all = await souls(), hit = all.find((x) => x.id === n) ?? all.find((x) => x.name.toLowerCase() === n.toLowerCase());
  return `soul:${hit ? hit.id : n}`;
}
/** A relation end: a Soul, a group, the god, or a thing (anything else that is not a Soul). */
async function end(s) {
  const v = String(s).trim(); if (v === 'god' || v.startsWith('group:') || v.startsWith('thing:')) return v;
  const n = v.replace(/^soul:/, ''), all = await souls(), hit = all.find((x) => x.id === n) ?? all.find((x) => x.name.toLowerCase() === n.toLowerCase());
  if (hit || v.startsWith('soul:')) return `soul:${hit ? hit.id : n}`;
  return `thing:${v}`;
}
async function edit(ops, say, note) {
  const r = ok(await call('/v1/god/act', { body: { ops, note: note ?? say } }), 'act'); invalidate();
  return r.accepted ? `${say} (seq ${r.seq}; undo undoes it)` : `REFUSED: ${r.failures.map((f) => `${f.code}: ${f.detail}`).join('; ')}`;
}

export async function hours(ref, f) {
  if (!ref) throw new Error('hours <thing> --open 07:00-15:00 [--event "name 20:00 90 fri"] [--follow field@open=is/else]');
  if (f.clear) return edit([{ op: 'set', id: ref, schedule: null }], `${ref}: no schedule`);
  const s = {};
  for (const o of list(f.open)) { const [span, d] = String(o).split('@'); const [a, b] = span.split('-'); if (!b) throw new Error(`--open takes from-to (07:00-15:00), optionally @days (@sat,sun), got "${o}"`); s.open = [...(s.open ?? []), { from: hhmm(a, '--open'), to: hhmm(b, '--open'), ...(d ? { days: days(d, '--open') } : {}) }]; }
  for (const e of list(f.event)) { const w = String(e).trim().split(/\s+/); if (w.length < 2) throw new Error(`--event takes "name HH:MM [minutes] [days]", got "${e}"`); const name = w[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-'); const minutes = w[2] && /^\d+$/.test(w[2]) ? Number(w[2]) : 60; const d = w[2] && !/^\d+$/.test(w[2]) ? w[2] : w[3]; s.events = [...(s.events ?? []), { name, label: w[0].replace(/-/g, ' '), at: hhmm(w[1], '--event'), minutes, ...(d ? { days: days(d, '--event') } : {}) }]; }
  for (const x of list(f.follow)) { const m = /^([a-zA-Z][\w-]*)@(open|event|dark)=([^/]+)(?:\/(.+))?$/.exec(String(x)); if (!m) throw new Error(`--follow takes field@open|event|dark=value[/else] (locked@open=false/true, on@dark=true/false), got "${x}"`); s.follow = [...(s.follow ?? []), { field: m[1], when: m[2], is: val(m[3]), ...(m[4] !== undefined ? { else: val(m[4]) } : {}) }]; }
  if (!Object.keys(s).length) throw new Error('hours: give --open, --event or --follow (or --clear)');
  return edit([{ op: 'set', id: ref, schedule: s }], `${ref}: ${[...(s.open ?? []).map((o) => `open ${o.from}–${o.to}${o.days ? ' ' + o.days.join(',') : ''}`), ...(s.events ?? []).map((e) => `${e.label} ${e.at} ${e.minutes}m${e.days ? ' ' + e.days.join(',') : ''}`), ...(s.follow ?? []).map((x) => `${x.field} follows ${x.when}`)].join('; ')}`);
}
/** EVENTS: ready sets (metres from the scheduled thing's centre, its own frame; yaw in radians). `market`: a row of
 *  stalls behind a banner with crates; `concert`: a stage with floodlights, string lights, speakers and benches. */
export const EVENT_SETS = {
  market: (label) => [
    ...[-9, -3, 3, 9].map((x) => ({ def: 'core/market-stall@1', p: [x, 0] })),
    ...[[-6, 2], [0.5, 2.2], [6, 1.8]].map((p) => ({ def: 'core/crate@1', p })),
    { def: 'core/banner@1', p: [0, -4], state: { text: label.slice(0, 60) } },
  ],
  concert: () => [   // the stage at the back faces +z; the audience benches, under string lights, in front of it
    { def: 'core/stage@1', p: [0, -5] },
    { def: 'core/floodlight@1', p: [-8, -1], r: Math.PI, state: { on: true } }, { def: 'core/floodlight@1', p: [8, -1], r: Math.PI, state: { on: true } },
    { def: 'core/speaker@1', p: [-5.5, -1.5], state: { playing: true } }, { def: 'core/speaker@1', p: [5.5, -1.5], state: { playing: true } },
    { def: 'core/string-lights@1', p: [-4.5, 3.5], state: { on: true } }, { def: 'core/string-lights@1', p: [4.5, 3.5], state: { on: true } },
    ...[-4, 0, 4].map((x) => ({ def: 'core/bench@1', p: [x, 6] })),
  ],
};
const piece = (s) => {   // def@x,z[@yawdeg]  (core/lantern-post@1 is a def ref: the position follows the second @)
  const m = /^([a-z0-9][a-z0-9._/-]*@\d+|sha:[0-9a-f]{16,64})@(-?[\d.]+),(-?[\d.]+)(?:@(-?[\d.]+))?$/.exec(String(s).trim());
  if (!m) throw new Error(`--piece takes def@x,z[@yawdeg] (core/lantern-post@1@4,-2@90), got "${s}"`);
  return { def: m[1], p: [Number(m[2]), Number(m[3])], ...(m[4] !== undefined ? { r: Number(m[4]) * Math.PI / 180 } : {}) };
};
/** event <ref> "name HH:MM [minutes] [days]" [--set market|concert] [--piece def@x,z[@yaw]] [--shift dx,dz] [--label "…"]
 *  · event <ref> --remove <name>. Adds (or replaces, by name) one event in the thing's schedule, keeping its hours and
 *  other events. With a set, its things appear at the start and are packed away at the end. */
export async function event(ref, spec, f) {
  if (!ref) throw new Error('event <thing> "name HH:MM [minutes] [days]" [--set market|concert] [--piece def@x,z[@yawdeg]] [--shift dx,dz] [--label "…"] · event <thing> --remove <name>');
  const L = ok(await call('/v1/god/layers'), 'layers'), t = L.things.find((x) => x.id === ref || x.name === ref);
  const s = structuredClone(t?.schedule ?? {}), events = s.events ?? [];
  if (f.remove) {
    const name = String(f.remove === true ? spec ?? '' : f.remove).toLowerCase(); if (!events.some((e) => e.name === name)) throw new Error(`event: ${ref} has no event "${name}" (it has ${events.map((e) => e.name).join(', ') || 'none'})`);
    s.events = events.filter((e) => e.name !== name); if (!s.events.length) delete s.events;
    return edit([{ op: 'set', id: ref, schedule: Object.keys(s).length ? s : null }], `${ref}: no ${name} any more (its set is packed away if it was out)`);
  }
  const w = String(spec ?? '').trim().split(/\s+/); if (w.length < 2) throw new Error(`event: give "name HH:MM [minutes] [days]" (e.g. "market 09:00 240 sat"), got "${spec ?? ''}"`);
  const name = w[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-'), minutes = w[2] && /^\d+$/.test(w[2]) ? Number(w[2]) : 60, d = w[2] && !/^\d+$/.test(w[2]) ? w[2] : w[3];
  const label = String(f.label ?? w[0].replace(/-/g, ' ')).slice(0, 80);
  if (f.set && !EVENT_SETS[f.set]) throw new Error(`--set is one of ${Object.keys(EVENT_SETS).join(', ')} (or give --piece def@x,z …)`);
  const [sx, sz] = f.shift ? String(f.shift).split(',').map(Number) : [0, 0]; if (!Number.isFinite(sx) || !Number.isFinite(sz)) throw new Error('--shift takes dx,dz (metres)');
  const set = [...(f.set ? EVENT_SETS[f.set](label) : []), ...list(f.piece).map(piece)].map((p) => ({ ...p, p: [p.p[0] + sx, p.p[1] + sz] }));
  if (set.length > 24) throw new Error(`event: a set has at most 24 things (this one has ${set.length})`);
  const ev = { name, label, at: hhmm(w[1], 'event'), minutes, ...(d ? { days: days(d, 'event') } : {}), ...(set.length ? { set } : {}) };
  s.events = [...events.filter((e) => e.name !== name), ev];
  const end = (() => { const [h, m] = ev.at.split(':').map(Number), x = (h * 60 + m + minutes) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; })();
  const counts = {}; for (const p of set) { const k = p.def.replace(/^core\//, '').replace(/@\d+$/, ''); counts[k] = (counts[k] ?? 0) + 1; }
  const what = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
  return edit([{ op: 'set', id: ref, schedule: s }], `${ref}: ${label} ${ev.at}–${end}${ev.days ? ' ' + ev.days.join(',') : ' every day'}${set.length ? ` with its set (${what}): it appears at ${ev.at} and is packed away at ${end}` : ''}; whatson and the calendar list it`);
}
export async function own(ref, whom, f) {
  if (!ref) throw new Error('own <thing> <soul|god|group:name|none> [--private|--public]');
  const owner = await who(whom), op = { op: 'set', id: ref, owner };
  if (f.private) op.access = 'private'; else if (f.public) op.access = 'public';
  return edit([op], `${ref}: ${owner ? `owned by ${whom}` : 'no owner'}${op.access ? `, ${op.access}` : ''}`);
}
export async function access(ref, a) {
  if (!['private', 'public', 'none'].includes(a)) throw new Error('access <thing> private|public|none');
  return edit([{ op: 'set', id: ref, access: a === 'none' ? null : a }], `${ref}: ${a}`);
}
export async function price(ref, amount, f) {
  if (!ref || amount === undefined) throw new Error('price <thing> <amount|none> [--service "a coffee"]');
  if (amount === 'none') return edit([{ op: 'set', id: ref, price: null }], `${ref}: not for sale`);
  const n = Number(amount); if (!(n >= 0)) throw new Error(`price: amount is a number ≥ 0, got "${amount}"`);
  return edit([{ op: 'set', id: ref, price: { amount: n, ...(f.service ? { service: String(f.service) } : {}) } }], `${ref}: ${f.service ? `${f.service} for ${n}` : `for sale at ${n}`}`);
}
export const currency = (name) => { if (!name) throw new Error('currency <name> (e.g. shells)'); return edit([{ op: 'economy', currency: name === 'none' ? null : name }], `currency: ${name}`); };
export async function give(whom, amount) {
  const n = Number(amount); if (!Number.isFinite(n) || n === 0) throw new Error('give <soul|group:x> <amount> (negative takes)');
  const to = await who(whom, 'give'); if (!to) throw new Error('give to whom?');
  return edit([{ op: 'mint', to, amount: n }], `${n > 0 ? 'gave' : 'took'} ${Math.abs(n)} ${n > 0 ? 'to' : 'from'} ${whom}`);
}
export async function pay(from, to, amount) {
  const n = Number(amount); if (!(n > 0)) throw new Error('pay <from> <to> <amount>');
  return edit([{ op: 'pay', from: await who(from, 'pay'), to: await who(to, 'pay'), amount: n }], `${from} paid ${to} ${n}`);
}
export async function zone(name, use, f) {
  if (!name || !USES.includes(use)) throw new Error(`zone <name> <${USES.join('|')}> --rect cx,cz,w,d | --circle cx,cz,r | --area '[[x,z],…]'`);
  const area = f.rect ? rectArea(String(f.rect)) : f.circle ? circleArea(String(f.circle)) : f.area ? JSON.parse(String(f.area)) : null;
  if (!area) throw new Error('zone: give its outline: --rect cx,cz,w,d | --circle cx,cz,r | --area \'[[x,z],…]\'');
  const r = await edit([{ op: 'place', def: 'core/zone@1', name, shape: { area }, params: { use } }], `zone ${name}: ${use}`);
  if (r.startsWith('REFUSED')) return r;
  const s = ok(await call(`/v1/god/layers/zone-suggest?use=${use}`, { as: 'none' }), 'zone-suggest');
  return `${r}\nsuits: ${s.categories.map((c) => `${c.category}${c.defs.length ? ` (${c.defs.slice(0, 3).join(', ')})` : ''}`).join(' · ')}`;
}
export async function zoneSuggest(use) { if (!USES.includes(use)) throw new Error(`zone-suggest <${USES.join('|')}>`); return ok(await call(`/v1/god/layers/zone-suggest?use=${use}`, { as: 'none' }), 'zone-suggest'); }
export async function relate(a, rel, b, f) {
  if (!a || !RELS.includes(rel) || !b) throw new Error(`relate <a> <${RELS.join('|')}> <b> [--off]`);
  return edit([{ op: 'relate', a: await end(a), rel, b: await end(b), on: !f.off }], `${a} ${f.off ? 'no longer ' : ''}${rel} ${b}`);
}
export async function layers(f) {
  const L = ok(await call('/v1/god/layers'), 'layers');
  if (f.json) return L;
  const c = L.clock ? `${String(Math.floor(L.clock.minute / 60)).padStart(2, '0')}:${String(L.clock.minute % 60).padStart(2, '0')} ${DAYS[L.clock.weekday]} ${L.clock.day}` : 'no clock yet';
  const lines = [`clock ${c}${L.currency ? ` · currency ${L.currency}` : ' · no economy (LAYERS=1 opts in)'}`];
  if (L.zones.length) lines.push(`zones: ${L.zones.map((z) => `${z.name} (${z.use})`).join(', ')}`);
  for (const t of L.things) lines.push(`  ${t.name}: ${[t.owner ? `${t.owner}${t.access === 'private' ? ' (private)' : ''}` : t.access, t.price ? `${t.price.service ? t.price.service + ' ' : ''}${t.price.amount} ${L.currency}` : '', t.hours ?? '', ...(t.schedule?.follow ?? []).map((x) => `${x.field} follows ${x.when}`)].filter(Boolean).join(' · ')}`);
  for (const x of L.sets ?? []) lines.push(`  set: ${x.thing} ${x.label}: ${x.out}/${x.pieces} things out${x.on ? ' (on now)' : ''}${x.refused?.length ? ` · refused: ${x.refused.join('; ')}` : ''}`);
  if (L.relations?.length) lines.push(`relations: ${L.relations.map((r) => `${r.a} ${r.rel} ${r.b}`).join('; ')}`);
  const w = Object.entries(L.wallets ?? {}); if (w.length) lines.push(`wallets: ${w.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (L.souls?.length) lines.push(`souls: ${L.souls.map((s) => s.name).join(', ')}`);
  return lines.join('\n');
}
export const LAYERS_FLAGS = { hours: 'open event follow clear note', event: 'set piece shift label remove', own: 'private public', access: '', price: 'service', currency: '', give: '', pay: '', zone: 'rect circle area', 'zone-suggest': '', relate: 'off', layers: '' };
export const LAYERS_BOOLS = ['clear', 'private', 'public', 'off'];
export const LAYERS_POS = { hours: 1, event: 2, own: 2, access: 2, price: 2, currency: 1, give: 2, pay: 3, zone: 2, 'zone-suggest': 1, relate: 3, layers: 0 };
export const LAYERS_HELP = `layers: hours <ref> --open 07:00-15:00[@sat,sun] [--event "market 09:00 240 sat"] [--follow locked@open=false/true | on@dark=true/false] [--clear] (replaces the whole schedule) · event <ref> "market 09:00 240 sat" [--set market|concert] [--piece def@x,z[@yawdeg]] [--shift dx,dz] [--label "…"] (adds one event; its set appears while it is on) · event <ref> <name> --remove · own <ref> <soul|god|group:x|none> [--private|--public] · access <ref> private|public|none · zone <name> <residential|commercial|park|farm|civic|industrial|wild> --rect|--circle|--area · zone-suggest <use> · layers · only where the world opts in (LAYERS=1): price <ref> <n|none> [--service "a coffee"] · currency <name> · give <soul> <n> · pay <from> <to> <n> · relate <a> <friend|neighbour|family|works-at|lives-at|member-of> <b> [--off]`;
