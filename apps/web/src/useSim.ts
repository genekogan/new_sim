import { apiPath, worldPath } from './world-path.ts';
import { useEffect, useRef, useState } from 'react';
import { Connection } from '@sim/client';
import type { BrainCall, CameraLine, KernelView, LogEvent, Me, NarrativeView, PlayView, ServerStats, TalkLine, TickerLine } from '@sim/protocol';

declare const __BUILD__: string;

export type Sim = {
  conn: Connection; me: Me | null; log: LogEvent[]; brain: BrainCall[]; camera: CameraLine | null; ticker: TickerLine[];
  narratives: Record<string, NarrativeView>; stats: ServerStats | null; bytesPerSec: number;
  /** The meaning layer: things, links, vocabulary, decks (public). */
  kernel: KernelView | null; plays: PlayView[]; talk: TalkLine[];
};

/** One connection for the page. Re-renders about 5 times a second while the world runs. */
export function useSim(getToken: () => Promise<string | null>, authed: boolean): Sim {
  const tokenRef = useRef(getToken); tokenRef.current = getToken;
  const [, force] = useState(0);
  const s = useRef<Omit<Sim, 'conn'> & { conn: Connection | null; lastBytes: number; lastAt: number }>({ conn: null, me: null, log: [], brain: [], camera: null, ticker: [], narratives: {}, stats: null, bytesPerSec: 0, kernel: null, plays: [], talk: [], lastBytes: 0, lastAt: Date.now() });
  if (!s.current.conn) {
    const st = s.current;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    st.conn = new Connection(`${proto}://${location.host}${worldPath}/ws`, () => tokenRef.current(), {
      onWelcome: (me, w) => {
        st.me = me;
        // after a deploy, a page still running the old bundle reloads itself (once)
        if (w.build && w.build !== 'dev' && __BUILD__ !== 'dev' && w.build !== __BUILD__ && sessionStorage.getItem('sim.reloaded') !== w.build) { sessionStorage.setItem('sim.reloaded', w.build); location.reload(); }
      },
      onLog: (ev) => { const seen = new Set(st.log.map((e) => e.seq)); st.log = [...st.log, ...ev.filter((e) => !seen.has(e.seq))].slice(-400); },
      onBrain: (calls) => { const seen = new Set(st.brain.map((c) => c.id)); st.brain = [...st.brain, ...calls.filter((c) => !seen.has(c.id))].slice(-300); },
      onCamera: (l) => { st.camera = l; },
      onTicker: (l) => { const seen = new Set(st.ticker.map((x) => `${x.tick}:${x.text}`)); st.ticker = [...st.ticker, ...l.filter((x) => !seen.has(`${x.tick}:${x.text}`))].slice(-40); },
      onNarrative: (v) => { st.narratives = { ...st.narratives, [v.region]: v }; },
      onStats: (x) => { st.stats = x; },
      onKernel: (v) => { st.kernel = v; },
      onPlays: (p) => { const seen = new Set(st.plays.map((x) => x.seq)); st.plays = [...st.plays, ...p.filter((x) => !seen.has(x.seq))].slice(-300); },
      onTalk: (l) => { const seen = new Set(st.talk.map((x) => x.id)); st.talk = [...st.talk, ...l.filter((x) => !seen.has(x.id))].slice(-300); },
    }, (u) => new WebSocket(u) as never);
  }
  useEffect(() => {
    const st = s.current; st.conn!.connect();
    // what happened before this page opened (all public)
    const get = (path: string) => fetch(apiPath(path)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    void get('/v1/kernel').then((v) => { if (v && !st.kernel) st.kernel = v; });
    void get('/v1/plays?limit=200').then((v) => { if (v?.plays) { const seen = new Set(st.plays.map((x) => x.seq)); st.plays = [...(v.plays as PlayView[]).filter((x) => !seen.has(x.seq)), ...st.plays].slice(-300); } });
    void get('/v1/talk?limit=120').then((v) => { if (v?.lines) { const seen = new Set(st.talk.map((x) => x.id)); st.talk = [...(v.lines as TalkLine[]).filter((x) => !seen.has(x.id)).sort((a, b) => a.id - b.id), ...st.talk].slice(-300); } });
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
    try {
      const token = await getToken();
      const r = await fetch(apiPath(path), { method: method ?? (body !== undefined ? 'POST' : 'GET'), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const text = await r.text(); let data: any; try { data = JSON.parse(text); } catch { data = r.ok ? text : { message: `the server answered ${r.status}` }; }
      return { status: r.status, data };
    } catch { return { status: 0, data: { message: 'could not reach the server; try again' } as any }; }
  };
}
export type Api = ReturnType<typeof makeApi>;
