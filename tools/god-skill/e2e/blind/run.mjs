#!/usr/bin/env node
// The blind god test (spec 29 WP8): a fresh world, a folder holding only SKILL.md and eden-god.mjs as
// downloaded from that world, an owner who approves pairing (this script, through the API the panel
// uses), and a transcript of every CLI command the agent runs.
//
//   node tools/god-skill/e2e/blind/run.mjs start [--port 5156] [--run 1]   → prints the folder + the prompt
//   (an agent works in <dir>/work with only the prompt)
//   node tools/god-skill/e2e/blind/run.mjs finish <dir>                   → REPORT.md: timing, refusals, look
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorld } from '../../dev-world.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const [cmd, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };

export const PROMPTS = [
  'Mountains in the east, a lake in the west, and a river from the lake to the south edge of the world with a bridge over it.',
  'A village of six houses around a plaza with a fountain, lamps and benches.',
  'A two-floor house with a furnished bedroom upstairs.',
  'A road from the plaza to the bridge, lined with trees.',
  'Look at the village from the south and fix anything that looks wrong; then export the world.',
];

if (cmd === 'start') {
  const port = Number(opt('port', 5156)), run = opt('run', '1');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = resolve(here, `${stamp}-run${run}`), work = resolve(dir, 'work');
  mkdirSync(work, { recursive: true });
  const slug = `blind${run}`;
  const { child, base } = await startWorld({ slug, port, fresh: true, log: resolve(dir, 'server.log') });
  child.unref();
  // the files, downloaded from the world as the welcome page tells an owner to
  for (const f of ['SKILL.md', 'eden-god.mjs']) { const r = await fetch(`${base}/god/${f}`); if (!r.ok) throw new Error(`GET /god/${f}: ${r.status}`); writeFileSync(resolve(work, f), await r.text()); }
  writeFileSync(resolve(work, '.eden-god.json'), JSON.stringify({ transcript: resolve(dir, 'transcript.jsonl') }, null, 2));
  // the owner: approve any pairing request for the next 4 hours (what the panel's Approve button does)
  const approver = spawn(process.execPath, [fileURLToPath(import.meta.url), 'approve', base, '240', resolve(dir, 'approvals.log')], { detached: true, stdio: 'ignore' });
  approver.unref();
  const prompt = `You are the god of this Eden world: ${base}

Work only inside the folder ${work} (it holds SKILL.md and eden-god.mjs, downloaded from the world). Read SKILL.md first; it is everything you need. Run the CLI as \`node eden-god.mjs …\` from that folder. Pair first: \`node eden-god.mjs register ${base}\` then \`node eden-god.mjs pair\` — the owner is watching and approves within seconds.

Then do, in order, as the owner asks (before each, run \`echo "prompt N $(date +%s)" >> ${resolve(dir, 'progress.log')}\` with N = its number, and \`echo "done N $(date +%s)" >> ${resolve(dir, 'progress.log')}\` after):
${PROMPTS.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Look at your work as SKILL.md suggests (each look prints a PNG path; open it with your file-reading tool). A first look can take several minutes on this busy machine; later ones too — keep looks to a few per prompt. Export the world to world.genesis.json in the folder at the end. When done, write ${resolve(dir, 'notes.md')}: per prompt what you built, what was refused and how you resolved it, and anything in SKILL.md or the CLI that confused you or was missing. Do not read or edit any other files on this machine.`;
  writeFileSync(resolve(dir, 'prompt.md'), prompt + '\n');
  writeFileSync(resolve(dir, 'world.json'), JSON.stringify({ base, port, pid: child.pid, approver: approver.pid, startedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ dir, work, base, prompt: resolve(dir, 'prompt.md') }, null, 2));
  process.exit(0);
}

