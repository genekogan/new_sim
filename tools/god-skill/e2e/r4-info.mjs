#!/usr/bin/env node
// R4-INFO proof: Soul-information parity on a god's world. One fresh world (launcher env: edge minds, Soul lifecycle,
// fading), three players, every Soul read through the UNCHANGED Soul CLI (tools/edge-skill/eden-agent.mjs):
//   the GOD (eden-god.mjs) builds a plaza with a fountain, two benches, a lamp and a sign, a furnished roundhouse
//   "moss-cottage", a pond and a gazebo;
//   Soul ANA reads the map (places with kinds, centres, descriptions, walkable, a room's capacity), `here` (exits with
//   walk:<place> + ETA), walks to an exit by its name, finds herself "plaza < Green field < World", sees the fountain
//   in the plaza (placeId = the plaza) but not the cottage's furniture; Soul BEN joins her: each is offered
//   hug:/high-five:/dance-with:/follow: the other; Ana speaks, Ben hears it (wait), they converse (start/accept/say/turns);
//   Ana goes into the cottage's living room ("where" names it; Ben outside is out of sight);
//   the GOD edits: lays out a garden and moves the fountain out onto the green; Ben's very next `map`/`here` show the
//   garden and the fountain as a landmark place, and the plaza's description no longer has a fountain;
//   Ben plans a walk via the fountain to the pond (multi-leg `via`), hangs out and strolls (Eden's place verbs).
//
//   node tools/god-skill/e2e/r4-info.mjs [--port 5504] [--keep]
//
// Report under .lane/e2e-r4-info/<stamp>/ (report.json, REPORT.md, every CLI read as JSON under reads/).
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = typeof args.slug === 'string' ? args.slug : 'r4info';
const port = Number(args.port ?? 5504);
const out = resolve(root, '.lane/e2e-r4-info', stamp);
mkdirSync(resolve(out, 'reads'), { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], failures: [] };
const log = (...a) => console.log(...a);
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the world process (fake minds, dev auth, fresh data dir, local Mars assets)
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', EDGE_FADING: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', MAX_SOULS_PER_USER: '10', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` };
let serverLog = '', server;
const boot = async () => {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  const t0 = t();
  for (let i = 0; i < 3000; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) return t() - t0; } catch { } await sleep(100); }
  throw new Error('world did not come up');
};
const stop = () => { try { server?.kill(); } catch { } };
process.on('exit', () => { if (!args.keep) stop(); });

async function api(path, { method, body, token } = {}) {
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const summarize = (r) => { try { const s = JSON.stringify(r); return s && s.length > 2500 ? JSON.parse(JSON.stringify(r, (k, v) => (Array.isArray(v) && v.length > 14 ? `[${v.length} items]` : v))) : r; } catch { return String(r); } };
async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e); }
  const ms = t() - t0, okay = !error && (expect ? !!expect(result) : true);
  const brief = summarize(result);
  report.steps.push({ name, ms: +ms.toFixed(0), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(brief)).slice(0, 600)}`);
  return result;
}

