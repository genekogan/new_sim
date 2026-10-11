// Port remap preload: run Codex-era tests that hard-code loopback ports 4930-4969 on a shared laptop where those
// ports belong to the production world writers. Every listen() and every outgoing connect() on 4930-4969 moves to
// PORT_REMAP_BASE + (port - 4930) (default 5400 → 5400-5439); 4970 (the live proxy), 4986 and 4987 are refused
// outright. Load it in the test process and every child:
//   NODE_OPTIONS="--import=/abs/path/tools/test-harness/port-remap.mjs" PORT_REMAP_BASE=5400 node --test ...
// CI (no preload) keeps the original ports. See docs/god/MERGE-GUIDE.md §5.
import net from 'node:net';
import { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

const BASE = Number(process.env.PORT_REMAP_BASE ?? 5400);
if (!Number.isInteger(BASE) || (BASE <= 4987 && BASE + 39 >= 4930)) throw new Error('PORT_REMAP_BASE must keep 4930-4987 clear');
const PROTECTED = new Set([4970, 4986, 4987]);
export function remapPort(port) {
  const p = Number(port);
  if (!Number.isInteger(p)) return port;
  if (PROTECTED.has(p)) throw new Error(`port-remap: refusing protected production port ${p}`);
  if (p >= 4930 && p <= 4969) return BASE + (p - 4930);
  return port;
}
const fixOptions = (o) => (o && typeof o === 'object' && o.port !== undefined && o.port !== null ? { ...o, port: remapPort(o.port) } : o);
const fixFirst = (a) => {
  if (Array.isArray(a[0])) { a[0][0] = fixOptions(a[0][0]); return a; }  // net's normalized [options, cb]
  if (typeof a[0] === 'number' || (typeof a[0] === 'string' && /^\d+$/.test(a[0]))) a[0] = remapPort(a[0]);
  else a[0] = fixOptions(a[0]);
  return a;
};
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...a) { return listen.apply(this, fixFirst(a)); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) { return connect.apply(this, fixFirst(a)); };

// Children: tests often spawn a server with a hand-built env ({PATH, HOME, PORT…}) that drops NODE_OPTIONS. Put the
// preload back into every child's environment, so a child told PORT=4950 binds the remapped port too.
globalThis.__portRemap = BASE;
const preload = process.env.NODE_OPTIONS?.match(/--import=\S*port-remap\.mjs/)?.[0] ?? `--import=${new URL(import.meta.url).pathname}`;
const withPreload = (pairs) => {
  if (!Array.isArray(pairs)) return pairs;
  const i = pairs.findIndex((p) => p.startsWith('NODE_OPTIONS='));
  if (i < 0) pairs.push('NODE_OPTIONS=' + preload); else if (!pairs[i].includes('port-remap.mjs')) pairs[i] += ' ' + preload;
  if (!pairs.some((p) => p.startsWith('PORT_REMAP_BASE='))) pairs.push('PORT_REMAP_BASE=' + BASE);
  return pairs;
};
const cpSpawn = ChildProcess.prototype.spawn;
ChildProcess.prototype.spawn = function (options) { if (options) withPreload(options.envPairs); return cpSpawn.call(this, options); };
const syncBinding = createRequire(import.meta.url)('node:process').binding?.('spawn_sync');
if (syncBinding?.spawn) { const s = syncBinding.spawn; syncBinding.spawn = function (options) { if (options) withPreload(options.envPairs); return s.call(this, options); }; }
