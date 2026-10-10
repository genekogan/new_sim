// Example harness: every example is a list of the exact CLI commands a god agent would type, run
// against a fresh world (or --world <url>), each printed with its answer, ending in `look`.
//   node tools/god-skill/examples/<name>.mjs [--port 5152] [--world <url> --identity dev:admin] [--no-look] [--keep]
// Writes examples/shots/<name>.png and examples/shots/<name>.log. Fails on any REFUSED unless the
// step expects it. Defs that the library does not have yet are defined from their generator first
// (`fallbacks`), so the examples run on any build; the log says which were stand-ins.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const CLI = resolve(here, '../eden-god.mjs');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));

/** Split a command line like a shell would (single/double quotes, no expansion). */
export function argv(line) {
  const out = []; let cur = '', q = null, any = false;
  for (const ch of line) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === "'" || ch === '"') { q = ch; any = true; continue; }
    if (/\s/.test(ch)) { if (cur || any) out.push(cur); cur = ''; any = false; continue; }
    cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}

/**
 * run(name, { fallbacks: { road: {gen:'road/1', form:'path', layer:'surface', box:[6,0.1,6]} }, steps: [cmd | {cmd, expect:'refused'|RegExp}], look: '--at x --from s' })
 */
export async function run(name, { fallbacks = {}, steps, look = '', title = name }) {
  const shots = resolve(here, 'shots'); mkdirSync(shots, { recursive: true });
  const dir = mkdtempSync(resolve(tmpdir(), `eden-god-${name}-`));
  const log = [`# example: ${title}`, ''];
  const say = (s) => { console.log(s); log.push(s); };
  let server = null;
  let world = typeof args.world === 'string' ? args.world : null;
  if (!world) {
    const { startWorld } = await import(resolve(here, '../dev-world.mjs'));
    const port = Number(args.port ?? 5152);
    const slug = `ex-${name}`.slice(0, 32);
    server = await startWorld({ slug, port, fresh: true, log: resolve(root, `.lane/${slug}.log`) });
    world = server.base;
  }
  const cli = (line, quiet) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [CLI, ...argv(line)], { cwd: dir, encoding: 'utf8', env: { ...process.env, EDEN_GOD_LOOK_PORT: process.env.EDEN_GOD_LOOK_PORT ?? '5159' }, maxBuffer: 1 << 24 });
    const out = (r.stdout + (r.stderr ? r.stderr : '')).trim();
    if (!quiet) { say(`$ eden-god ${line}`); say(out.split('\n').map((l) => '  ' + l).join('\n')); say(`  (${Date.now() - t0} ms)`); }
    return { ok: r.status === 0 && !/^REFUSED/m.test(out), status: r.status, out };
  };
  let failed = 0;
  try {
    cli(`register ${world} ${args.identity ?? 'dev:admin'}`, true);
    cli('mint', true);
    // stand-ins for defs this build's library does not have yet
    const subs = {};
    for (const [want, fb] of Object.entries(fallbacks)) {
      const found = JSON.parse(cli(`defs ${want} --json`, true).out || '[]').find((d) => d.ref.replace(/^core\//, '').replace(/@\d+$/, '') === want);
      if (found) continue;
      const def = { name: `ex-${want}`, description: `stand-in for core/${want} (example ${name})`, tags: fb.tags ?? [], form: fb.form ?? 'point', layer: fb.layer ?? 'solid', make: { kind: 'gen', gen: fb.gen, ...(fb.args ? { args: fb.args } : {}) }, size: { box: fb.box ?? [4, 1, 4], scale: [0.25, 4] }, ...(fb.anchor ? { anchor: fb.anchor } : {}), ...(fb.components ? { components: fb.components } : {}), ...(fb.params ? { params: fb.params } : {}) };
      const r = cli(`define '${JSON.stringify(def)}'`, true);
      if (!r.ok) { say(`! could not define the stand-in for ${want}: ${r.out}`); failed++; continue; }
      subs[want] = `ex-${want}@1`;
      say(`(stand-in: ${want} → ex-${want}@1 from ${fb.gen}; the library has no ${want} yet)`);
    }
    const sub = (line) => line.replace(/^(place|terrain|defs)\s+([a-z][a-z0-9-]*)(?=\s|$)/, (m, c, d) => (subs[d] ? `${c} ${subs[d]}` : m));
    const ctx = { json: (line) => JSON.parse(cli(sub(line), true).out), say };
    for (const s0 of steps) {
      const s = typeof s0 === 'function' ? await s0(ctx) : s0;
      const step = typeof s === 'string' ? { cmd: s } : s;
      const r = cli(sub(step.cmd));
      const want = step.expect;
      const good = want === 'refused' ? /REFUSED/.test(r.out) : want instanceof RegExp ? want.test(r.out) : r.ok;
      if (!good) { failed++; say(`  ✖ step failed${want ? ` (expected ${want})` : ''}`); }
    }
    if (!args['no-look']) {
      const file = resolve(shots, `${name}.png`);
      const r = cli(`look ${look} --out ${file}`);
      if (!r.ok) failed++;
    }
  } finally {
    writeFileSync(resolve(shots, `${name}.log`), log.join('\n') + '\n');
    if (server && !args.keep) server.child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
  say(failed ? `✖ ${name}: ${failed} step(s) failed` : `✔ ${name}`);
  process.exitCode = failed ? 1 : 0;
  return failed;
}
