#!/usr/bin/env node
// CE8 measure: replay a recorded run through the real server builds code and the real viewer sites layer, in-process,
// on a fake clock, and count how often the "god is looking here" reticle marks the area each step changed.
//
//   node tools/god-skill/scripts/attention-replay.mjs <run-dir> [<run-dir>…] [--margin 2] [--json out.json] [--ttl ms|inf] [--point]   (both what-ifs)
//
// <run-dir> is a recorded review run (R/runs/<name>): data/backup-*.db (the world before the run), data/sim.db (its
// journal and builds), transcript*.jsonl (the agent's commands with timestamps). Nothing is read from or sent to any
// service: the databases are copied to a temp folder and opened there. Hints are taken from the agent's own successful
// look / where / free commands (look at its start, where/free at its answer — when the CLI sends them), edits are the
// journal's accepted batches (undone batches, their undos and world-only batches skipped) at their journal times, and
// builds start/close at their recorded times. A step is one replayed batch of a build that touched something in space;
// it is marked when the viewer's visible reticle ring (radius = its rendered size / 2, + margin) reaches that batch's
// changed footprint at the moment the batch arrives or at any reticle change before the next step. Plan steps (build
// step n) aggregate their batches. What-ifs (not shipped): --ttl changes the 20 s fade, --point counts only the centre.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { Db } from '../../../apps/server/src/db.ts';
import { GodMode } from '../../../apps/server/src/god/god.ts';
import { ATTENTION } from '../../../apps/server/src/god/builds.ts';
import { WorldBuildSites, GAZE } from '../../../apps/web/src/WorldBuildSites.ts';

const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const runs = argv.filter((a, i) => !a.startsWith('--') && !['--margin', '--json', '--ttl'].includes(argv[i - 1]));
const margin = Number(flag('margin', 2)), jsonOut = flag('json'), ttl = flag('ttl'), point = argv.includes('--point');
// The shipped ring spans the look's framed half-height at its target; --point (what-if) counts only its centre.
// What-if only (not shipped behaviour): --ttl <ms|inf> changes how long a look stays shown, on both server and viewer.
if (ttl !== undefined) { const ms = ttl === 'inf' ? 1e15 : Number(ttl); if (!(ms > 0)) throw Error('--ttl takes ms or inf'); Object.assign(ATTENTION, { ttlMs: ms }); Object.assign(GAZE, { ttlMs: ms }); }
if (!runs.length || !Number.isFinite(margin)) { console.error('usage: attention-replay.mjs <run-dir>… [--margin 2] [--json out.json] [--ttl ms|inf] [--point]   (both what-ifs)'); process.exit(2); }

const num = '(-?\\d+(?:\\.\\d+)?)';
const LOOK = new RegExp(`from the [\\w-]+ at \\(${num}, ${num}, ${num}\\) toward \\(${num}, ${num}, ${num}\\)`);
const WHERE = new RegExp(`^\\(${num}, ${num}\\): ground y ${num}`);
const FREE = new RegExp(`^- \\(${num}, ${num}\\) y ${num}`, 'm');
/** The CLI's own hints, reconstructed from what each command printed. */
function hintsOf(rows) {
  const out = [];
  for (const r of rows) {
    if (r.phase === 'start' || r.error || typeof r.out !== 'string' || /--no-build\b/.test(r.cmd)) continue;
    const cmd = r.cmd.split(/\s+/)[0], end = Date.parse(r.at), json = r.out.trim().startsWith('{') || r.out.trim().startsWith('[') ? (() => { try { return JSON.parse(r.out); } catch { return null; } })() : null;
    if (cmd === 'look') {
      const m = r.out.match(LOOK), eye = m ? m.slice(1, 4).map(Number) : json?.eye, at = m ? m.slice(4, 7).map(Number) : json?.at;
      if (at?.length === 3) out.push({ t: end - (r.ms ?? 0), at, eye, cmd: r.cmd });
    } else if (cmd === 'where') {
      const m = r.out.match(WHERE), at = m ? [Number(m[1]), Number(m[3]), Number(m[2])] : json && Number.isFinite(json.x) ? [json.x, json.y, json.z] : null;
      if (at) out.push({ t: end, at, cmd: r.cmd });
    } else if (cmd === 'free') {
      const m = r.out.match(FREE), at = m ? [Number(m[1]), Number(m[3]), Number(m[2])] : Array.isArray(json) && json[0] ? [json[0].at[0], json[0].y, json[0].at[1]] : null;
      if (at) out.push({ t: end, at, cmd: r.cmd });
    }
  }
  return out;
}