// ---------- the god CLI and two Soul CLIs, each in its own folder
const GOD = resolve(root, 'tools/god-skill/eden-god.mjs'), CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
const godDir = resolve(out, 'god-cli'); mkdirSync(godDir, { recursive: true });
const god = (...argv) => new Promise((ok) => execFile(process.execPath, [GOD, ...argv], { cwd: godDir, timeout: 180_000, env: { ...process.env, EDEN_GOD_NO_LEASE: '1' } }, (err, stdout, stderr) => ok({ code: err?.code ?? 0, out: String(stdout), err: String(stderr).slice(0, 400) })));
let reads = 0;
function soulCli(who) {
  const dir = resolve(out, `soul-${who}`); mkdirSync(dir, { recursive: true });
  const run = (...argv) => new Promise((ok) => execFile(process.execPath, [CLI, ...argv], { cwd: dir, timeout: 150_000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1' } }, (err, stdout, stderr) => {
    const s = String(stdout); let data = null; try { data = JSON.parse(s.slice(s.indexOf('{'))); } catch { }
    writeFileSync(resolve(out, 'reads', `${String(++reads).padStart(3, '0')}-${who}-${argv[0]}.json`), JSON.stringify({ argv, data, raw: data ? undefined : s.slice(0, 2000), stderr: String(stderr).slice(0, 400) }, null, 1));
    ok({ code: err?.code ?? 0, data, stderr: String(stderr).slice(0, 400), raw: data ? undefined : s.slice(0, 400) });
  }));
  const state = () => JSON.parse(readFileSync(resolve(dir, '.eden-agent.json'), 'utf8'));
  /** Follow an accepted act's receipt to its end (the Soul's own token, as its agent would). */
  const follow = async (acted, maxS = 200) => {
    if (!acted?.accepted) return { accepted: false, code: acted?.code, reason: acted?.reason };
    const id = acted.receipt?.id, t0 = Date.now(), path = []; let rec = acted.receipt;
    while (Date.now() - t0 < maxS * 1000 && id) {
      const pos = (await api('/v1/edge/here', { token: state().token })).data?.here?.me?.pos; if (pos) path.push(pos);
      rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { token: state().token })).data?.receipt ?? rec;
      if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
      await sleep(700);
    }
    return { accepted: true, resolved: acted.resolved?.to ?? rec?.capability, phase: rec?.phase, code: rec?.code, reason: rec?.reason, endedAt: rec?.endedAt, path };
  };
  return { run, state, follow, act: async (...a) => follow((await run('act', ...a)).data) };
}
const ana = soulCli('ana'), ben = soulCli('ben');
const byName = (list, n) => (list ?? []).find((x) => x.name === n);