if (cmd === 'approve') {
  const [base, minutes, logFile] = rest;
  const until = Date.now() + Number(minutes) * 60_000;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/v1/god/pairings`, { headers: { authorization: 'Bearer dev:admin' } });
      if (r.ok) for (const p of (await r.json()).pending ?? []) {
        const a = await fetch(`${base}/v1/god/pair/approve`, { method: 'POST', headers: { authorization: 'Bearer dev:admin', 'content-type': 'application/json' }, body: JSON.stringify({ code: p.code }) });
        appendFileSync(logFile, `${new Date().toISOString()} approved ${p.code} (${p.agent}) → ${a.status}\n`);
      }
    } catch { /* world restarting */ }
    await new Promise((res) => setTimeout(res, 2000));
  }
  process.exit(0);
}

if (cmd === 'finish') {
  const dir = resolve(rest[0]);
  const w = JSON.parse(readFileSync(resolve(dir, 'world.json'), 'utf8'));
  const tr = existsSync(resolve(dir, 'transcript.jsonl')) ? readFileSync(resolve(dir, 'transcript.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const progress = existsSync(resolve(dir, 'progress.log')) ? readFileSync(resolve(dir, 'progress.log'), 'utf8').trim().split('\n').map((l) => l.split(' ')) : [];
  const t = (kind, n) => Number(progress.find((x) => x[0] === kind && x[1] === String(n))?.[2]) * 1000 || null;
  const rows = PROMPTS.map((p, i) => {
    const a = t('prompt', i + 1), b = t('done', i + 1);
    const cmds = tr.filter((x) => a && Date.parse(x.at) >= a && (!b || Date.parse(x.at) <= b + 1000));
    const refused = cmds.filter((x) => /REFUSED/.test(x.out ?? '') || x.error);
    return { n: i + 1, prompt: p, minutes: a && b ? +((b - a) / 60000).toFixed(1) : null, commands: cmds.length, refused: refused.length, refusals: refused.map((x) => `${x.cmd} → ${(x.error ?? x.out).split('\n')[0].slice(0, 200)}`) };
  });
  const looks = tr.filter((x) => x.cmd.startsWith('look') && /look: /.test(x.out ?? '')).map((x) => /look: (\S+)/.exec(x.out)[1]);
  const last = looks.at(-1);
  if (last && existsSync(last)) copyFileSync(last, resolve(dir, 'final-look.png'));
  const exported = existsSync(resolve(dir, 'work/world.genesis.json'));
  const md = [`# Blind god test — ${dir.split('/').pop()}`, '', `world ${w.base}, started ${w.startedAt}; ${tr.length} CLI commands, ${tr.filter((x) => /REFUSED/.test(x.out ?? '') || x.error).length} refused or failed, ${looks.length} looks; export ${exported ? 'written' : 'MISSING'}.`, '',
    '| # | prompt | min | commands | refused |', '|---|---|---:|---:|---:|', ...rows.map((r) => `| ${r.n} | ${r.prompt} | ${r.minutes ?? '—'} | ${r.commands} | ${r.refused} |`), '',
    '## Refusals and errors', ...rows.flatMap((r) => r.refusals.map((x) => `- (${r.n}) ${x}`)), '', '## Looks', ...looks.map((l) => `- ${l}`), last ? `\nFinal look: ${resolve(dir, 'final-look.png')}` : '', '',
    existsSync(resolve(dir, 'notes.md')) ? '## The agent\'s notes\n\n' + readFileSync(resolve(dir, 'notes.md'), 'utf8') : '(no notes.md)'].join('\n');
  writeFileSync(resolve(dir, 'REPORT.md'), md + '\n');
  for (const pid of [w.pid, w.approver]) try { process.kill(pid); } catch { /* gone */ }
  console.log(md.split('\n').slice(0, 14).join('\n'));
  console.log(`\nREPORT: ${resolve(dir, 'REPORT.md')}`);
  void readdirSync; void root;
  process.exit(0);
}

console.error('usage: run.mjs start [--port 5156] [--run n] | finish <dir>');
process.exit(2);