function copyDb(src, dir) {
  const out = join(dir, basename(src));
  copyFileSync(src, out); for (const s of ['-wal', '-shm']) if (existsSync(src + s)) copyFileSync(src + s, out + s);
  return out;
}
/** World-space xz bounds of one entity, same footprints as the build closure (paths/areas by their points). */
function boundsOf(model, id) {
  const e = model.entities.get(id); if (!e) return [];
  const def = e.in.parent === 'world' ? undefined : model.resolvedDef(e.def);
  const fs = e.in.parent === 'world' ? model.footprintsOf(id) : def?.layer === 'solid' ? model.footprint(e, def) : [];
  if (fs.length) return fs.map(f => { const c = Math.abs(Math.cos(f.yaw)), s = Math.abs(Math.sin(f.yaw)), hx = c * f.half[0] + s * f.half[1], hz = s * f.half[0] + c * f.half[1]; return [f.c[0] - hx, f.c[1] - hz, f.c[0] + hx, f.c[1] + hz]; });
  const pts = [], walk = v => { if (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)) pts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  if (e.shape) walk(e.shape);
  if (pts.length) { const pad = (e.shape.width ?? 0) / 2; return [[Math.min(...pts.map(p => p[0])) - pad, Math.min(...pts.map(p => p[1])) - pad, Math.max(...pts.map(p => p[0])) + pad, Math.max(...pts.map(p => p[1])) + pad]]; }
  const p = model.worldPose(e); return [[p.x, p.z, p.x, p.z]];
}
const union = boxes => boxes.length ? boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]) : null;
const fakeCanvas = () => { const noop = () => {}; return { width: 0, height: 0, getContext: () => ({ measureText: s => ({ width: s.length * 14 }), beginPath: noop, roundRect: noop, fill: noop, fillText: noop, arc: noop, moveTo: noop, lineTo: noop, stroke: noop }) }; };

