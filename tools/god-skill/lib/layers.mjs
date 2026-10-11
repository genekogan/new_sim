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
  if (L.relations?.length) lines.push(`relations: ${L.relations.map((r) => `${r.a} ${r.rel} ${r.b}`).join('; ')}`);
  const w = Object.entries(L.wallets ?? {}); if (w.length) lines.push(`wallets: ${w.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (L.souls?.length) lines.push(`souls: ${L.souls.map((s) => s.name).join(', ')}`);
  return lines.join('\n');
}
export const LAYERS_FLAGS = { hours: 'open event follow clear note', own: 'private public', access: '', price: 'service', currency: '', give: '', pay: '', zone: 'rect circle area', 'zone-suggest': '', relate: 'off', layers: '' };
export const LAYERS_BOOLS = ['clear', 'private', 'public', 'off'];
export const LAYERS_POS = { hours: 1, own: 2, access: 2, price: 2, currency: 1, give: 2, pay: 3, zone: 2, 'zone-suggest': 1, relate: 3, layers: 0 };
export const LAYERS_HELP = `layers: hours <ref> --open 07:00-15:00[@sat,sun] [--event "market 09:00 240 sat"] [--follow locked@open=false/true | on@dark=true/false] [--clear] · own <ref> <soul|god|group:x|none> [--private|--public] · access <ref> private|public|none · zone <name> <residential|commercial|park|farm|civic|industrial|wild> --rect|--circle|--area · zone-suggest <use> · layers · only where the world opts in (LAYERS=1): price <ref> <n|none> [--service "a coffee"] · currency <name> · give <soul> <n> · pay <from> <to> <n> · relate <a> <friend|neighbour|family|works-at|lives-at|member-of> <b> [--off]`;