// ================================================================ the scenario
const built = [
  ['place', 'plaza', '--rect', '0,-18,16,14', '--name', 'plaza'],
  ['place', 'fountain', '--at', '0,-20', '--name', 'fountain'],
  ['place', 'bench', '--near', 'fountain', '--count', '2', '--facing', 'fountain', '--dist', '2.5', '--name', 'plaza-bench'],
  ['place', 'lamp-post', '--near', 'fountain', '--dir', 'e', '--dist', '4', '--name', 'fountain-lamp'],
  ['place', 'sign', '--at', '4,-12', '--facing', 's', '--state', '{"text":"Welcome to the plaza"}', '--name', 'welcome-sign'],
  ['place', 'roundhouse', '--at', '-16,-20', '--facing', 'fountain', '--name', 'moss-cottage'],
  ['furnish', 'moss-cottage'],
  ['place', 'pond', '--circle', '14,12,7', '--name', 'pond'],
  ['place', 'gazebo', '--at', '-14,10', '--name', 'gazebo'],
];
let bootMs = 0;
try {
  bootMs = await boot();
  log(`▶ world "${slug}" on :${port} booted in ${bootMs.toFixed(0)} ms`);
  await step('G0 the owner mints a god token; the god builds a plaza (fountain, 2 benches, lamp, sign), a furnished roundhouse, a pond, a gazebo', async () => {
    const r = await api('/v1/god/mint', { token: 'dev:admin', body: { label: 'e2e r4-info' } });
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: r.data.token }, null, 1));
    const res = [];
    for (const c of built) { const g = await god(...c); res.push({ cmd: c.slice(0, 2).join(' '), ok: g.code === 0 && !/REFUSED/.test(g.out) }); }
    return { token: !!r.data.token, all: res.every((x) => x.ok), res };
  }, (r) => r.token && r.all);
  await step('S0 two owners register the Soul CLI and create Souls Ana and Ben (the normal agent flow)', async () => {
    const o = {};
    for (const [who, cli, name] of [['ana', ana, 'Ana'], ['ben', ben, 'Ben']]) {
      await cli.run('register', base); const c = await cli.run('create-soul', name, 'an r4-info probe'); o[who] = c.data?.soul?.id ?? null;
    }
    for (let i = 0; i < 60 && !(await ana.run('here')).data?.me?.pos; i++) await sleep(500);
    return o;
  }, (r) => r.ana && r.ben);
  const ids = { ana: ana.state().soul, ben: ben.state().soul };

  // ---- 1. the map: places like Eden's (kinds, centres, walkable, descriptions, a room's capacity)
  await step('I1 map: the god\'s plaza, pond, cottage + its living room, gazebo are walkable places with centres, kinds and descriptions (the room enclosed, with a capacity)', async () => {
    const m = (await ana.run('map')).data?.places ?? [], p = (id) => m.find((x) => x.id === id);
    const want = ['g-plaza', 'g-pond', 'g-moss-cottage', 'g-moss-cottage.living', 'g-gazebo'];
    return { count: m.length, have: want.filter((id) => p(id)?.walkable && Array.isArray(p(id)?.center) && p(id)?.description), plaza: p('g-plaza')?.description, room: { kind: p('g-moss-cottage.living')?.kind, enclosed: p('g-moss-cottage.living')?.enclosed, capacity: p('g-moss-cottage.living')?.capacity, parent: p('g-moss-cottage.living')?.parent, description: p('g-moss-cottage.living')?.description }, pond: p('g-pond')?.kind };
  }, (r) => r.have.length === 5 && /fountain/.test(r.plaza) && /bench/.test(r.plaza) && r.room.enclosed && r.room.capacity >= 1 && r.room.parent === 'g-moss-cottage' && r.pond === 'water');

  // ---- 2. here: exits with walk:<place> and an ETA, as Eden lists them
  const h0 = await step('I2 here (Ana at the arrival point): exits name the places around her, each {to, name, dir, walk:<place>, eta}', async () => {
    const h = (await ana.run('here')).data;
    return { where: h?.me?.placePath, exits: h?.exits ?? [] };
  }, (r) => r.exits.length >= 3 && r.exits.every((e) => e.to && e.name && e.dir && /^walk:/.test(e.walk) && /^~/.test(e.eta)) && !!byName(r.exits, 'plaza'));
  await step('I3 Ana walks to an exit by its name (the exit\'s own walk) → completed; `here` and `observe` name the plaza ("plaza < Green field < World")', async () => {
    const exit = byName(h0?.exits, 'plaza'); const r = await ana.act(exit?.walk ?? 'walk:plaza');
    const h = (await ana.run('here')).data, o = (await ana.run('observe')).data;
    return { walk: exit?.walk, ...r, placePath: h?.me?.placePath, where: o?.me?.where, endedAt: r.endedAt?.placePath };
  }, (r) => r.phase === 'completed' && r.placePath?.[0] === 'plaza' && /^plaza < /.test(r.where ?? ''));
  await step('I4 observe here.objects in the plaza: the fountain, its lamp and the sign with placeId g-plaza and here=true, nearest first; the cottage\'s furniture (behind walls) is not listed; here.objects lists the free benches', async () => {
    const o = (await ana.run('observe')).data, h = (await ana.run('here')).data, objs = o?.here?.objects ?? [];
    return { objects: objs.map((x) => `${x.name}@${x.placeId}${x.here ? '*' : ''} ${x.dist}m`), fountain: byName(objs, 'fountain'), furniture: objs.filter((x) => /moss-cottage\//.test(x.name)).length, doHere: (o?.doHere ?? []).map((c) => c.id), sorted: objs.every((x, i) => !i || (objs[i - 1].dist ?? 0) <= (x.dist ?? 0)), seats: (h?.objects ?? []).filter((x) => x.kind === 'seat').map((x) => `${x.name} free=${x.free}`) };
  }, (r) => r.fountain?.placeId === 'g-plaza' && r.fountain.here === true && r.furniture === 0 && r.sorted && r.seats.length >= 2 && !r.doHere.some((id) => id.startsWith('pick-up:')) && !r.objects.some((x) => x.startsWith('plaza@')));

  // ---- 3. two Souls: social affordances, speech, a conversation
  await step('S1 Ben: act "walk to the plaza" (plain words) → he arrives by Ana; observe lists Ana and offers hug:/high-five:/dance-with:/follow:<Ana>', async () => {
    const r = await ben.act('walk to the plaza'); const o = (await ben.run('observe')).data;
    const near = (o?.here?.souls ?? []).find((s) => s.soulId === ids.ana), offers = (o?.doHere ?? []).map((c) => c.id);
    return { ...r, where: o?.me?.where, near: near ? { name: near.name, distance: near.distance, placeId: near.placeId } : null, social: ['hug', 'high-five', 'dance-with', 'follow'].filter((v) => offers.includes(`${v}:${ids.ana}`)) };
  }, (r) => r.phase === 'completed' && r.near?.placeId === 'g-plaza' && r.social.length === 4);
  await step('S1b Ana\'s events (wait) tell her Ben arrived in the plaza (an arrival naming the god\'s place)', async () => {
    const w = (await ana.run('wait', '2')).data, ev = (w?.events ?? []).filter((e) => e.kind === 'arrival');
    return { arrivals: ev.map((e) => ({ place: e.placeId ?? e.place, who: e.soul?.name ?? e.from ?? e.who })) };
  }, (r) => r.arrivals.some((a) => a.place === 'g-plaza' && /Ben/.test(JSON.stringify(a))));
  await step('S2 Ana says something; Ben (in earshot) hears it in his events (wait), with the place it was said in', async () => {
    await ben.run('wait', '1');
    const s = (await ana.run('say', 'Hello Ben, have you seen the fountain?')).data;
    const w = (await ben.run('wait', '5')).data, heard = (w?.events ?? []).find((e) => e.kind === 'speech' && e.fromId === ids.ana);
    return { heardBy: s?.said?.heardBy, channel: s?.said?.channel, heard: heard ? { text: heard.text, place: heard.place } : null };
  }, (r) => r.heardBy >= 1 && /fountain/.test(r.heard?.text ?? '') && r.heard.place === 'g-plaza');
  await step('S3 Ana starts a conversation with Ben; Ben sees the invitation (converse list), accepts and replies; Ana reads his reply (converse turns)', async () => {
    const st = (await ana.run('converse', 'start', ids.ben, 'Shall we sit by the fountain?')).data, cv = st?.conversation?.id;
    const list = (await ben.run('converse', 'list')).data;
    const acc = (await ben.run('converse', 'accept', cv)).data;
    const say = (await ben.run('converse', 'say', cv, 'Yes, the bench by the lamp looks free.')).data;
    const turns = (await ana.run('converse', 'turns', cv)).data;
    return { cv, invited: JSON.stringify(list ?? '').includes(cv ?? '#'), accepted: acc?.accepted, said: say?.accepted, turns: (turns?.turns ?? []).map((x) => `${x.from?.name ?? x.fromName ?? x.from}: ${x.text}`) };
  }, (r) => r.cv && r.invited && r.accepted && r.said && r.turns.some((x) => /bench by the lamp/.test(x)));

  // ---- 4. into the cottage
  await step('S4 Ana: act "go into moss-cottage/living" → she ends in the living room; where = "moss-cottage/living < moss-cottage < Green field < World"; Ben outside is out of sight; the furniture is listed in the room', async () => {
    const r = await ana.act('walk:moss-cottage/living'); const h = (await ana.run('here')).data, o = (await ana.run('observe')).data;
    const { path: _p, ...rest } = r;
    return { ...rest, where: o?.me?.where, near: (h?.near ?? []).map((x) => x.name), exits: (h?.exits ?? []).map((x) => x.walk), objects: (o?.here?.objects ?? []).map((x) => `${x.name}@${x.placeId}`) };
  }, (r) => r.phase === 'completed' && /^moss-cottage\/living < moss-cottage < /.test(r.where ?? '') && !r.near.includes('Ben') && r.objects.some((x) => /living-table@g-moss-cottage\.living/.test(x)) && r.exits.includes('walk:plaza'));

  await step('S5 Ben\'s events tell him Ana left the plaza (a departure naming it)', async () => {
    const w = (await ben.run('wait', '2')).data, ev = (w?.events ?? []).filter((e) => e.kind === 'departure');
    return { departures: ev.map((e) => ({ place: e.placeId ?? e.place, who: e.soul?.name ?? e.from ?? e.who })) };
  }, (r) => r.departures.some((a) => a.place === 'g-plaza' && /Ana/.test(JSON.stringify(a))));

  // ---- 5. the god edits; the Souls' next reads show it
  await step('G1 the god lays out a garden (a lawn) east of the plaza and moves the fountain out onto the green, south-west of the pond', async () => {
    const a = await god('place', 'lawn', '--rect', '22,-16,12,10', '--name', 'garden');
    const b = await god('move', 'fountain', '--at', '0,24');
    return { garden: a.code === 0 && !/REFUSED/.test(a.out), moved: b.code === 0 && !/REFUSED/.test(b.out), out: (a.out + b.out).slice(0, 300) };
  }, (r) => r.garden && r.moved);
  await step('G2 Ben\'s very next `map` lists the garden and the fountain (now a landmark place on its own); the plaza\'s description has no fountain any more', async () => {
    const m = (await ben.run('map')).data?.places ?? [], p = (id) => m.find((x) => x.id === id);
    return { garden: p('g-garden') && { kind: p('g-garden').kind, walkable: p('g-garden').walkable, center: p('g-garden').center, description: p('g-garden').description }, fountain: p('g-fountain') && { kind: p('g-fountain').kind, center: p('g-fountain').center, description: p('g-fountain').description }, plaza: p('g-plaza')?.description };
  }, (r) => r.garden?.walkable && r.fountain?.kind === 'landmark' && Math.hypot(r.fountain.center[0], r.fountain.center[1] - 24) < 1 && !/fountain/.test(r.plaza ?? 'fountain'));
  await step('G3 Ben\'s next `here` lists the garden among his exits (walk:garden), and his observe no longer has the fountain in the plaza', async () => {
    const h = (await ben.run('here')).data, o = (await ben.run('observe')).data;
    return { exits: (h?.exits ?? []).map((x) => `${x.name}→${x.walk} ${x.dir} ${x.eta}`), fountainHere: (o?.here?.objects ?? []).filter((x) => x.name === 'fountain').map((x) => `${x.placeId} ${x.dist}`) };
  }, (r) => r.exits.some((x) => /^garden→walk:garden /.test(x)) && !r.fountainHere.some((x) => x.startsWith('g-plaza')));

  // ---- 6. well-planned, granular actions on the new places
  await step('P1 Ben plans one act: walk to the pond via the fountain (multi-leg `via` through the new landmark) → completed at the pond\'s shore', async () => {
    const r = await ben.act('walk:pond', '{"via":["fountain"]}');
    const h = (await ben.run('here')).data, { path, ...rest } = r;
    const byFountain = Math.min(...path.map((p) => Math.hypot(p[0] - 0, p[1] - 24)));
    return { ...rest, at: h?.me?.pos, placePath: h?.me?.placePath, byFountain: +byFountain.toFixed(1), samples: path.length };
  }, (r) => r.phase === 'completed' && r.byFountain < 4 && r.placePath?.[0] === 'pond shore');
  await step('P2 Eden\'s place verbs on god places: capabilities offer hang-out:<place> (and stroll:<area>); "hang out at the gazebo" resolves and Ben goes there', async () => {
    const c = (await ben.run('capabilities')).data, all = c?.canDo?.available ?? [];
    const res = (await ben.run('resolve', 'hang out at the gazebo')).data;
    const r = await ben.act('hang out at the gazebo', '{"seconds":5}');
    const h = (await ben.run('here')).data;
    return { hangOuts: all.filter((x) => x.verb === 'hang-out').map((x) => x.id), strolls: all.filter((x) => x.verb === 'stroll').map((x) => x.id), resolved: res?.would?.id ?? res?.capability ?? res?.resolved?.to, ...r, placePath: h?.me?.placePath };
  }, (r) => r.hangOuts.includes('hang-out:gazebo') && r.hangOuts.includes('hang-out:garden') && r.strolls.includes('stroll:plaza') && r.phase === 'completed' && r.placePath?.[0] === 'gazebo');
  await step('P3 explore suggests a walk to a place not yet visited; view describes what is further off by name', async () => {
    const e = (await ben.run('explore')).data, v = (await ben.run('view', '--alt-only')).data;
    return { suggestion: e?.suggestion, label: e?.label, alt: String(v?.alt ?? '').slice(0, 300) };
  }, (r) => /^walk:/.test(r.suggestion ?? '') && /Further off|sees/.test(r.alt));
  await step('Z nothing faulted: no engine faults or violations in the server log', async () => ({ faults: (serverLog.match(/engine fault|violat/g) ?? []).length, placesErrors: (serverLog.match(/god places:|perceive:/g) ?? []).length }), (r) => r.faults === 0 && r.placesErrors === 0);
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  report.summary = { steps: report.steps.length, failed: report.failures.length, bootMs: +bootMs.toFixed(0), faults: (serverLog.match(/engine fault|violat/g) ?? []).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# R4-INFO Soul-information parity — ${slug} — ${report.startedAt}`, '', `boot ${report.summary.bootMs} ms · ${report.summary.steps} steps · ${report.summary.failed} failed · engine faults/violations in log: ${report.summary.faults}`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 240).replace(/\|/g, '/')} |`), '', `CLI reads: \`${resolve(out, 'reads')}\``].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
