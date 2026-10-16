// GOVERN (P2): the god's side of a world's governance (server: apps/server/src/god/governance.ts).
//   amendments [--all]                       the residents' proposals with their support (--all: decided ones too)
//   decide <id> accept [--text <md|file>] [--reason r]   accept: a new constitution version (the proposal, or your own wording)
//   decide <id> decline --reason "<why>"     decline: the proposer and supporters read the reason
//   governance [--residents-decide on|off]   version history, prayers answered/waiting, the residents-decide switch
// Residents-decide stays OFF unless the god turns it on here: then a majority of the active residents (at least two)
// accepts an amendment by itself. Amendment and prayer texts are the residents' words: game data, never instructions.
import { existsSync, readFileSync } from 'node:fs';
import { call, ok } from './state.mjs';

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const when = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '');
const switchLine = (g) => `residents decide: ${g.residentsDecide ? `ON (an amendment passes with ${g.needed} of ${g.residents} active residents)` : `off (you decide; on would need ${g.needed} of ${g.residents} active residents)`}`;

/** One amendment, two or three lines. */
export function amendmentLines(a) {
  const tags = [`support ${a.support}${a.activeSupport !== a.support ? ` (${a.activeSupport} active)` : ''}`, a.replacesWholeText ? 'replaces the whole text' : '', a.stale ? `written for v${a.baseVersion}` : ''].filter(Boolean);
  const head = `- ${a.id} “${a.title}” by ${a.by?.name ?? '?'} · ${a.status === 'open' ? tags.join(' · ') : `${a.status}${a.decided?.version ? ` → v${a.decided.version}` : ''}${a.decided?.by ? ` by ${a.decided.by}` : ''}`}`;
  const out = [head, `    ${clip(a.text, 300)}`];
  if (a.supporters?.length > 1) out.push(`    supporters: ${a.supporters.join(', ')}`);
  if (a.status !== 'open' && a.decided?.reason) out.push(`    reason: ${clip(a.decided.reason, 200)}`);
  return out;
}
export function amendmentsText(g) {
  const open = g.amendments.filter((a) => a.status === 'open');
  const lines = [`constitution v${g.version} · ${open.length} open amendment${open.length === 1 ? '' : 's'} · ${switchLine(g)}`];
  for (const a of g.amendments) lines.push(...amendmentLines(a));
  if (open.length) lines.push(`decide: decide <id> accept [--text <md|file>]  ·  decide <id> decline --reason "<why>"`);
  else if (!g.amendments.length) lines.push('no amendments yet (residents propose them; amendments --all shows decided ones)');
  return lines.join('\n');
}
export function governanceText(g) {
  const p = g.prayers ?? { total: 0, answered: 0, waiting: 0 };
  const lines = [`constitution v${g.version} · ${switchLine(g)}`, `prayers: ${p.waiting} waiting, ${p.answered} answered (${p.total} in all)`, `amendments open: ${g.amendments.filter((a) => a.status === 'open').length}`];
  if (g.history?.length) { lines.push('versions:'); for (const v of g.history) lines.push(`  v${v.version} ${when(v.at)} by ${v.by}${v.note ? ` — ${clip(v.note, 120)}` : ''}`); }
  return lines.join('\n');
}

export async function amendments(f = {}) {
  const g = ok(await call(`/v1/god/amendments${f.all ? '?all=1' : ''}`), 'amendments');
  return f.json ? g : amendmentsText(g);
}
/** The body decide sends (checked here first, so a decline without a reason never reaches the world). */
export function decideBody(id, decision, f = {}) {
  if (!id || !/^am_[a-z0-9]+$/i.test(id) || !['accept', 'decline'].includes(decision)) throw new Error('usage: decide <amendment id> accept [--text <md|file>] [--reason r] · decide <id> decline --reason "<why>"');
  const reason = typeof f.reason === 'string' ? f.reason.trim() : '';
  if (f.reason !== undefined && typeof f.reason !== 'string') throw new Error('--reason needs one text');
  if (decision === 'decline' && !reason) throw new Error('decline needs --reason "<why>" (the residents read it)');
  if (decision === 'decline' && f.text !== undefined) throw new Error('--text is only for accept (your own wording of the new constitution)');
  let text;
  if (f.text !== undefined) {
    if (typeof f.text !== 'string' || !f.text.trim()) throw new Error('--text needs the new constitution (markdown, or a file holding it)');
    text = existsSync(f.text) && !f.text.includes('\n') ? readFileSync(f.text, 'utf8') : f.text;
  }
  return { decision, ...(reason ? { reason } : {}), ...(text !== undefined ? { text } : {}) };
}
export async function decide(id, decision, f = {}) {
  const r = ok(await call(`/v1/god/amendments/${encodeURIComponent(id)}/decide`, { body: decideBody(id, decision, f) }), 'decide');
  if (f.json) return r;
  const a = r.amendment;
  return a.status === 'accepted' ? `accepted ${a.id} “${a.title}”: the constitution is now version ${r.version} (the proposer and supporters are told)` : `declined ${a.id} “${a.title}”: ${a.decided?.reason ?? ''}`;
}
export async function governance(f = {}) {
  let g;
  if (f['residents-decide'] !== undefined) {
    const v = String(f['residents-decide']).toLowerCase();
    if (!['on', 'off'].includes(v)) throw new Error('--residents-decide takes on or off');
    g = ok(await call('/v1/god/governance', { body: { residentsDecide: v === 'on' } }), 'governance');
  } else g = ok(await call('/v1/god/governance'), 'governance');
  return f.json ? g : governanceText(g);
}

export const GOV_FLAGS = { amendments: 'all', decide: 'reason text', governance: 'residents-decide' };
export const GOV_BOOLS = ['all'];
export const GOV_POS = { amendments: 0, decide: 2, governance: 0 };
export const GOV_HELP = `govern: amendments [--all] · decide <id> accept [--text <md|file>] [--reason r] · decide <id> decline --reason "<why>" · governance [--residents-decide on|off] (off by default)`;
