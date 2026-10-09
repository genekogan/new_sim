import http from 'node:http';
import https from 'node:https';

// Fault injection for disposable test worlds. Never log request headers/bodies.
// Control is an in-process handle, not an unauthenticated public admin endpoint.
export async function startFaultProxy({ target, port = 0, onObservation = () => {} }) {
  const upstream = new URL(target);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) throw new Error('Plain HTTP(S) target required');
  let fault = 'none';
  const sockets = new Set();
  const requests = new Set();
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://proxy.invalid').pathname;
    const isStream = pathname.endsWith('/v1/edge/events');
    if (isStream && fault === 'no-hello') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' });
      res.flushHeaders();
      onObservation({ kind: 'fault', fault, at: Date.now() });
      // Leave the connection alive with zero frames. The client's watchdog acts.
      return;
    }
    const headers = { ...req.headers, host: upstream.host };
    const transport = upstream.protocol === 'https:' ? https : http;
    const incomingURL = new URL(req.url, 'http://proxy.invalid');
    const url = new URL(upstream.origin);
    url.pathname = upstream.pathname.replace(/\/$/, '') + incomingURL.pathname;
    url.search = incomingURL.search;
    const outgoing = transport.request(url, { method: req.method, headers }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers);
      if (isStream && fault === 'stall-after-hello') {
        let deliveredHello = false;
        let buffer = '';
        incoming.setEncoding('utf8');
        incoming.on('data', chunk => {
          if (deliveredHello) return;
          buffer += chunk;
          if (buffer.length > 65536) { outgoing.destroy(); res.destroy(); return; }
          let separator;
          while ((separator = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, separator + 2);
            buffer = buffer.slice(separator + 2);
            res.write(frame);
            if (/^event:\s*hello\s*$/m.test(frame)) {
              deliveredHello = true;
              onObservation({ kind: 'fault', fault, at: Date.now() });
              break;
            }
          }
        });
        incoming.on('end', () => res.end());
      } else incoming.pipe(res);
    });
    requests.add(outgoing);
    outgoing.on('close', () => requests.delete(outgoing));
    outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => outgoing.destroy());
    req.pipe(outgoing);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    setFault(value) {
      if (!['none', 'no-hello', 'stall-after-hello'].includes(value)) throw new Error('Unsupported fault');
      fault = value;
    },
    async close() {
      for (const request of requests) request.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
