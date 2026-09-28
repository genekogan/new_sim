import { DurableObject } from 'cloudflare:workers';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { modelForYear } from './model';
import {
  riderPose,
  cameraPose,
  screenIds,
  motionPose,
  simTime,
  hourAt,
  type SimState,
} from './shared';
import { definitions } from './commands';
import { EngineRoom } from './engine-room';
import { campusYearFile } from './campus-years';
import { registerEngineTools } from './engine-tools';

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
const limits = [
  'Generic visitors and EUCs are illustrative, not historical inventory.',
  'Walking uses conservative ground-level routes within ±60 m of Chiba; indoor/stair navigation is not mapped.',
  'Remote simulation uses the baseline replica, not local geometry edits.',
  'One campfire at the designated clearing. Camera commands require viewer opt-in.',
];
export class MarsSimulation extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)',
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)',
    );
    const columns = ctx.storage.sql
      .exec<{ name: string }>('PRAGMA table_info(commands)')
      .toArray();
    if (!columns.some((c) => c.name === 'fingerprint'))
      ctx.storage.sql.exec('ALTER TABLE commands ADD COLUMN fingerprint TEXT');
  }
  private cached: SimState | null = null;
  private engineRoom: EngineRoom | null = null;
  /** Engine controller ops (preview): same op registry as engine/api; state lives in engine_blobs. */
  engineCall(op: string, args: unknown, year = 2026) {
    this.selectYear(year);
    this.engineRoom ??= new EngineRoom(this.ctx.storage, {}, campusYearFile);
    return this.engineRoom.call(year, op, args);
  }
  private year = 2026;
  private get model() { return modelForYear(this.year); }
  private selectYear(year: number) {
    modelForYear(year);
    if (year !== this.year) { this.cached = null; this.year = year; }
  }
  private read(): SimState {
    if (this.cached) return this.cached;
    const rows = this.ctx.storage.sql
      .exec<{ payload: string }>('SELECT payload FROM state WHERE id=1')
      .toArray();
    if (rows[0])
      return (this.cached = this.model.normalizeState(
        JSON.parse(rows[0].payload),
        Date.now(),
      ));
    const s = this.model.initialState(Date.now());
    this.save(s);
    return (this.cached = s);
  }
  private save(s: SimState) {
    this.ctx.storage.sql.exec(
      'INSERT INTO state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      JSON.stringify(s),
    );
  }
  snapshot(revision?: number, year = 2026) {
    this.selectYear(year);
    const {entities,riderPath,firePosition} = this.model;
    const now = Date.now(),
      state = this.read();
    if (revision === state.revision) return { unchanged: true, now, revision };
    return {
      state,
      now,
      year,
      catalog: entities,
      eucRiders: state.euc.enabled
        ? Array.from({ length: state.euc.count }, (_, i) => ({
            id: `euc-${i + 1}`,
            ...riderPose(state, now, riderPath, i),
            action: state.riders?.[`euc-${i + 1}`]?.action ?? 'circle',
          }))
        : [],
      firePosition,
      cameraPose: cameraPose(state, now),
      units: 'metres; Y up; ground=-0.16',
      limitations: limits,
      poses: Object.fromEntries(
        Object.entries(state.people).map(([id, m]) => [
          id,
          motionPose(m, simTime(state, now)),
        ]),
      ),
      hour: hourAt(state, now),
    };
  }
  apply(name: string, args: unknown, id: string, year = 2026) {
    this.selectYear(year);
    const def = Object.hasOwn(definitions, name)
      ? definitions[name as keyof typeof definitions]
      : undefined;
    if (!def) throw Error('Unknown command');
    const parsed = def.schema.parse(args);
    this.ctx.storage.transactionSync(() => {
      const fingerprint = JSON.stringify([name, parsed]);
      const receipt = this.ctx.storage.sql
        .exec<{ fingerprint: string | null }>(
          'SELECT fingerprint FROM commands WHERE id=?',
          id,
        )
        .toArray()[0];
      if (receipt) {
        if (receipt.fingerprint && receipt.fingerprint !== fingerprint)
          throw Error('Command ID already used with different arguments');
        return;
      }
      const s = this.model.command(this.read(), name, parsed, Date.now());
      this.save(s);
      this.ctx.storage.sql.exec(
        'INSERT INTO commands (id,revision,fingerprint) VALUES (?, ?, ?)',
        id,
        s.revision,
        fingerprint,
      );
      this.ctx.storage.sql.exec(
        'DELETE FROM commands WHERE revision < ?',
        s.revision - 255,
      );
    });
    this.cached = null;
    return this.snapshot(undefined, year);
  }
}
async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
}
export async function handleSimulation(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/mcp' && !url.pathname.startsWith('/api/simulation/'))
    return null;
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin)
    return json({ error: 'Origin not allowed' }, 403);
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: { Allow: 'GET, POST, OPTIONS' },
    });
  const bearer = request.headers
    .get('Authorization')
    ?.match(/^Bearer ([a-f0-9]{64})\.([a-f0-9]{64})$/);
  if (!bearer)
    return json(
      {
        error:
          'Room capability required. Create a room in /studio → Simulation & MCP.',
      },
      401,
    );
  const [, room, key] = bearer,
    viewHash = await hash(key),
    control = (await hash(viewHash)) === room,
    readOnly = viewHash === room;
  if (!control && !readOnly)
    return json({ error: 'Invalid room capability' }, 403);
  if (
    (url.pathname === '/api/simulation/state' && request.method !== 'GET') ||
    (url.pathname === '/api/simulation/command' && request.method !== 'POST')
  )
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: url.pathname.endsWith('/state') ? 'GET' : 'POST' },
    });
  const year = Number(url.searchParams.get('year') ?? 2026);
  if (!Number.isInteger(year) || year < 2020 || year > 2026) return json({error:'Invalid campus year'},400);
  const {entities,riderDocks,firePosition,catalog} = modelForYear(year);
  const stub = env.SIMULATIONS.get(env.SIMULATIONS.idFromName(year === 2026 ? room : `${year}:${room}`));
  try {
    if (request.method === 'POST') {
      if (Number(request.headers.get('Content-Length') || 0) > 32768)
        return json({ error: 'Request too large' }, 413);
      // Bound chunked bodies too; never log capability tokens or request bodies.
      const reader = request.body?.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 32768) {
            await reader.cancel();
            return json({ error: 'Request too large' }, 413);
          }
          chunks.push(value);
        }
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      request = new Request(request, { method: 'POST', body });
    }
    if (url.pathname === '/api/simulation/state' && request.method === 'GET')
      return json(
        await stub.snapshot(
          url.searchParams.has('revision')
            ? Number(url.searchParams.get('revision'))
            : undefined,
          year,
        ),
      );
    if (
      url.pathname === '/api/simulation/command' &&
      request.method === 'POST'
    ) {
      if (!control)
        return json({ error: 'This is a view-only capability' }, 403);
      const input = z
        .object({
          name: z.string().max(60),
          args: z.unknown(),
          id: z.uuid(),
        })
        .parse(await request.json());
      return json(await stub.apply(input.name, input.args, input.id, year));
    }
    if (url.pathname === '/api/simulation/engine/take') {
      // Viewer-facing compact take fetch (read-only capabilities allowed).
      if (request.method !== 'GET')
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
      const q = url.searchParams;
      const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
      // RPC typing can't express the open-ended JSON result; it is plain JSON (OpResult).
      const r = await (stub.engineCall('get_take', {
        take_id: q.get('id') ?? '',
        from: num('from'),
        to: num('to'),
        ...(q.has('entities') ? { entities: q.get('entities')!.split(',') } : {}),
        ...(q.has('include') ? { include: q.get('include')!.split(',') } : {}),
      }, year) as unknown as Promise<{ ok: boolean; code?: string }>);
      return json(r, r.ok ? 200 : r.code === 'take.unknown' ? 404 : 400);
    }
    if (url.pathname === '/mcp') {
      if (!control)
        return json({ error: 'MCP requires the control capability' }, 403);
      const handler = createMcpHandler(
        () => {
          const server = new McpServer({
            name: 'mars-campus-simulation',
            version: '2.0.0',
          });
          server.registerTool(
            'get_state',
            {
              description:
                'Inspect room state, current positions, person IDs, walking capabilities, units and limitations.',
              inputSchema: z.object({}),
              annotations: { readOnlyHint: true },
            },
            async () => ({
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(await stub.snapshot(undefined, year)),
                },
              ],
            }),
          );
          server.registerTool(
            'get_capabilities',
            {
              description:
                'Discover all tools, full JSON schemas, stable entity/screen/rider IDs, landmarks, units, clock semantics and limitations. Call this before composing scene commands.',
              inputSchema: z.object({}),
              annotations: { readOnlyHint: true },
            },
            async () => ({
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    version: 2,
                    year,
                    units: 'metres; Y up; ground=-0.16',
                    people: entities,
                    riders: Array.from({ length: 6 }, (_, i) => ({
                      id: `euc-${i + 1}`,
                      dock: riderDocks[i],
                    })),
                    screens: screenIds,
                    landmarks: {
                      chiba: year === 2026 ? [0, 2, 8] : year === 2022 ? [-4.8288, 2, -8.6] : year === 2020 ? [-9,2,0] : [0, 2, 0],
                      hallProjector: year === 2026 ? [6.02, 2.65, 8.31] : year === 2022 ? [-4.8288, 1.65, -6.244] : year === 2020 ? [-9,1.3,0] : [0, 2.55, year === 2023 ? 4.17 : 5.37],
                      campfire: firePosition,
                      campusBounds: catalog.bounds,
                    },
                    weatherPresets: [
                      'clear',
                      'cloudy',
                      'rainy',
                      'windy',
                      'dusty',
                    ],
                    clock:
                      'All durations are virtual seconds. Default rate=1 and day_seconds=480. Paused state persists; commands do not resume it. Camera trajectory duration covers the entire path.',
                    limitations: [
                      ...limits,
                      'Weather and gallery art are illustrative. Screen locations are photo-informed estimates. No collision prevention for camera paths except ground clearance.',
                      'EUC dismount is a static standing pose beside the parked wheel, not a motion-captured transition.',
                      'Viewer Follow remote camera must be enabled. Spectators cannot edit state.',
                    ],
                    tools: Object.fromEntries(
                      Object.entries(definitions).map(([name, def]) => [
                        name,
                        {
                          description: def.description,
                          schema: z.toJSONSchema(def.schema),
                        },
                      ]),
                    ),
                  }),
                },
              ],
            }),
          );
          for (const [name, def] of Object.entries(definitions))
            server.registerTool(
              name,
              { description: def.description, inputSchema: def.schema },
              async (args: unknown) => {
                try {
                  return {
                    content: [
                      {
                        type: 'text' as const,
                        text: JSON.stringify(
                          await stub.apply(name, args, crypto.randomUUID(), year),
                        ),
                      },
                    ],
                  };
                } catch (e) {
                  return {
                    isError: true,
                    content: [
                      {
                        type: 'text' as const,
                        text: e instanceof Error ? e.message : 'Command failed',
                      },
                    ],
                  };
                }
              },
            );
          registerEngineTools(server, async (op, args) => await (stub.engineCall(op, args, year) as unknown as Promise<{ ok: boolean }>));
          return server;
        },
        {
          maxSubscriptions: 0,
          keepAliveMs: 0,
        },
      );
      return handler.fetch(request);
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Invalid command' },
      400,
    );
  }
}
const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return (
      (await handleSimulation(request, env, ctx)) ||
      json({ error: 'Not found' }, 404)
    );
  },
};

export default worker;
