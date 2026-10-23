// GOD-ENV: the god's controls over time, weather (incl. lightning) and the land, for the god CLI.
// Thin: each verb is one call to the server, which validates, journals (undo/redo) and broadcasts.
//   time [19:30|7pm|now] [--speed h/h] [--pause] [--resume]          → POST /v1/god/env  (GET /v1/world/env to read)
//   weather [--kind storm|rain|fog|wind|cloudy|clear|auto] [--intensity 0…1] [--clouds --wind --rain --fog 0…1] [--minutes 5…360]
//   (a rain or storm ends after --minutes world minutes: default rain 90, storm 45; then the scheduled weather returns)
//   strike [--at x,z|thing]                                          → a lightning bolt there now (Souls see and hear it)
//   land <verb> …  [--preview]                                       → POST /v1/god/land
import { call, num, ok } from './state.mjs';
import { rectArea, circleArea } from './solver.mjs';

const pt = (v, what) => { if (v === undefined || v === true) return undefined; const s = String(v); if (/^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(s)) return s.split(',').map(Number); if (/^\s*-?\d/.test(s)) throw new Error(`--${what} takes x,z or a thing's name, got "${s}"`); return s; };
const json = (v, what) => { try { return JSON.parse(String(v)); } catch { throw new Error(`--${what} takes JSON like '[[x,z],[x,z]]'`); } };
const pct = (x) => `${Math.round(x * 100)}%`;

export function envText(e) {
  const w = e.weather, t = e.time;
  const sky = w.kind === 'storm' ? `thunderstorm (${pct(w.intensity)})` : `${w.kind}${w.scheduled ? ' (scheduled)' : ''}`;
  return `${t.clock ?? '?'} ${t.datetime ? t.datetime.slice(0, 10) : ''} · ${t.paused ? 'time paused' : `time ×${t.timeScale} (world hours per real hour)`} · ${sky}: clouds ${pct(w.clouds)}, rain ${pct(w.rain)}, wind ${pct(w.wind)}, fog ${pct(w.fog)}${w.lightning ? `, lightning ${pct(w.lightning)}` : ''}${e.strike ? ` · last strike ${e.strike.ago}s ago at ${e.strike.x}, ${e.strike.z}` : ''}`;
}
async function env(body, what) {
  const r = ok(await call('/v1/god/env', { body }), what);
  if (r.accepted === false) return `REFUSED: ${r.failures.map((f) => `${f.code}: ${f.detail}`).join('; ')}`;
  return `${envText(r.env)} (seq ${r.seq})`;
}

/** time [HH:MM|7pm] [--speed n] [--pause] [--resume]: no words = show the clock. */
export async function time(rest, f) {
  const body = {};
  if (rest[0] && rest[0] !== 'now') body.timeOfDay = /^\d+(\.\d+)?$/.test(rest[0]) ? Number(rest[0]) : rest.join(' ');
  if (f.speed !== undefined) body.timeScale = num(f.speed);
  if (f.pause) body.timeScale = 0;
  if (f.resume) body.timeScale = f.speed !== undefined ? num(f.speed) : 24;
  if (!Object.keys(body).length) return envText(ok(await call('/v1/world/env', { as: 'none' }), 'env'));
  return env(body, 'time');
}

/** weather [--kind k] [--intensity i] [--clouds --wind --rain --fog]: no flags = show it. Channels without a kind = manual. */
export async function weather(f) {
  const w = {};
  if (f.kind !== undefined) w.kind = String(f.kind);
  for (const k of ['intensity', 'clouds', 'wind', 'rain', 'fog']) if (f[k] !== undefined) { const x = num(f[k]); if (!(x >= 0 && x <= 1)) throw new Error(`--${k} is 0…1`); w[k] = x; }
  if (f.minutes !== undefined) { const m = num(f.minutes); if (!(m >= 5 && m <= 360)) throw new Error('--minutes is 5…360 world minutes (how long a rain or storm lasts)'); w.minutes = m; }
  if (!Object.keys(w).length) return envText(ok(await call('/v1/world/env', { as: 'none' }), 'env'));
  if (!w.kind && ['clouds', 'wind', 'rain', 'fog'].some((k) => w[k] !== undefined)) w.kind = 'manual';
  return env({ weather: w }, 'weather');
}

