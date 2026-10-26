// observer/world-truth.mjs — what the world says is true about a Soul, from server routes only (DESIGN §4.2).
//
// Routes and the JSON shapes they returned on a dev world (2026-10-24, SOUL3 integration server; fixtures/ holds copies):
//  GET <base>/v1/edge/public/souls/<soulId>   (no auth)
//    {contract, soul:{soulId,name,description,untrusted}, fade:{colour,idleSeconds}, lastAcceptedAt:ms,
//     self:{placePath:[{id,name,kind}], state:"standing"|..., activity:"idle"|...},
//     receipts:[{id,soulId,capability,phase,acceptedTick,startedTick,endedTick,code,reason,
//                endedAt:{place,placePath:[names],pos:[x,z],heading,posture}}], events:[...]}
//  GET <base>/v1/souls/<soulId>               (Bearer dev:<owner identity>; dev:admin also reads any Soul on a dev world)
//    {status:{id,name,tick,time,in_world,position:{x,z,region},activity,doing,mood,energy,needs:{energy,hunger,company,
//     restlessness},intent,intent_text,agenda,recent:[...],nearby:[{id,who,what,distance,doing}],available_now:[{id,label}],...},
//     agent:{attached,label,since,last_used}, spend, created_at}
//  GET <base>/v1/edge/owner/<soulId>/inbox    (Bearer dev:<owner identity>)
//    {inbox:{connected,lastSeenAt,listenedAt,presence:"listening"|"working"|"away",queued,
//     latest:{id,text,state:'sent'|'delivered'|'acknowledged',sentAt,deliveredAt?,acknowledgedAt?,reply?(the ack),
//             outcome?:'done'|'failed'|'withdrawn',result?,resultAt?}}}   (server inbox.ts InboxMessage)
//  GET <base>/v1/world                        (no auth)
//    {world,tick,time,size_m,regions:[{id,label}],places:[{id,label,x,z}],gatherings:[],
//     souls:[{id:"h_<hex>",name,about,doing,mood,region}]}       (soul s_<hex> ↔ entity h_<hex>)
//  GET <base>/healthz  {ok,tick,clients,paused,build,worldId,tickMs:{avg,max,n},clockRate}
//  GET <base>/v1/edge/receipts/<id> needs a Soul token (401 for dev users), so receipt() reads the public receipts list.
//
// God geometry: GET /v1/god/snapshot refuses dev:admin (needs a god token); GET /v1/god/status accepts it but has no
// geometry. godSlice() therefore runs the world's served god CLI (<base>/god/eden-god.mjs) from an observer-owned folder
// paired with `register <base> dev:admin` + `mint` (mint ADDS a token, it does not revoke the god seat's). It uses
// `where <x,z> --json` (inside[] with layer, near[] with dist) and `describe <path> --json` (layer, box, aabb, slots).
// The observer never reads the folder's .eden-god.json; only the CLI does.
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { now } from '../lib/clock.mjs';
import { run } from '../lib/proc.mjs';

const trim = (b) => String(b).replace(/\/+$/, '');
const authH = (who) => (who ? { authorization: `Bearer dev:${who}` } : {});

/** GET JSON; never throws. → {status, body, ms, bytes, error?} */
export async function getJson(url, { headers = {}, timeoutMs = 8000 } = {}) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let body = null; try { body = JSON.parse(text); } catch { body = { _text: text.slice(0, 500) }; }
    return { status: r.status, body, ms: Math.round(performance.now() - t0), bytes: text.length };
  } catch (e) { return { status: 0, body: null, ms: Math.round(performance.now() - t0), bytes: 0, error: String(e?.message ?? e) }; }
}

export const entityOf = (soulId) => 'h_' + String(soulId).replace(/^s_/, '');

