import { useEffect, useRef, useState } from 'react';
import { Connection } from '@sim/client';
import type { BrainCall, CameraLine, LogEvent, Me, NarrativeView, ServerStats, TickerLine } from '@sim/protocol';

declare const __BUILD__: string;

export type Sim = {
  conn: Connection; me: Me | null; log: LogEvent[]; brain: BrainCall[]; camera: CameraLine | null; ticker: TickerLine[];
  narratives: Record<string, NarrativeView>; stats: ServerStats | null; bytesPerSec: number;
};

/** One connection for the page. Re-renders about 5 times a second while the world runs. */
export function useSim(getToken: () => Promise<string | null>, authed: boolean): Sim {
  const tokenRef = useRef(getToken); tokenRef.current = getToken;
  const [, force] = useState(0);
  const s = useRef<Omit<Sim, 'conn'> & { conn: Connection | null; lastBytes: number; lastAt: number }>({ conn: null, me: null, log: [], brain: [], camera: null, ticker: [], narratives: {}, stats: null, bytesPerSec: 0, lastBytes: 0, lastAt: Date.now() });
  if (!s.current.conn) {
    const st = s.current;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    st.conn = new Connection(`${proto}://${location.host}/ws`, () => tokenRef.current(), {
      onWelcome: (me, w) => {
        st.me = me;
        // after a deploy, a page still running the old bundle reloads itself (once)
        if (w.build && w.build !== 'dev' && __BUILD__ !== 'dev' && w.build !== __BUILD__ && sessionStorage.getItem('sim.reloaded') !== w.build) { sessionStorage.setItem('sim.reloaded', w.build); location.reload(); }
      },
      onLog: (ev) => { const seen = new Set(st.log.map((e) => e.seq)); st.log = [...st.log, ...ev.filter((e) => !seen.has(e.seq))].slice(-400); },
      onBrain: (calls) => { const seen = new Set(st.brain.map((c) => c.id)); st.brain = [...st.brain, ...calls.filter((c) => !seen.has(c.id))].slice(-300); },
      onCamera: (l) => { st.camera = l; },
      onTicker: (l) => { st.ticker = [...st.ticker, ...l].slice(-40); },
      onNarrative: (v) => { st.narratives = { ...st.narratives, [v.region]: v }; },
      onStats: (x) => { st.stats = x; },
    }, (u) => new WebSocket(u) as never);
  }
  useEffect(() => {
    const st = s.current; st.conn!.connect();
    const t = setInterval(() => {
      const now = Date.now(), b = st.conn!.stats.bytesIn;
      if (now - st.lastAt >= 2000) { st.bytesPerSec = ((b - st.lastBytes) * 1000) / (now - st.lastAt); st.lastBytes = b; st.lastAt = now; }
      force((n) => n + 1);
    }, 200);
    return () => { clearInterval(t); st.conn!.close(); };
  }, []);
  // signing in or out: reconnect so the server re-reads who we are
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } s.current.conn!.rehello(); }, [authed]);
  return s.current as Sim;
}

export function makeApi(getToken: () => Promise<string | null>) {
  return async function api<T = any>(path: string, body?: unknown, method?: string): Promise<{ status: number; data: T }> {
    const token = await getToken();
    const r = await fetch(path, { method: method ?? (body !== undefined ? 'POST' : 'GET'), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
}
export type Api = ReturnType<typeof makeApi>;
