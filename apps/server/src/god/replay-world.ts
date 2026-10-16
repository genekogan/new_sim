// RL6 replay: one in-process god world (no engine, no network, no ports) built from a pinned genesis and this
// source's core library, with a fetch that serves the god routes directly. The CLI under test runs unchanged
// against `REPLAY_ORIGIN`; nothing leaves the process.
import { Hono, type Context } from 'hono';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode, type Genesis } from './god.ts';
import { mountGodRoutes } from './routes.ts';

export const REPLAY_ORIGIN = 'http://replay.invalid';
const OWNER = 'dev:admin';

export type ReplayWorld = { god: GodMode; app: Hono; token: string; fetch: typeof fetch; close: () => void };

/** A fresh world from `genesis` (a genesis/1 file path or object). Time is Date.now: a replay may pace it. */
export function replayWorld(genesis: string | Genesis, opts: { worldId?: string } = {}): ReplayWorld {
  const assets = mkdtempSync(join(tmpdir(), 'god-replay-assets-'));
  let tick = 1;
  const god = new GodMode(new Db(':memory:'), {
    worldId: opts.worldId ?? 'replay-1', ownerId: OWNER, tick: () => tick++, emit: () => {}, assetDir: assets,
    genesis: typeof genesis === 'string' ? JSON.parse(readFileSync(genesis, 'utf8')) as Genesis : genesis,
  });
  const app = new Hono();
  const user = { id: OWNER, role: 'admin' as const, email: null, wallet: null, created_at: 0, last_seen: 0, invited_by: null };
  mountGodRoutes(app, {
    god, worldName: 'Replay',
    requireUser: async (c: Context) => { if (c.req.header('authorization') !== `Bearer ${OWNER}`) throw new ApiError(401, 'unauthorized', 'sign in'); return user; },
    soulFromBearer: () => null, baseOf: () => REPLAY_ORIGIN, limitIp: () => {}, rateLimit: false,
  });
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message, ...err.extra }, err.status as 400) : c.json({ ok: false, code: 'internal', message: String(err) }, 500));
  const token = god.mintFor(user, 'replay');
  const local = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(REPLAY_ORIGIN + '/')) throw new Error(`replay world refuses non-local fetch ${url.slice(0, 80)}`);
    const { signal: _signal, ...rest } = init ?? {};
    return app.request(url.slice(REPLAY_ORIGIN.length), rest);
  }) as typeof fetch;
  return { god, app, token, fetch: local, close: () => rmSync(assets, { recursive: true, force: true }) };
}
