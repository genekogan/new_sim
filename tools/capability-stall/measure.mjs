// Reproducible measurement of the edge-ledger capability stall on a REAL main.ts server (fake minds, ordinary 20 Hz clock).
//
//   node tools/capability-stall/measure.mjs --tag before --reps 3            # eden-district, 1 ordinary Soul: cold/warm list, sit, walk, hang-out
//   ... --near-church 2        # two churches (rooms on several floors) and a gazebo beside the Soul: the godmode W4b-like world
//   ... --extra 60             # + 60 houses (a built-up world, ~1600 entities)
//   ... --cpu-prof             # + V8 CPU profile of the server (node tools/capability-stall/profile.mjs <file> binds)
//   ... --souls 8 --load 60     # 8 Souls polling capabilities every 4 s and acting every ~16 s for 60 s
//   ... --edit-tax 4            # the first listing after each of 4 god edits
//   ... --dump-caps             # write the full offered list to <tag>-caps.json (diff two checkouts: identical lists = same behaviour)
//   ... --no-god --world-key mars   # a base world (no entity bridge): not affected
//   ... --root ../other-checkout    # the same harness against another checkout (A/B)
//
// Output (default .lane/capstall/): <tag>-events.jsonl (raw preload records), <tag>-summary.json, <tag>.cpuprofile.
// Ports: 5380-5389 only (--port). Never point this at a port that serves a live world.
import {spawn} from 'node:child_process';
import {mkdtempSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';

const arg = (name, d) => { const i = process.argv.indexOf('--' + name); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]); };
const tag = arg('tag', 'run'), port = Number(arg('port', 5380)), extra = Number(arg('extra', 0)), reps = Number(arg('reps', 4));
const soulCount = Number(arg('souls', 1)), loadSeconds = Number(arg('load', 0)), idleMs = Number(arg('idle', 3200)), w4b = !!arg('w4b', false), nearChurch = Number(arg('near-church', 0)), noGod = !!arg('no-god', false);
const root = resolve(arg('root', process.cwd()));          // the source tree the server runs from (--root <worktree> measures another checkout)
const genesis = resolve(root, arg('genesis', 'worlds/templates/eden-district.json')), outDir = resolve(arg('out', '.lane/capstall'));
const worldKey = arg('world-key', 'capstall');   // a base world (mars, eden, littlemartians) has no god / entity bridge: use --no-god
if (port < 5380 || port > 5389) throw new Error('use ports 5380-5389');
mkdirSync(outDir, {recursive: true});
const data = mkdtempSync(join(tmpdir(), 'capstall-')), base = `http://127.0.0.1:${port}/w/${worldKey}`;
const eventsFile = join(outDir, `${tag}-events.jsonl`), logFile = join(outDir, `${tag}-server.log`);
writeFileSync(eventsFile, '');
const log = openSync(logFile, 'w');
const nodeArgs = ['--import', new URL('./preload.mjs', import.meta.url).pathname, ...(arg('cpu-prof', false) ? ['--cpu-prof', `--cpu-prof-dir=${outDir}`, `--cpu-prof-name=${tag}.cpuprofile`, '--cpu-prof-interval', '500'] : []), 'apps/server/src/main.ts'];
const child = spawn(process.execPath, nodeArgs, {cwd: root, stdio: ['ignore', log, log], env: {
  PATH: process.env.PATH, HOME: process.env.HOME, HOST: '127.0.0.1', PORT: String(port), WORLD_KEY: worldKey, WORLD_ID: `${worldKey}-1`, WORLD_OWNER_ID: 'dev:admin', ENGINE: 'mars',
  DEV_AUTH: '1', AUTH_PROVIDER: 'none', BRAIN_MODE: 'fake', MIND_DRIVER: 'edge', SEED_NATIVES: '0', EDGE_FADING: '1', DATA_DIR: data, PUBLIC_URL: base.replace(`/w/${worldKey}`, ''),
  ...(noGod ? {} : {GENESIS_FILE: genesis}), ...(worldKey === 'mars' ? {ENABLE_LIVING_WORLD: '1'} : {}), CAPSTALL_OUT: eventsFile, CAPSTALL_ROOT: root}});
