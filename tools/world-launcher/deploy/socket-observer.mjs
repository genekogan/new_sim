// Browser-only diagnostic observer shared by release and CDN walks. No message payloads are retained.
export function recordWorldSockets() {
  const W = window.WebSocket, log = (window.__z1ws = []);
  const Z = function (url, protocols) {
    const ws = protocols === undefined ? new W(url) : new W(url, protocols);
    let observed; try { observed = new URL(String(url), window.location?.href); } catch { return ws; }
    if (!/\/ws$/.test(observed.pathname)) return ws;
    const urlHello = observed.searchParams.has('hello');
    // The presence of early hello matters; its fields and all other query values do not belong in a receipt.
    const rec = { url: observed.origin + observed.pathname + (urlHello ? '?hello=present' : ''), urlHello, made: Date.now(), open: null, first: null, last: null, close: null, code: null, reason: null, sent: [] };
    log.push(rec);
    // Diagnostic metadata only: never retain payloads, credentials, or hello fields.
    const send = ws.send.bind(ws);
    ws.send = function (data) {
      let type = 'other';
      if (typeof data === 'string' && data.length < 8192) try { const t = JSON.parse(data)?.t; if (['hello', 'ping', 'resync'].includes(t)) type = t; } catch {}
      rec.sent.push({ at: Date.now(), type }); if (rec.sent.length > 50) rec.sent.shift();
      return send(data);
    };
    ws.addEventListener('open', () => { rec.open = Date.now(); });
    ws.addEventListener('message', (e) => {
      const n = Date.now(); rec.first ??= n; rec.last = n;
      if (rec.build === undefined && typeof e.data === 'string' && e.data.startsWith('{"t":"welcome"')) rec.build = e.data.match(/"build":"([^"]*)"/)?.[1] ?? null;
    });
    ws.addEventListener('close', (e) => { rec.close = Date.now(); rec.code = e.code; rec.reason = e.reason; });
    return ws;
  };
  Z.prototype = W.prototype; Object.assign(Z, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Z;
  // main-thread stalls: a 100 ms timer that fired more than 1 s late
  if (window === window.top) { const st = (window.__z1stalls = []); let last = Date.now(); setInterval(() => { const n = Date.now(); if (n - last > 1000) st.push([last, n]); last = n; }, 100); }
}
