#!/usr/bin/env node
// Operator commands for a running world launcher, from the machine it runs on (the launcher refuses them through a
// reverse proxy: only direct loopback requests are accepted). No credentials are involved or read.
//
//   node tools/world-launcher/op.mjs create-world --port 4620 [--base /worlds] --name "Little Martians (Arium)"
//        --template littlemartians-two (--owner <account id> | --owner-of <slug of a world that account owns>) [--god-name <shown name>]
//
// The world is born owned by that existing account (its god), exactly as if that person had created it signed in.
const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const cmd = argv[0];
if (cmd !== 'create-world' || !flag('port') || !flag('name') || !flag('template') || !(flag('owner') || flag('owner-of'))) {
  console.error('usage: op.mjs create-world --port <launcher port> [--base /worlds] --name <name> --template <id> (--owner <account id> | --owner-of <slug>) [--god-name <name>]');
  process.exit(2);
}
const base = (flag('base') ?? '').replace(/\/$/, '');
const body = { name: flag('name'), template: flag('template'), ...(flag('owner') ? { owner: flag('owner') } : { ownerOf: flag('owner-of') }), ...(flag('god-name') ? { godName: flag('god-name') } : {}) };
const r = await fetch(`http://127.0.0.1:${Number(flag('port'))}${base}/__sim/op/create-world`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
const d = await r.json().catch(() => ({}));
console.log(JSON.stringify({ status: r.status, ...d }, null, 2));
process.exit(r.ok ? 0 : 1);
