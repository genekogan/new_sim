// playtest compare <runA> <runB>: fidelity, metric and emergence deltas (B − A), and the issues that appeared,
// persisted or vanished (matched by title similarity). JSON on stdout; --md for a Markdown table.
import { join, basename } from 'node:path';
import { readJson } from '../lib/jsonl.mjs';
import { readLedger } from './metrics.mjs';
import { similar } from './reviewer.mjs';

const flatten = (o, p = '', out = {}) => { for (const [k, v] of Object.entries(o ?? {})) { const key = p ? `${p}.${k}` : k; if (typeof v === 'number') out[key] = v; else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'basis') flatten(v, key, out); } return out; };

export function compareRuns(a, b) {
  const ma = flatten(readJson(join(a, 'metrics.json'), {})), mb = flatten(readJson(join(b, 'metrics.json'), {}));
  const metrics = {}; for (const k of new Set([...Object.keys(ma), ...Object.keys(mb)])) if (k !== 'version' && ma[k] !== mb[k]) metrics[k] = { a: ma[k] ?? null, b: mb[k] ?? null, delta: ma[k] != null && mb[k] != null ? Math.round((mb[k] - ma[k]) * 1000) / 1000 : null };
  const la = readLedger(join(a, 'ledger.tsv')), lb = readLedger(join(b, 'ledger.tsv'));
  const byText = {}; [...la.map((r) => ['a', r]), ...lb.map((r) => ['b', r])].forEach(([w, r]) => { const k = `${r.seat}|${r.text}`; byText[k] = { ...(byText[k] ?? {}), [w]: r.fidelity }; });
  const fidelity = { perRequest: Object.entries(byText).map(([k, v]) => ({ seat: k.split('|')[0], text: k.split('|').slice(1).join('|'), a: v.a ?? null, b: v.b ?? null, changed: v.a !== v.b })) };
  const ea = flatten(readJson(join(a, 'emergence.json'), {})), eb = flatten(readJson(join(b, 'emergence.json'), {}));
  const emergence = {}; for (const k of new Set([...Object.keys(ea), ...Object.keys(eb)])) if (!/seed|shuffles|binSec|radius|version|wallMs/.test(k) && ea[k] !== eb[k]) emergence[k] = { a: ea[k] ?? null, b: eb[k] ?? null };
  const ia = readJson(join(a, 'issues.json'), []), ib = readJson(join(b, 'issues.json'), []);
  const issues = { appeared: ib.filter((x) => !ia.some((y) => similar(x.title, y.title))).map((x) => x.title), persisted: ib.filter((x) => ia.some((y) => similar(x.title, y.title))).map((x) => x.title), vanished: ia.filter((x) => !ib.some((y) => similar(x.title, y.title))).map((x) => x.title) };
  return { a: basename(a), b: basename(b), scenario: { a: readJson(join(a, 'scenario.json'), {}).name ?? null, b: readJson(join(b, 'scenario.json'), {}).name ?? null }, fidelity, metrics, emergence, issues };
}

export function compareMd(c) {
  const L = [`# Compare ${c.a} → ${c.b}`, '', '| metric | A | B | Δ |', '|---|---|---|---|'];
  Object.entries(c.metrics).forEach(([k, v]) => L.push(`| ${k} | ${v.a ?? '—'} | ${v.b ?? '—'} | ${v.delta ?? '—'} |`));
  L.push('', `Issues appeared: ${c.issues.appeared.join('; ') || 'none'} · persisted: ${c.issues.persisted.join('; ') || 'none'} · vanished: ${c.issues.vanished.join('; ') || 'none'}`);
  return L.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  if (!a || !b) { process.stderr.write('usage: compare.mjs <runA> <runB> [--md]\n'); process.exit(2); }
  const c = compareRuns(a, b); process.stdout.write(process.argv.includes('--md') ? compareMd(c) : JSON.stringify(c, null, 1) + '\n');
}
