#!/usr/bin/env node
// catalog — the catalogue's CLI (CATALOG-PROGRAM P0). Usage: node packages/catalog/bin/catalog.mjs <command> [flags]
//   contract [--write]                       print (or write contract.json from) what the engine understands
//   import-core --registry <dir> [--no-gates] [--report <file.json>]
//                                            item/1 + def/2 for every core def → registry, published to stable + candidate
//   gate <id|alias>... [--registry <dir>]    run G1–G3 on items (by id@major or alias) and print the outcome
//   channels --registry <dir>                pointers + snapshot sizes
//   publish|promote|rollback|yank            channel moves (see --help on each)
//   resolve <ref> --registry <dir> [--channel stable]
//   tiers --registry <dir> [--hot N]         hot/cold split (writes tiers/<seq>.json)
//   embed --registry <dir> [--model <id>]    build the embedding index (local model; no paid API)
//   find <words> --registry <dir> [--k 10] [--mode lexical|semantic|fused]   retrieval, top k with why (default: the best
//                                            measured mode, lexical, until a sentence model beats it on eval/intents.json)
import { resolve } from 'node:path';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {}; const pos = [];
for (let i = 1; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; flags[k] = v; } else pos.push(a); }
const C = await import('../src/index.ts');
const reg = () => new C.Registry(resolve(String(flags.registry ?? '.lane/registry')));
const run = String(flags.run ?? `${cmd}-${new Date().toISOString().replace(/[:.]/g, '-')}`);

