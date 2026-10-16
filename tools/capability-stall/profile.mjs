// Summarise a V8 .cpuprofile: time under one root function (default `binds`), by inclusive and by self time.
//   node tools/capability-stall/profile.mjs .lane/capstall/before.cpuprofile [rootFunction=binds] [top=25]
import {readFileSync} from 'node:fs';

const [file, rootName = 'binds', topArg = '25'] = process.argv.slice(2);
const top = Number(topArg), prof = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n])), parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const label = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*\/(apps|packages|mars)\//, '$1/')}:${n.callFrame.lineNumber + 1}`;
const self = new Map();                              // node id -> µs
for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i] ?? 0));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const underRoot = (id) => { for (let x = id; x !== undefined; x = parent.get(x)) if (byId.get(x).callFrame.functionName === rootName) return true; return false; };
const inclusive = new Map(), selfBy = new Map();
let rootTotal = 0;
for (const [id, us] of self) {
  if (!underRoot(id)) continue;
  rootTotal += us;
  const seen = new Set();
  for (let x = id; x !== undefined; x = parent.get(x)) {
    const l = label(byId.get(x)); if (!seen.has(l)) { seen.add(l); inclusive.set(l, (inclusive.get(l) ?? 0) + us); }
  }
  const l = label(byId.get(id)); selfBy.set(l, (selfBy.get(l) ?? 0) + us);
}
const ms = (us) => (us / 1000).toFixed(1).padStart(9);
console.log(`profile ${total / 1e6 | 0}s sampled; under \`${rootName}\`: ${(rootTotal / 1000).toFixed(0)} ms (${(rootTotal / total * 100).toFixed(1)}% of the run)`);
console.log('\n-- inclusive ms under root --');
for (const [l, us] of [...inclusive].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(ms(us), (us / rootTotal * 100).toFixed(0).padStart(3) + '%', l);
console.log('\n-- self ms under root --');
for (const [l, us] of [...selfBy].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(ms(us), (us / rootTotal * 100).toFixed(0).padStart(3) + '%', l);