async function replay(runDir) {
  const run = resolve(runDir), dir = mkdtempSync(join(tmpdir(), 'y7-attention-replay-'));
  try {
    const backups = readdirSync(join(run, 'data')).filter(f => /^backup-.*\.db$/.test(f)).sort();
    if (!backups.length) throw Error(`${run}/data has no backup-*.db (the world before the run)`);
    const final = new DatabaseSync(copyDb(join(run, 'data', 'sim.db'), dir));
    const initialPath = copyDb(join(run, 'data', backups[0]), dir);
    const snapshot = JSON.parse(readFileSync(join(run, 'initial-snapshot.json'), 'utf8')), worldId = snapshot.worldId;
    const builds = final.prepare('SELECT id, status, created_at, body FROM god_builds_v1 WHERE world_id=? ORDER BY created_at').all(worldId).map(r => ({ ...r, body: JSON.parse(r.body) }));
    const transcripts = readdirSync(run).filter(f => /^transcript.*\.jsonl$/.test(f));
    const hints = transcripts.flatMap(f => hintsOf(readFileSync(join(run, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))));

    let now = 0; const timers = [];
    const emitted = [];
    const god = new GodMode(new Db(initialPath), { worldId, ownerId: null, tick: () => 0, now: () => now, assetDir: join(dir, 'assets'),
      schedule: (fn, ms) => { timers.push({ fn, due: now + ms }); }, emit: m => { emitted.push(m); feed(m); } });
    const floor = god.model.editSeq;
    const edits = final.prepare("SELECT seq, kind, grp, note, ops, at, undone, undo_of FROM world_edits_v1 WHERE world_id=? AND seq > ? AND kind IN ('edit','undo','redo') ORDER BY seq").all(worldId, floor);
    const undone = new Set(edits.filter(e => e.undone).map(e => e.seq)), skip = new Set([...undone, ...edits.filter(e => e.kind === 'undo' && undone.has(e.undo_of)).map(e => e.seq)]);
    const token = god.mintFor({ id: god.owner ?? 'replay', role: 'admin' }, 'attention-replay'), identity = god.godIdentity(token);
    const sites = new WorldBuildSites({ model: () => god.model, groundAt: () => 0, now: () => now, createCanvas: fakeCanvas, search: '?sites=ring,label', reducedMotion: () => true });
    function feed(m) {
      // Exactly the entity layer's routing (WorldEntityLayer.applyEdge); entity drawing is not needed here.
      if (m.kind === 'world-build') { if (m.event === 'attention' || m.rev > sites.maxRev) sites.apply(m); return; }
      if (m.kind === 'world-diff') { sites.apply(m); sites.refitDiff(m); }
    }
    sites.reset(god.builds.publicList(now).builds, god.builds.publicList(now).rev, now);

    const events = [];
    for (const b of builds) {
      events.push({ t: b.created_at, order: 0, type: 'start', b });
      const closed = b.body.done?.at ?? b.body.abandoned?.at; if (closed !== undefined) events.push({ t: closed, order: 3, type: 'close', b });
    }
    for (const e of edits) if (!skip.has(e.seq) && e.kind !== 'undo') events.push({ t: e.at, order: 1, type: 'act', e });
    for (const h of hints) events.push({ t: h.t, order: 2, type: 'hint', h });
    events.sort((a, b) => a.t - b.t || a.order - b.order);

    const leases = new Map(), open = new Set(), stats = { hints: hints.length, hintsOutsideBuilds: 0, hintsRefused: 0, published: 0, acts: 0, actsRefused: 0, worldOnly: 0, nonSpatial: 0, maxReticles: 0 };
    const steps = [], plan = new Map(); let current = null, currentPlan = null;
    const reticles = () => sites.inspect().sites.filter(s => s.gaze).map(s => ({ id: s.id, p: [s.gaze.at[0], s.gaze.at[2]], r: point ? 0 : (s.gaze.size ?? 0) / 2 })); // G2: the reticle is a fixed small screen mark now (no world size)
    const observe = () => {
      const seen = reticles(); stats.maxReticles = Math.max(stats.maxReticles, seen.length);
      for (const r of seen) for (const s of [current, currentPlan]) {
        if (!s || r.id !== s.build) continue;
        // Distance from the reticle to the changed footprint (0 inside): explains misses that are "elsewhere".
        const d = Math.hypot(Math.max(s.area[0] - r.p[0], 0, r.p[0] - s.area[2]), Math.max(s.area[1] - r.p[1], 0, r.p[1] - s.area[3]));
        s.nearest = Math.min(s.nearest ?? Infinity, d);
        if (d <= margin + r.r) s.marked = true;
      }
    };
    const advanceTo = t => {
      for (;;) {
        timers.sort((a, b) => a.due - b.due); const next = timers[0]; if (!next || next.due > t) break;
        timers.shift(); now = Math.max(now, next.due); sites.update(now); const before = emitted.length; next.fn(); if (emitted.length > before) observe();
      }
      now = Math.max(now, t); sites.update(now);
    };
    const stepOf = (e) => {
      for (const b of builds) if (e.grp && (e.grp === b.id || e.grp.startsWith(b.id + '/'))) {
        const s = [...(b.body.steps ?? [])].filter(s => !s.claim).find(s => s.firstSeq <= e.seq && e.seq <= s.lastSeq);
        const n = s?.n ?? 1; return { b, n, label: s?.label ?? b.body.plan.steps[n - 1] ?? `step ${n}` };
      }
      return null;
    };
    for (const ev of events) {
      advanceTo(ev.t);
      if (ev.type === 'start') {
        const r = god.builds.start({ id: ev.b.id, title: ev.b.body.title, steps: ev.b.body.plan.steps, site: ev.b.body.site, massing: ev.b.body.massing ?? [] }, identity);
        if (r.ok) { leases.set(ev.b.id, r.lease); open.add(ev.b.id); } else console.error(`${basename(run)}: start ${ev.b.id} refused: ${JSON.stringify(r.failures).slice(0, 200)}`);
      } else if (ev.type === 'close') {
        if (open.has(ev.b.id)) { god.builds.done(ev.b.id, { force: true }, identity); open.delete(ev.b.id); }
        if (current?.build === ev.b.id) current = null; if (currentPlan?.build === ev.b.id) currentPlan = null;
      } else if (ev.type === 'hint') {
        // The CLI hints its current build; the replay uses the open build whose site holds the point, else the newest.
        const ids = [...open]; if (!ids.length) { stats.hintsOutsideBuilds++; continue; }
        const site = ids.find(id => { const s = builds.find(b => b.id === id).body.site, dx = ev.h.at[0] - s.at[0], dz = ev.h.at[2] - s.at[1], c = Math.cos(s.yaw ?? 0), n = Math.sin(s.yaw ?? 0); return Math.abs(dx * c - dz * n) <= s.size[0] / 2 && Math.abs(dx * n + dz * c) <= s.size[1] / 2; }) ?? ids.at(-1);
        const before = emitted.length, r = god.builds.attend(site, { lease: leases.get(site), at: ev.h.at, ...(ev.h.eye ? { eye: ev.h.eye } : {}) }, identity);
        if (!r.ok) stats.hintsRefused++;
        if (emitted.length > before) observe();
      } else {
        const ops = JSON.parse(ev.e.ops);
        if (ops.every(o => o.op === 'world' || o.op === 'answer')) { stats.worldOnly++; continue; }
        const at = stepOf(ev.e), field = at && open.has(at.b.id) ? { id: at.b.id, lease: leases.get(at.b.id), step: at.n, label: at.label.slice(0, 60) } : undefined;
        const before = god.model.fork(), mark = emitted.length;
        const result = god.act({ ops, ...(ev.e.grp ? { group: ev.e.grp } : {}), ...(field ? { build: field } : {}), ...(ev.e.note ? { note: ev.e.note } : {}) }, ev.e.note ?? undefined);
        stats.acts++;
        if (!result.accepted) { stats.actsRefused++; continue; }
        if (!field) continue;
        const diff = emitted.slice(mark).reverse().find(m => m.kind === 'world-diff')?.diff;
        const area = union([...(diff?.upserts ?? []).flatMap(e => boundsOf(god.model, e.id)), ...(diff?.removes ?? []).flatMap(id => boundsOf(before, id))]);
        if (!area) { stats.nonSpatial++; continue; }
        current = { seq: ev.e.seq, t: ev.t, build: field.id, n: field.step, label: field.label, area, marked: false }; steps.push(current);
        const key = `${field.id}#${field.step}`;
        if (currentPlan?.key !== key) { currentPlan = plan.get(key) ?? { key, build: field.id, n: field.step, label: field.label, area: null, marked: false, batches: 0 }; plan.set(key, currentPlan); }
        currentPlan.area = union([currentPlan.area, area].filter(Boolean)); currentPlan.batches++;
        observe();
      }
    }
    for (const id of open) god.builds.done(id, { force: true }, identity);
    stats.published = emitted.filter(m => m.event === 'attention').length;
    const marked = steps.filter(s => s.marked).length, plans = [...plan.values()], plansMarked = plans.filter(p => p.marked).length;
    sites.dispose(); final.close(); god.db.close();
    return { run: basename(run), margin, steps: steps.length, marked, rate: steps.length ? marked / steps.length : null, planSteps: plans.length, planMarked: plansMarked, planRate: plans.length ? plansMarked / plans.length : null, stats,
      misses: { noReticle: steps.filter(s => !s.marked && s.nearest === undefined).length, elsewhere: steps.filter(s => !s.marked && s.nearest !== undefined).length },
      unmarked: steps.filter(s => !s.marked).map(s => ({ seq: s.seq, build: s.build, step: `${s.n} ${s.label}`, area: s.area.map(v => Math.round(v * 10) / 10), why: s.nearest === undefined ? "no reticle while it was the latest change" : `reticle ${Math.round(s.nearest * 10) / 10} m away` })),
      unmarkedPlans: plans.filter(p => !p.marked).map(p => ({ build: p.build, step: `${p.n} ${p.label}`, batches: p.batches, why: p.nearest === undefined ? "no reticle during the step" : `reticle ${Math.round(p.nearest * 10) / 10} m away` })) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const results = [];
for (const r of runs) {
  const out = await replay(r); results.push(out);
  const pct = v => v === null ? 'n/a' : `${Math.round(v * 1000) / 10}%`;
  console.log(`${out.run}: batches ${out.marked}/${out.steps} marked (${pct(out.rate)}; misses: ${out.misses.noReticle} no reticle, ${out.misses.elsewhere} elsewhere); plan steps ${out.planMarked}/${out.planSteps} (${pct(out.planRate)}); hints ${out.stats.hints} (published ${out.stats.published}, outside builds ${out.stats.hintsOutsideBuilds}, refused ${out.stats.hintsRefused}); acts ${out.stats.acts} (refused ${out.stats.actsRefused}, non-spatial ${out.stats.nonSpatial}, world-only skipped ${out.stats.worldOnly}); max reticles ${out.stats.maxReticles}`);
}
if (results.length > 1) {
  const s = results.reduce((a, r) => ({ steps: a.steps + r.steps, marked: a.marked + r.marked, plans: a.plans + r.planSteps, planMarked: a.planMarked + r.planMarked }), { steps: 0, marked: 0, plans: 0, planMarked: 0 });
  console.log(`all: batches ${s.marked}/${s.steps} (${Math.round(s.marked / s.steps * 1000) / 10}%); plan steps ${s.planMarked}/${s.plans} (${Math.round(s.planMarked / s.plans * 1000) / 10}%)`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1) + '\n');
