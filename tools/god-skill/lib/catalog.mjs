// VOCAB-MECH: the catalogue for god agents. All of it fits in context for now; the server pages it for when it will not.
//   catalog [--category c] [--has slot:sit] [--tag t] [--page n] [--per n]   one line per def
//   find <words> [--category c] [--has x]                                      ranked, one line per def
//   recommend <free text intent>                                               what to place, per need, with an example batch
//   taxonomy                                                                   the category tree with counts; empty ones are for workers
import { call } from './state.mjs';

const okd = (r, what) => { if (r.status !== 200) throw new Error(`${what}: ${r.data?.message ?? r.data?.code ?? r.status}`); return r.data; };
const kb = (b) => (b ? ` ${b >= 1e6 ? (b / 1e6).toFixed(1) + 'MB' : Math.round(b / 1024) + 'KB'}` : '');
/** The server's vocab.manifestLine, for JSON rows. */
export const line = (r) => `${r.ref} [${r.cat}] ${r.size}m ${r.make}${r.tris ? ` ${r.tris}t` : ''}${kb(r.bytes)}${r.ifc ? ` {${r.ifc}}` : ''}${r.params ? ` (${r.params})` : ''}${r.syn?.length ? ` aka ${r.syn.join(',')}` : ''} — ${r.doc}`;
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) for (const x of [].concat(v ?? [])) if (x !== undefined && x !== true && x !== '') p.append(k, String(x)); return p.toString(); };

export async function catalog(flags = {}) {
  const d = okd(await call(`/v1/god/catalog?${qs({ category: flags.category, has: flags.has, tag: flags.tag, page: flags.page, per: flags.per ?? 500 })}`), 'catalog');
  if (flags.json) return d;
  const head = `${d.count} defs${flags.category ? ` in ${flags.category}` : ''}${d.pages > 1 ? `, page ${d.page}/${d.pages} (--page n)` : ''}. Line: ref [category] size make tris bytes {interfaces} (params) aka synonyms — doc. Place by ref; \`defs <ref>\` shows one in full.`;
  return [head, ...d.rows.map(line)].join('\n');
}
export async function find(words, flags = {}) {
  if (!words && !flags.category && !flags.has) throw new Error('find <words> [--category c] [--has slot:sit|action:open|actuator:door|comp:light]');
  const d = okd(await call(`/v1/god/defs?${qs({ q: words, category: flags.category, has: flags.has, tag: flags.tag, compact: 1, limit: flags.all ? 500 : 25 })}`), 'find');
  if (flags.json) return d.defs;
  if (!d.defs.length) return `nothing matches${words ? ` "${words}"` : ''}${flags.category ? ` in ${flags.category}` : ''}${flags.has ? ` with ${[].concat(flags.has).join(', ')}` : ''}${d.hint ? `. ${d.hint}` : ''}. Try \`recommend <what you want>\` or \`taxonomy\`.`;
  return [`${d.defs.length} match${words ? ` "${words}"` : ''}:`, ...d.defs.map((r) => `${line(r)}${r.why?.length ? `  ‹${r.why.join(' ')}›` : ''}`)].join('\n');
}
export async function recommend(intent, flags = {}) {
  if (!intent) throw new Error('recommend <what you want to make>, e.g. recommend a corner shop with a bench and a street lamp');
  const d = okd(await call(`/v1/god/recommend?${qs({ intent, per: flags.per })}`), 'recommend');
  if (flags.json) return d;
  return [`for "${intent}":`, ...d.needs.map((n) => `- ${n.for}: ${n.picks.map((p) => `${p.ref} [${p.cat}]`).join(', ')}`),
    ...(d.unmatched.length ? [`not in the catalogue: ${d.unmatched.join(', ')} (define it: define-kit, or see taxonomy)`] : []),
    `example batch (the first pick of each need, at the origin: set --at/--near before placing): ${JSON.stringify(d.example)}`].join('\n');
}
export async function taxonomy(flags = {}) {
  const d = okd(await call('/v1/god/catalog/taxonomy'), 'taxonomy');
  if (flags.json) return d;
  const rows = d.categories.map((c) => `${'  '.repeat(c.id.split('.').length - 1)}${c.id} — ${c.label}: ${c.count}${c.via ? ` (via ${c.via})` : ''}${!c.count && c.want?.length ? ` · wanted: ${c.want.slice(0, 8).join(', ')}` : ''}`);
  return ['categories (count of defs; place one with `find --category <id>`):', ...rows,
    `params every def may declare (conventions): ${Object.entries(d.conventions).map(([k, f]) => `${k}${f.values ? '=' + f.values.join('|') : f.min !== undefined ? `∈${f.min}..${f.max}` : ''}`).join(' ')}`,
    `actuators (Souls act on them): ${Object.entries(d.actuators).map(([k, a]) => `${k}→state.${a.field}`).join(' ')}`].join('\n');
}
