// eden2 port map preload (lane CLOUD2). The old-world servers and proxy hard-code the laptop's loopback ports
// (worlds 4950/4963/4964, proxy 4970, /worlds 5340). On eden2 those belong to nobody, but the agreed range is
// 4660-4679, so every listen() and outgoing connect() on a mapped port moves:  SIM_PORT_MAP="4950:4660,4963:4661,..."
// Sealed server/proxy code stays byte-identical to the laptop release. Pattern: tools/test-harness/port-remap.mjs.
import net from 'node:net';
const map = new Map((process.env.SIM_PORT_MAP ?? '').split(',').filter(Boolean).map((p) => p.split(':').map(Number)));
if ([...map].some(([a, b]) => !Number.isInteger(a) || !Number.isInteger(b))) throw new Error('SIM_PORT_MAP invalid');
const remap = (port) => { const p = Number(port); return Number.isInteger(p) && map.has(p) ? map.get(p) : port; };
const fixOptions = (o) => (o && typeof o === 'object' && o.port !== undefined && o.port !== null ? { ...o, port: remap(o.port) } : o);
const fixFirst = (a) => {
  if (Array.isArray(a[0])) { a[0][0] = fixOptions(a[0][0]); return a; }
  if (typeof a[0] === 'number' || (typeof a[0] === 'string' && /^\d+$/.test(a[0]))) a[0] = remap(a[0]);
  else a[0] = fixOptions(a[0]);
  return a;
};
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...a) { return listen.apply(this, fixFirst(a)); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) { return connect.apply(this, fixFirst(a)); };