/** strike [--at x,z|thing]: a lightning bolt there (default: somewhere in the storm near the middle of things). */
export async function strike(f) {
  const r = ok(await call('/v1/god/strike', { body: { ...(f.at !== undefined ? { at: pt(f.at, 'at') } : {}) } }), 'strike');
  if (r.accepted === false) return `REFUSED: ${r.failures.map((x) => `${x.code}: ${x.detail}`).join('; ')}`;
  return `lightning strikes ${r.strike.x}, ${r.strike.z}${r.strike.near ? ` (by ${r.strike.near})` : ''}; thunder follows ${r.strike.delayNote} (seq ${r.seq})`;
}

const LAND_FLAGS = 'at radius amount level height peak edge step path area rect circle width depth side face steps by to toward metres bounds name preview force note group';
export const LAND_HELP = `land <verb> … [--preview] (every land edit is one undoable god edit; --preview shows what it would do)
  raise|lower|smooth|flatten --at x,z|thing [--radius m] [--amount m (smooth 0…1)] [--level m]
  knoll|hill|mountain --at x,z|thing [--height m] [--radius m] [--peak 1 round…3 alpine] [--name n]   (--path '[[x,z],…]' = a ridge/range)
  plateau|terrace --rect cx,cz,w,d | --circle cx,cz,r | --area '[[x,z],…]' [--height m | --level m | --step m]
  valley|ditch --path '[[x,z],…]' [--depth m] [--width m] [--edge m]      cliff --path '[[x,z],…]' --height m [--side 1|-1]
  move <thing> --by dx,dz | --to x,z|thing      water <pond|lake|river> --level m | --by m      extend <n|s|e|w|ne…> <metres>`;
/** land <verb> [ref|direction] [metres] … */
export async function land(rest, f) {
  const [verb, a, b] = rest;
  if (!verb) return LAND_HELP;
  const body = { verb };
  if (f.at !== undefined) body.at = pt(f.at, 'at');
  for (const k of ['radius', 'amount', 'level', 'height', 'peak', 'edge', 'step', 'width', 'depth', 'side', 'face', 'steps', 'metres']) if (f[k] !== undefined) body[k] = num(f[k]);
  if (f.path !== undefined) body.path = json(f.path, 'path');
  if (f.area !== undefined) body.area = json(f.area, 'area');
  if (f.rect !== undefined) body.area = rectArea(f.rect);
  if (f.circle !== undefined) body.area = circleArea(f.circle);
  if (f.bounds !== undefined) body.bounds = String(f.bounds).split(',').map(Number);
  if (f.to !== undefined) body.to = pt(f.to, 'to');
  if (f.by !== undefined) body.by = /,/.test(String(f.by)) ? String(f.by).split(',').map(Number) : num(f.by);
  for (const k of ['name', 'note', 'group', 'toward']) if (f[k] !== undefined) body[k] = String(f[k]);
  if (f.preview) body.preview = true; if (f.force) body.force = true;
  if (verb === 'extend') { if (a && !body.toward) body.toward = a; if (b !== undefined && body.metres === undefined) body.metres = num(b); }
  else if (a !== undefined) { if (['move', 'water'].includes(verb)) body.ref = a; else if (body.at === undefined) body.at = pt(a, 'at'); }
  const r = ok(await call('/v1/god/land', { body }), 'land');
  if (f.json) return r;
  return `${r.accepted ? '' : 'REFUSED: '}${r.says}${r.warnings?.length ? `\nwarnings: ${r.warnings.join('; ')}` : ''}`;
}
export const ENV_FLAGS = { time: 'speed pause resume', weather: 'kind intensity clouds wind rain fog minutes', strike: 'at', land: LAND_FLAGS };
export const ENV_BOOLS = ['pause', 'resume', 'preview', 'force'];