closeSync(log);

const call = async (path, body, token, method) => {
  const t0 = performance.now(), wall = Date.now();
  const r = await fetch(base + path, {method: method ?? (body === undefined ? 'GET' : 'POST'), headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const text = await r.text(), ms = performance.now() - t0;
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!r.ok && !path.includes('/act')) throw new Error(`${path}: ${r.status} ${text.slice(0, 300)}`);
  return {status: r.status, json, ms, wall, end: Date.now()};
};
const events = () => readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const between = (from, to) => events().filter((e) => e.t >= from && e.t <= to + 5);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const r1 = (v) => v === null || v === undefined ? v : Math.round(v * 10) / 10;

async function newSoul(i) {
  const owner = `dev:cs${i}`;
  const inv = await call('/v1/admin', {action: 'invite', uses: 1}, 'dev:admin');
  await call('/v1/invite', {code: inv.json.code}, owner);
  const born = await call('/v1/souls', {name: `Probe ${i}`, description: 'capability stall measurement Soul (fake mind)'}, owner);
  const id = born.json.soul?.id ?? born.json.lifecycle?.soulId;
  if (!id) throw new Error('no soul id: ' + JSON.stringify(born.json).slice(0, 200));
  const code = await call(`/v1/souls/${id}/pair`, {}, owner);
  const ex = await fetch(base + '/v1/agent/pair', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code: code.json.code})}).then((r) => r.json());
  return {id, token: ex.token, name: `Probe ${i}`, entityId: born.json.soul?.entityId};
}