/** Pure projection of the four bodies into the snapshot shape (tested on fixtures). */
export function projectSoul({ soulId, pub, owner, inbox, world, clock = now() }) {
  const st = owner?.status ?? null, self = pub?.self ?? {}, receipts = Array.isArray(pub?.receipts) ? pub.receipts : [];
  const last = receipts[0] ?? null; // the public list is newest first
  const endPos = last?.endedAt?.pos;
  const pos = st?.position ? { x: st.position.x, z: st.position.z, region: st.position.region ?? null, src: 'owner' }
    : Array.isArray(endPos) ? { x: endPos[0], z: endPos[1], region: null, src: 'lastReceipt' } : null;
  const ib = inbox?.inbox ?? null;
  const ws = (world?.souls ?? []).find((s) => s.id === entityOf(soulId)) ?? null;
  return {
    t: clock.t, mono: clock.mono, soulId, name: pub?.soul?.name ?? st?.name ?? ws?.name ?? null,
    tick: st?.tick ?? world?.tick ?? null,
    place: self.placePath?.[0]?.id ?? last?.endedAt?.place ?? null,
    placePath: (self.placePath ?? []).map((p) => p.name ?? p.id),
    pos, posture: self.state ?? last?.endedAt?.posture ?? null,
    activity: self.activity ?? st?.activity ?? null, doing: st?.doing ?? ws?.doing ?? null,
    mood: st?.mood ?? ws?.mood ?? null, needs: st?.needs ?? null,
    near: (st?.nearby ?? []).map((n) => ({ id: n.id, who: n.who, distance: n.distance, doing: n.doing || null })),
    holding: self.holding ?? st?.holding ?? null, following: self.following ?? st?.following ?? null,
    riding: self.riding ?? st?.riding ?? null,
    fade: pub?.fade ?? null, lastAcceptedAt: pub?.lastAcceptedAt ?? null,
    lastReceipt: last, receipts: receipts.slice(0, 5),
    agent: owner?.agent ? { attached: owner.agent.attached, label: owner.agent.label, lastUsed: owner.agent.last_used } : null,
    inbox: ib ? { presence: ib.presence ?? null, connected: ib.connected ?? null, queued: ib.queued ?? 0, latest: ib.latest ?? null } : null,
    world: { tick: world?.tick ?? null, souls: (world?.souls ?? []).map((s) => ({ id: s.id, name: s.name, doing: s.doing, region: s.region })) },
  };
}

/** snapshotSoul({base, soulId, identity?, admin?, keepRaw?}) → projection (+ `raw` bodies when keepRaw, + `http` codes).
 *  identity = the owner's dev identity ("agent-…"); admin:true reads owner status as dev:admin when no identity. */
export async function snapshotSoul({ base, soulId, identity = null, admin = false, keepRaw = false }) {
  base = trim(base);
  const who = identity ?? (admin ? 'admin' : null);
  const [p, o, i, w] = await Promise.all([
    getJson(`${base}/v1/edge/public/souls/${encodeURIComponent(soulId)}`),
    who ? getJson(`${base}/v1/souls/${encodeURIComponent(soulId)}`, { headers: authH(who) }) : null,
    identity ? getJson(`${base}/v1/edge/owner/${encodeURIComponent(soulId)}/inbox`, { headers: authH(identity) }) : null,
    getJson(`${base}/v1/world`),
  ]);
  const ok = (r) => (r && r.status === 200 ? r.body : null);
  const snap = projectSoul({ soulId, pub: ok(p), owner: ok(o), inbox: ok(i), world: ok(w) });
  snap.http = { public: p.status, owner: o?.status ?? null, inbox: i?.status ?? null, world: w.status, ms: Math.max(p.ms, o?.ms ?? 0, i?.ms ?? 0, w.ms) };
  if (keepRaw) snap.raw = { public: p.body, owner: o?.body ?? null, inbox: i?.body ?? null, world: w.body };
  return snap;
}

/** receipt({base, id, soulId}) → the receipt from the public Soul record (the receipt route needs a Soul token). */
export async function receipt({ base, id, soulId }) {
  const r = await getJson(`${trim(base)}/v1/edge/public/souls/${encodeURIComponent(soulId)}`);
  return { source: 'public-soul', receipt: (r.body?.receipts ?? []).find((x) => x.id === id) ?? null, status: r.status };
}

export async function healthz(base) { const r = await getJson(`${trim(base)}/healthz`); return { ...(r.body ?? {}), status: r.status, ms: r.ms }; }

/** serverWindow({log, fromMono, toMono, runStartMs?}) → lines of the world log in the window.
 *  Lines are matched by a leading/embedded ISO time or a JSON `t`/`time`/`ts` field; mono→wall via runStartMs
 *  (epoch ms of mono 0). Lines without a time stay with the previous timed line. */
