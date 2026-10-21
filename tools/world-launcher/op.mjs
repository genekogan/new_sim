#!/usr/bin/env node
// Operator commands for a running world launcher, from the machine it runs on (the launcher refuses them through a
// reverse proxy: only direct loopback requests are accepted). No credentials are involved or read.
//
//   node tools/world-launcher/op.mjs create-world --port 4620 [--base /worlds] --name "Little Martians (Arium)"
//        --template littlemartians-two (--owner <account id> | --owner-of <slug of a world that account owns>) [--god-name <shown name>] [--slug <slug>]
//   node tools/world-launcher/op.mjs register-fork --port 4620 [--base /worlds] --slug eden|mars|littlemartians
//        --descriptor <abs fork.json> [--accounts <abs accounts.sqlite>] [--name <shown name>]
//   node tools/world-launcher/op.mjs remove-fork --port 4620 [--base /worlds] --slug <slug>      (its data stays)
//   node tools/world-launcher/op.mjs set-claimable --port 4620 [--base /worlds] --slug <slug> --claimable false
//        (a world with no god that nobody may claim: the homepage stops saying "open it to claim it")
//   node tools/world-launcher/op.mjs set-unlisted --port 4620 [--base /worlds] --slug <slug> --unlisted true|false
//        (left out of the public world list, still served at its URL; bench worlds and "… (scratch)" names default to true)
//   node tools/world-launcher/op.mjs archive-world --port 4620 [--base /worlds] --slug <slug> [--reason <text>]
//        (stops it, moves its data to <data>/archive/<id>/world, unregisters it; nothing is deleted)
//   node tools/world-launcher/op.mjs restore-world --port 4620 [--base /worlds] --id <id from list-archive>
//   node tools/world-launcher/op.mjs list-archive --port 4620 [--base /worlds]
//   node tools/world-launcher/op.mjs audit --port 4620 [--base /worlds] [--slug <slug>]
//
// create-world: the world is born owned by that existing account (its god), exactly as if that person had created it signed in.
// register-fork: serve the copy of an old world already in <data>/worlds/<slug>/sim.db under <base>/w/<slug> (lane FORKS).
const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const cmd = argv[0];
const usage = () => {
  console.error('usage: op.mjs create-world --port <launcher port> [--base /worlds] --name <name> --template <id> (--owner <account id> | --owner-of <slug>) [--god-name <name>] [--slug <slug>]\n'
    + '       op.mjs register-fork --port <launcher port> [--base /worlds] --slug <eden|mars|littlemartians> --descriptor <abs path> [--accounts <abs path>] [--name <name>]\n'
    + '       op.mjs remove-fork --port <launcher port> [--base /worlds] --slug <slug>\n'
    + '       op.mjs set-claimable --port <launcher port> [--base /worlds] --slug <slug> --claimable true|false\n'
    + '       op.mjs set-unlisted --port <launcher port> [--base /worlds] --slug <slug> --unlisted true|false\n'
    + '       op.mjs archive-world --port <launcher port> [--base /worlds] --slug <slug> [--reason <text>]\n'
    + '       op.mjs restore-world --port <launcher port> [--base /worlds] --id <archive id>\n'
    + '       op.mjs list-archive --port <launcher port> [--base /worlds]\n'
    + '       op.mjs audit --port <launcher port> [--base /worlds] [--slug <slug>]');
  process.exit(2);
};
let body;
if (cmd === 'create-world') {
  if (!flag('port') || !flag('name') || !flag('template') || !(flag('owner') || flag('owner-of'))) usage();
  body = { name: flag('name'), template: flag('template'), ...(flag('owner') ? { owner: flag('owner') } : { ownerOf: flag('owner-of') }), ...(flag('god-name') ? { godName: flag('god-name') } : {}), ...(flag('slug') ? { slug: flag('slug') } : {}) };
} else if (cmd === 'register-fork') {
  if (!flag('port') || !flag('slug') || !flag('descriptor')) usage();
  body = { slug: flag('slug'), descriptor: flag('descriptor'), ...(flag('accounts') ? { accounts: flag('accounts') } : {}), ...(flag('name') ? { name: flag('name') } : {}) };
} else if (cmd === 'set-claimable') {
  if (!flag('port') || !flag('slug') || !['true', 'false'].includes(flag('claimable'))) usage();
  body = { slug: flag('slug'), claimable: flag('claimable') === 'true' };
} else if (cmd === 'set-unlisted') {
  if (!flag('port') || !flag('slug') || !['true', 'false'].includes(flag('unlisted'))) usage();
  body = { slug: flag('slug'), unlisted: flag('unlisted') === 'true' };
} else if (cmd === 'archive-world') {
  if (!flag('port') || !flag('slug')) usage();
  body = { slug: flag('slug'), ...(flag('reason') ? { reason: flag('reason') } : {}) };
} else if (cmd === 'restore-world') {
  if (!flag('port') || !flag('id')) usage();
  body = { id: flag('id') };
} else if (cmd === 'list-archive') {
  if (!flag('port')) usage();
  body = {};
} else if (cmd === 'audit') {
  if (!flag('port')) usage();
  body = flag('slug') ? { slug: flag('slug') } : {};
} else if (cmd === 'remove-fork') {
  if (!flag('port') || !flag('slug')) usage();
  body = { slug: flag('slug') };
} else usage();
const base = (flag('base') ?? '').replace(/\/$/, '');
const r = await fetch(`http://127.0.0.1:${Number(flag('port'))}${base}/__sim/op/${cmd}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) });
const d = await r.json().catch(() => ({}));
console.log(JSON.stringify({ status: r.status, ...d }, null, 2));
process.exit(r.ok ? 0 : 1);