switch (cmd) {
  case 'build': {
    const receipt = flags.receipt ? JSON.parse(readFileSync(String(flags.receipt), 'utf8')) : undefined;
    const intents = JSON.parse(readFileSync(new URL('../eval/intents.json', import.meta.url), 'utf8')).intents;
    const built = await C.buildItem(pos[0], reg(), { run, receipt, intents });
    const out = resolve(String(flags.out ?? `.lane/build/${built.item.id.replace('/', '_')}@${built.item.major}`));
    mkdirSync(out, { recursive: true });
    for (const [name, value] of Object.entries({ build: built, item: built.item, def2: built.def2, 'engine-defs': [built.engine], gates: built.gates })) writeFileSync(`${out}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
    console.log(JSON.stringify({ ok: built.ok, ref: `${built.item.id}@${built.item.major}`, rev: built.item.rev, def1Hash: built.item.def1Hash, out, gates: built.gates.map(({ gate, ok, errors }) => ({ gate, ok, errors })) }, null, 1));
    if (flags.publish && built.ok) console.log(JSON.stringify(C.publishItem(reg(), built, run)));
    process.exitCode = built.ok ? 0 : 1;
    break;
  }
  case 'publish': {
    const built = JSON.parse(readFileSync(pos[0], 'utf8'));
    console.log(JSON.stringify(C.publishItem(reg(), built, run), null, 1)); break;
  }
  case 'compat': {
    const r = reg(), oldDef = r.def(pos[0]), next = r.def(pos[1]);
    if (!oldDef || !next) throw new Error('compat needs two stored def/2 rev hashes');
    const result = C.compatibility(oldDef, next); console.log(JSON.stringify(result, null, 1)); process.exitCode = result.compatible ? 0 : 1; break;
  }
  case 'eval': {
    const r = reg(), existing = r.current('stable').map((e) => r.item(e.id, e.major, e.rev, e.itemHash));
    const intents = JSON.parse(readFileSync(new URL('../eval/intents.json', import.meta.url), 'utf8')).intents;
    let bad = 0;
    for (const ref of pos) {
      const e = r.resolve(ref, String(flags.channel ?? 'stable')); if (!e) throw new Error(`no item ${ref}`);
      const report = C.g5(r.item(e.id, e.major, e.rev, e.itemHash), existing, intents); if (!report.ok) bad++;
      console.log(JSON.stringify({ ref, ...report }, null, 1));
    }
    process.exitCode = bad ? 1 : 0; break;
  }
  case 'contract': {
    const c = C.engineContract();
    if (flags.write) { writeFileSync(C.CONTRACT_FILE, JSON.stringify(c, null, 2) + '\n'); console.log(`wrote ${C.CONTRACT_FILE.pathname}`); }
    else console.log(JSON.stringify(c, null, 2));
    break;
  }
  case 'import-core': {
    const t0 = performance.now();
    const { items, rows } = await C.buildCoreItems({ run, gates: !flags['no-gates'] });
    const tiers = flags.hot ? (await import('../src/tiers.ts')) : null;
    const hot = tiers ? tiers.hotSet(items.map((x) => x.item), Number(flags.hot)) : null;
    const out = C.writeCore(reg(), items, run, hot ? (it) => (hot.has(it.id) ? 'hot' : 'cold') : undefined);
    const fails = (g) => rows.filter((r) => r.gates.find((o) => o.gate === g && !o.ok));
    const summary = { items: rows.length, ms: Math.round(performance.now() - t0), stable: out.stable, candidate: out.candidate, filled: rows.filter((r) => r.filled).length, actuators: rows.filter((r) => r.actuators.length).length, licences: Object.fromEntries([...new Set(rows.map((r) => r.licence))].map((l) => [l, rows.filter((r) => r.licence === l).length])), measured: Object.fromEntries([...new Set(rows.map((r) => r.how))].map((l) => [l, rows.filter((r) => r.how === l).length])), G1fail: fails('G1').length, G2fail: fails('G2').length, G3fail: fails('G3').length };
    console.log(JSON.stringify(summary, null, 1));
    if (flags.report) writeFileSync(String(flags.report), JSON.stringify({ summary, rows: rows.map((r) => ({ ...r, gates: r.gates.map((g) => ({ gate: g.gate, ok: g.ok, errors: g.errors, warnings: g.warnings, numbers: g.numbers })) })) }, null, 1));
    break;
  }
  case 'gate': {
    const r = reg(), contract = C.loadContract();
    let bad = 0;
    for (const ref of pos) {
      const e = r.resolve(ref, String(flags.channel ?? 'stable'));
      if (!e) { console.log(`${ref}: not found`); bad++; continue; }
      const item = r.item(e.id, e.major, e.rev, e.itemHash), def2 = r.def(e.rev);
      const o = await C.runGates({ item, def2, grandfathered: !!item.tests.gates.G1?.grandfathered }, contract, { all: true });
      if (!o.ok) bad++;
      console.log(`${e.id}@${e.major} ${o.ok ? 'PASS' : 'FAIL'}`);
      for (const g of o.outcomes) console.log(`  ${g.gate} ${g.ok ? 'ok ' : 'FAIL'} ${JSON.stringify(g.numbers)}${g.errors.length ? '\n    ✖ ' + g.errors.join('\n    ✖ ') : ''}${g.warnings.length ? '\n    · ' + g.warnings.join('\n    · ') : ''}`);
    }
    process.exit(bad ? 1 : 0);
  }
  case 'channels': { const r = reg(); const p = r.pointers(); console.log(JSON.stringify({ pointers: p, stable: r.current('stable').length, candidate: r.current('candidate').length, seqs: { stable: r.seqs('stable'), candidate: r.seqs('candidate') } }, null, 1)); break; }
  case 'promote': {
    const r = reg(), ids = pos.length ? pos : r.current('candidate').filter((e) => e.status === 'candidate').map((e) => `${e.id}@${e.major}`);
    console.log(C.promoteChecked(r, ids, run)); break;
  }
  case 'review-import': {
    if (!flags.by) throw new Error('--by <reviewer> is required');
    console.log(C.applyReviews(reg(), JSON.parse(readFileSync(pos[0], 'utf8')), String(flags.by), run)); break;
  }
  case 'rollback': console.log(reg().rollback(String(flags.channel ?? 'stable'), run, flags.to ? Number(flags.to) : undefined)); break;
  case 'yank': { const [ref] = pos; const m = /^(.+)@(\d+)$/.exec(ref); console.log(reg().yank(m[1], Number(m[2]), run, String(flags.reason ?? 'unspecified'))); break; }
  case 'resolve': console.log(JSON.stringify(reg().resolve(pos[0], String(flags.channel ?? 'stable')), null, 1)); break;
  case 'tiers': { const T = await import('../src/tiers.ts'); console.log(JSON.stringify(T.writeTiers(reg(), { hot: Number(flags.hot ?? 300), run }), null, 1)); break; }
  case 'embed': { const E = await import('../src/embed.ts'); console.log(JSON.stringify(await E.buildEmbeddings(reg(), { model: flags.model ? String(flags.model) : undefined, run }), null, 1)); break; }
  case 'find': { const E = await import('../src/embed.ts'); const hits = await E.find(reg(), pos.join(' '), { k: Number(flags.k ?? 10), mode: String(flags.mode ?? 'lexical') }); for (const h of hits) console.log(`${h.score.toFixed(3)}  ${h.line}  ‹${h.why.join(' ')}›`); break; }
  default: console.log('usage: catalog contract|import-core|gate|channels|promote|rollback|yank|resolve|tiers|embed|find  (see the header of this file)'); process.exit(cmd ? 2 : 0);
}