export function serverWindow({ log, fromMono, toMono, runStartMs = null, maxLines = 2000 }) {
  if (!existsSync(log)) return { lines: [], note: 'no log' };
  const text = readFileSync(log, 'utf8'), out = [];
  const lo = runStartMs != null ? runStartMs + fromMono : -Infinity, hi = runStartMs != null ? runStartMs + toMono : Infinity;
  let inside = runStartMs == null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const ms = lineTime(line);
    if (ms != null) inside = ms >= lo && ms <= hi;
    if (inside) { out.push(line); if (out.length >= maxLines) break; }
  }
  return { lines: out, errors: out.filter((l) => /\b(error|ERR|exception|unhandled|5\d\d)\b/i.test(l)).length };
}
function lineTime(line) {
  if (line[0] === '{') { try { const j = JSON.parse(line); const v = j.t ?? j.time ?? j.ts; const ms = typeof v === 'number' ? v : Date.parse(v); if (Number.isFinite(ms)) return ms; } catch { /* not json */ } }
  const m = line.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/); return m ? Date.parse(m[0]) : null;
}

// ---------- god geometry ----------

/** Pure: combine `where` + `describe`s into the slice. Souls (core/humanoid) are kept but flagged. */
export function projectGodSlice({ around, radius, where, describes }) {
  const isSoul = (def) => /humanoid/.test(def ?? '');
  const entities = (where?.near ?? []).filter((n) => n.dist <= radius).map((n) => {
    const d = describes?.[n.path] ?? null;
    return { path: n.path, id: d?.id ?? null, def: n.def, dist: n.dist, dir: n.dir, soul: isSoul(n.def),
      layer: d?.layer ?? null, pose: d?.pose ?? null, box: d?.box ?? null,
      footprint: d?.aabb ? { minX: d.aabb[0], minZ: d.aabb[1], maxX: d.aabb[2], maxZ: d.aabb[3] } : null,
      slots: (d?.slots ?? []).map((s) => ({ id: s.id, kind: s.kind, p: s.p, used: s.used, capacity: s.capacity })) };
  });
  const inside = (where?.inside ?? []).map((x) => ({ path: x.path, def: x.def, layer: x.layer, soul: isSoul(x.def) }));
  return { around, radius, ground: where ? { y: where.y, slopeDeg: where.slopeDeg, water: where.water, medium: where.medium, room: where.room ?? null } : null,
    inside, insideSolid: inside.filter((x) => x.layer === 'solid' && !x.soul), entities,
    footprints: entities.some((e) => e.footprint) };
}

/** Prepare (once) an observer god folder: download the served CLI, register as dev:admin, mint. → dir or null. */
export async function ensureGodDir({ base, dir }) {
  base = trim(base); mkdirSync(dir, { recursive: true });
  const cli = join(dir, 'eden-god.mjs'), marker = join(dir, '.observer-ready');
  if (existsSync(marker)) return dir;
  const r = await fetch(`${base}/god/eden-god.mjs`).catch(() => null);
  const src = r?.ok ? await r.text() : '';
  if (!src.startsWith('#!') && !src.includes('import')) return null;
  writeFileSync(cli, src);
  const reg = await run('node', [cli, 'register', base, 'dev:admin'], { cwd: dir, maxWallMs: 30000 });
  if (reg.code !== 0) return null;
  const mint = await run('node', [cli, 'mint'], { cwd: dir, maxWallMs: 30000 });
  if (mint.code !== 0) return null;
  writeFileSync(marker, new Date().toISOString() + '\n');
  return dir;
}

async function godJson(dir, args) {
  const r = await run('node', [join(dir, 'eden-god.mjs'), ...args, '--json'], { cwd: dir, maxWallMs: 30000 });
  try { return JSON.parse(r.stdout); } catch { return null; }
}

/** godSlice({base, godDir, around:[x,z], radius}) → slice | null (null ⇒ the inside-solid oracle says unknown).
 *  godDir: an observer-owned folder (created/paired on first use on a dev world); never a seat's folder. */
export async function godSlice({ base, godDir, around, radius = 10 }) {
  if (!godDir || !Array.isArray(around)) return null;
  const dir = await ensureGodDir({ base, dir: godDir });
  if (!dir) return null;
  const t0 = performance.now(), clock = now();
  const where = await godJson(dir, ['where', `${around[0]},${around[1]}`]);
  if (!where) return null;
  const paths = [...new Set((where.near ?? []).filter((n) => n.dist <= radius).map((n) => n.path))].slice(0, 12);
  const describes = Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await godJson(dir, ['describe', p])])));
  return { t: clock.t, mono: clock.mono, ms: Math.round(performance.now() - t0), ...projectGodSlice({ around, radius, where, describes }) };
}