const results = {tag, node: process.version, genesis, extra, reps, port, startedAt: new Date().toISOString()};
try {
  const readyBy = performance.now() + 120000;
  for (;;) { if (child.exitCode !== null) throw new Error('server exited ' + child.exitCode); try { await call('/healthz'); break; } catch (e) { if (performance.now() > readyBy) throw e; await sleep(100); } }
  const god = noGod ? null : (await call('/v1/god/mint', {label: 'capstall'}, 'dev:admin')).json.token;
  if (w4b) {
    // the godmode W4b world: a church and a gazebo on the district's east side (where its 9.5 s admission stall was seen)
    const r = await call('/v1/god/act', {ops: [{op: 'place', def: 'core/church@1', name: 'test-church', p: [100, 19], r: -1.57}, {op: 'place', def: 'core/gazebo@1', name: 'lib-gazebo', p: [69, 5]}]}, god);
    if (!r.json.accepted) throw new Error('w4b build refused: ' + JSON.stringify(r.json).slice(0, 400));
  }
  if (extra > 0) {
    // a built-up world: `extra` houses on a grid east of the district (named, so GodNav lists them and their rooms)
    const ops = [];
    for (let i = 0; i < extra; i++) ops.push({op: 'place', def: 'core/house@1', name: `cs-house-${i}`, p: [80 + (i % 10) * 18, -160 + Math.floor(i / 10) * 18]});
    for (let i = 0; i < extra; i += 10) {
      const r = await call('/v1/god/act', {ops: ops.slice(i, i + 10)}, god);
      if (!r.json.accepted) throw new Error('build refused: ' + JSON.stringify(r.json).slice(0, 400));
    }
  }
  await sleep(1500);
  const souls = []; for (let i = 0; i < soulCount; i++) souls.push(await newSoul(i));
  await sleep(2500);
  if (!noGod) {
    const world = (await call('/v1/god/status', undefined, god)).json;
    const snap = (await call('/v1/world/seq')).json;
    results.world = {entities: snap.entities, godStatus: Object.fromEntries(Object.entries(world).filter(([, v]) => typeof v !== 'object'))};
  } else results.world = {baseWorld: worldKey};
  const s = souls[0];
  if (nearChurch > 0) {
    // churches (several rooms and floors each) close to the Soul: GodNav offers their rooms (ROOMS_WITHIN 80 m) and resolves each one
    const me = (await call(`/v1/world/entities/${s.entityId}`)).json.pose;
    // place one op, moving to the server's suggested spot when the first one overlaps something
    const place = async (def, name, p, r) => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const res = await call('/v1/god/act', {ops: [{op: 'place', def, name, p, ...(r !== undefined ? {r} : {})}]}, god);
        if (res.json.accepted) return p;
        const f = res.json.failures?.[0]; p = f?.suggest?.p ?? [p[0] + 15, p[1] + 5];
        if (attempt === 7) throw new Error(`could not place ${name}: ${JSON.stringify(res.json.failures).slice(0, 300)}`);
      }
    };
    results.placed = {};
    for (let i = 0; i < nearChurch; i++) results.placed[`church-${i}`] = await place('core/church@1', `cs-church-${i}`, [Math.round(me.x + 25 + i * 45), Math.round(me.z + 8 + (i % 2) * 30)], -1.57);
    results.placed.gazebo = await place('core/gazebo@1', 'cs-gazebo', [Math.round(me.x + 8), Math.round(me.z - 14)]);
    results.soulAt = [me.x, me.z]; await sleep(1500);
  }

  // ---- idle baseline: event-loop gaps with no requests (ticks, snapshots)
  const idleFrom = Date.now(); await sleep(8000); const idleTo = Date.now();
  const idleGaps = between(idleFrom, idleTo).filter((e) => e.k === 'gap').map((e) => e.ms);
  results.idle = {seconds: 8, gaps: idleGaps.length, maxGapMs: Math.max(0, ...idleGaps)};

  // ---- 1. first-ever capability listing (index not built, nothing cached)
  const first = await call('/v1/edge/capabilities', undefined, s.token);
  const caps = first.json.capabilities;
  // --dump-caps: the full offered list (id, verb, availability, blocked code, label) after a second cold listing, to diff two checkouts
  if (arg('dump-caps', false)) {
    await sleep(idleMs);
    const again = (await call('/v1/edge/capabilities', undefined, s.token)).json.capabilities;
    writeFileSync(join(outDir, `${tag}-caps.json`), JSON.stringify(again.map((c) => ({id: c.id, verb: c.verb, available: c.available, blocked: c.blocked?.code ?? null, label: c.label, target: c.target ?? null})), null, 1) + '\n');
  }
  const verbs = {}; for (const c of caps) verbs[c.verb] = (verbs[c.verb] ?? 0) + 1;
  const dist = (c) => Number(/\((?:[^;)]*; )?(\d+) m/.exec(c.label)?.[1] ?? 1e9);
  const near = (verb) => caps.filter((c) => c.verb === verb && c.available && !c.id.endsWith(':here')).sort((a, b) => dist(a) - dist(b));
  // sit: the nearest seats first until one is accepted (a refused sit still pays the full discovery, but an accepted one is the real use)
  let sit = null;
  for (const c of near('sit').slice(0, 8)) { const r = await call('/v1/edge/act', {capability: c.id}, s.token); await sleep(300); if (r.json.accepted) { sit = c; break; } }
  await call('/v1/edge/act', {capability: 'stand:here'}, s.token); await sleep(500);
  const targets = {sit, walk: near('walk')[2] ?? near('walk')[0], 'hang-out': near('hang-out')[2] ?? near('hang-out')[0]};
  results.capabilities = {total: caps.length, byVerb: verbs, targets: Object.fromEntries(Object.entries(targets).map(([k, c]) => [k, c?.id ?? null]))};
  const firstEv = between(first.wall, first.end).filter((e) => e.k === 'binds');
  results.firstListing = {clientMs: r1(first.ms), binds: firstEv.map((e) => { const {k, t, soul, tick, ...rest} = e; return rest; })};

  // ---- 2. per-act timings, cold and warm
  const doAct = async (token, capability) => call('/v1/edge/act', {capability}, token);
  const stand = async () => { await doAct(s.token, 'stand:here'); await sleep(400); };
  const rows = [];
  for (let rep = 0; rep < reps; rep++) {
    for (const [kind, cap] of Object.entries(targets)) {
      if (!cap) continue;
      await stand();
      // cold: nothing asked this Soul anything for `idleMs` (> 50 ticks: GodNav goals expired; > 1 tick: capCache stale)
      await sleep(idleMs);
      let r = await doAct(s.token, cap.id);
      let ev = between(r.wall, r.end);
      rows.push({kind, mode: 'cold', id: cap.id, accepted: r.json.accepted, code: r.json.code, clientMs: r.ms, ev});
      await stand();
      // warm-goals: list capabilities (primes GodNav goals), act ~60 ms later (next tick: capCache stale, goals fresh)
      await sleep(idleMs);
      await call('/v1/edge/capabilities', undefined, s.token); await sleep(60);
      r = await doAct(s.token, cap.id); ev = between(r.wall, r.end);
      rows.push({kind, mode: 'warm-goals', id: cap.id, accepted: r.json.accepted, code: r.json.code, clientMs: r.ms, ev});
      await stand();
      // listing only (what `here`/observe/capabilities polling costs), cold
      await sleep(idleMs);
      const l = await call('/v1/edge/capabilities', undefined, s.token);
      rows.push({kind: 'list', mode: 'cold', id: 'GET /v1/edge/capabilities', accepted: true, clientMs: l.ms, ev: between(l.wall, l.end)});
    }
  }
  const sum = (ev, k) => ev.filter((e) => e.k === 'binds' && !e.hit).reduce((a, e) => a + (e[k] ?? 0), 0);
  results.samples = rows.map(({ev, ...r}) => ({...r, clientMs: r1(r.clientMs),
    bindsMs: r1(sum(ev, 'ms')), bindsCpuMs: r1(sum(ev, 'cpuMs')), bindsMisses: ev.filter((e) => e.k === 'binds' && !e.hit).length, bindsHits: ev.filter((e) => e.k === 'binds' && e.hit).length,
    navMs: r1(sum(ev, 'navMs')), goalN: sum(ev, 'goalN'), goalMs: r1(sum(ev, 'goalMs')), roomGoalMs: r1(sum(ev, 'roomGoalMs')),
    standableN: sum(ev, 'standableN'), standableMs: r1(sum(ev, 'standableMs')), reachN: sum(ev, 'reachN'), reachMs: r1(sum(ev, 'reachMs')),
    gridsOverN: sum(ev, 'gridsOverN'), gridsOverMs: r1(sum(ev, 'gridsOverMs')), levelBuildN: sum(ev, 'levelBuildN'), levelBuildMs: r1(sum(ev, 'levelBuildMs')), clearSpotsMs: r1(sum(ev, 'clearSpotsMs')),
    actSyncMs: r1(ev.filter((e) => e.k === 'act').reduce((a, e) => Math.max(a, e.syncMs), 0)),
    maxLoopGapMs: Math.max(0, ...ev.filter((e) => e.k === 'gap').map((e) => e.ms))}));
  const group = {};
  for (const x of results.samples) { const k = `${x.kind}/${x.mode}`; (group[k] ??= []).push(x); }
  results.summary = Object.fromEntries(Object.entries(group).map(([k, a]) => [k, {n: a.length, accepted: a.filter((x) => x.accepted).length, medianClientMs: r1(median(a.map((x) => x.clientMs))), medianBindsMs: r1(median(a.map((x) => x.bindsMs))), medianBindsCpuMs: r1(median(a.map((x) => x.bindsCpuMs))),
    medianLoopGapMs: r1(median(a.map((x) => x.maxLoopGapMs))), maxLoopGapMs: Math.max(...a.map((x) => x.maxLoopGapMs)), medianStandableN: median(a.map((x) => x.standableN)), medianStandableMs: r1(median(a.map((x) => x.standableMs))),
    medianGridsOverN: median(a.map((x) => x.gridsOverN)), medianGridsOverMs: r1(median(a.map((x) => x.gridsOverMs))), medianGoalMs: r1(median(a.map((x) => x.goalMs))), medianReachMs: r1(median(a.map((x) => x.reachMs)))}]));

  // ---- 2b. edit tax: the first listing after a god edit (the static world changed, so the navigation epoch moved)
  const editRounds = Number(arg('edit-tax', 0));
  if (editRounds > 0 && !noGod) {
    results.editTax = [];
    for (let i = 0; i < editRounds; i++) {
      await sleep(idleMs);
      const at0 = Date.now();
      let placed = null;
      for (let attempt = 0; attempt < 6 && !placed; attempt++) {
        const p = [-20 - i * 6 - attempt * 3, 30 + i * 4];
        const r = await call('/v1/god/act', {ops: [{op: 'place', def: 'core/bench@1', name: `cs-edit-${i}-${attempt}`, p}]}, god);
        if (r.json.accepted) placed = p;
      }
      await sleep(1200);                                   // the engine folds the edit on its next ticks
      const l = await call('/v1/edge/capabilities', undefined, s.token);
      const ev = between(l.wall, l.end).filter((e) => e.k === 'binds' && !e.hit);
      const l2 = await call('/v1/edge/capabilities', undefined, s.token);   // the very next listing, a tick or more later
      const ev2 = between(l2.wall, l2.end).filter((e) => e.k === 'binds' && !e.hit);
      results.editTax.push({round: i, placed, firstAfterEditMs: r1(l.ms), bindsMs: r1(ev.reduce((a, e) => a + e.ms, 0)), levelBuildN: ev.reduce((a, e) => a + (e.levelBuildN ?? 0), 0), pagedRouteBuilds: ev.reduce((a, e) => a + (e.gridsOverFrompagedRouteN ?? 0), 0), secondMs: r1(l2.ms), secondBindsMs: r1(ev2.reduce((a, e) => a + e.ms, 0))});
    }
  }

  // ---- 3. load: K Souls poll capabilities every 4 s and act every ~15 s (an attentive agent), for loadSeconds
  if (loadSeconds > 0) {
    const from = Date.now(), until = from + loadSeconds * 1000, acts = [];
    const worker = async (soul, k) => {
      await sleep(k * 700);
      let n = 0;
      while (Date.now() < until) {
        const l = await call('/v1/edge/capabilities', undefined, soul.token);
        if (n % 4 === 3) { const c = l.json.capabilities.filter((x) => x.available && /^(walk|sit|hang-out):/.test(x.id) && !x.id.endsWith(':here')); const pickC = c[(n * 7 + k) % c.length]; if (pickC) acts.push({id: pickC.id, ...(await doAct(soul.token, pickC.id))}); }
        n++; await sleep(4000);
      }
    };
    await Promise.all(souls.map(worker));
    const ev = between(from, Date.now()), gaps = ev.filter((e) => e.k === 'gap'), binds = ev.filter((e) => e.k === 'binds' && !e.hit);
    results.load = {souls: soulCount, seconds: loadSeconds, acts: acts.length, bindsMisses: binds.length, bindsMsTotal: r1(binds.reduce((a, e) => a + e.ms, 0)), blockedFraction: r1(binds.reduce((a, e) => a + e.ms, 0) / (loadSeconds * 1000) * 100),
      gapsOver100ms: gaps.filter((g) => g.ms >= 100).length, gapsOver500ms: gaps.filter((g) => g.ms >= 500).length, maxGapMs: Math.max(0, ...gaps.map((g) => g.ms)), medianActClientMs: r1(median(acts.map((a) => a.ms))), maxActClientMs: r1(Math.max(0, ...acts.map((a) => a.ms)))};
  }
  writeFileSync(join(outDir, `${tag}-summary.json`), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({tag, editTax: results.editTax, world: results.world, idle: results.idle, capabilities: results.capabilities, firstListing: results.firstListing, summary: results.summary, load: results.load}, null, 1));
} finally {
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  console.log(`stopped ${child.pid}; data ${data}; out ${outDir}`);
}
