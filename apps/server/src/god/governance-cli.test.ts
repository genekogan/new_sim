// GOVERN (P2): the god CLI's governance commands (tools/god-skill/lib/governance.mjs, built into eden-god.mjs) against
// the real GodMode + routes on 127.0.0.1: amendments, decide (accept / decline with a reason), governance and its
// residents-decide switch (off by default).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRequestListener } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { governanceOf } from './governance.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CLI = fileURLToPath(new URL('../../../../tools/god-skill/eden-god.mjs', import.meta.url));
const SOULS: Record<string, { id: string; name: string }> = { sim_ada: { id: 's_ada', name: 'Ada' }, sim_ben: { id: 's_ben', name: 'Ben' }, sim_cy: { id: 's_cy', name: 'Cy' } };

test('god CLI: amendments lists support, decide declines only with a reason and accepts into a new version, governance flips residents-decide', async (t) => {
  const db = new Db(':memory:');
  let tick = 100;
  const god = new GodMode(db, { worldId: 'gov-cli', ownerId: 'dev:gene', tick: () => tick++, emit: () => {}, library: null });
  const app = new Hono();
  mountGodRoutes(app, {
    god, worldName: 'Gov',
    requireUser: async () => { throw new ApiError(401, 'unauthorized', 'sign in'); },
    soulFromBearer: (c: Context) => SOULS[c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''] ?? null,
    baseOf: () => 'http://127.0.0.1/w/gov', limitIp: () => {},
  } as never);
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message }, err.status as 400) : c.json({ ok: false, code: 'internal', message: String(err) }, 500));
  governanceOf(god, { residents: () => Object.values(SOULS) });
  assert.equal(god.act({ ops: [{ op: 'world', state: { constitution: '# Gov\n\nBe kind.' } }] }, 'constitution').accepted, true);
  const server = createServer(getRequestListener(app.fetch));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), 'god-gov-cli-'));
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });
  writeFileSync(join(dir, '.eden-god.json'), JSON.stringify({ world: base, token: god.mintFor({ id: 'dev:gene', role: 'user' } as never, 'test') }));
  const cli = (...args: string[]) => new Promise<{ code: number; out: string; err: string }>((res) => execFile(process.execPath, [CLI, ...args], { cwd: dir, timeout: 30_000 }, (e, out, err) => res({ code: e ? (e as any).code ?? 1 : 0, out, err })));
  const asSoul = async (token: string, path: string, body?: unknown) => (await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;

  const quiet = (await asSoul('sim_ada', '/v1/world/amendments', { text: 'Quiet after dark.', title: 'Quiet nights' })).amendment;
  const fence = (await asSoul('sim_ben', '/v1/world/amendments', { text: 'No fences on the commons.' })).amendment;
  await asSoul('sim_cy', `/v1/world/amendments/${quiet.id}/support`);

  const list = await cli('amendments');
  assert.equal(list.code, 0, list.err);
  assert.match(list.out, /^constitution v1 · 2 open amendments · residents decide: off/);
  assert.match(list.out, new RegExp(`- ${quiet.id} “Quiet nights” by Ada · support 2`));
  assert.match(list.out, /supporters: Ada, Cy/);
  assert.match(list.out, /decide <id> accept/);

  const noReason = await cli('decide', fence.id, 'decline');
  assert.notEqual(noReason.code, 0); assert.match(noReason.err, /decline needs --reason/);
  assert.equal(governanceOf(god).godView().amendments.length, 2, 'refused by the CLI: nothing reached the world');
  const bad = await cli('decide', fence.id, 'maybe');
  assert.notEqual(bad.code, 0); assert.match(bad.err, /usage: decide/);

  const declined = await cli('decide', fence.id, 'decline', '--reason', 'The commons already has a fence rule.');
  assert.equal(declined.code, 0, declined.err);
  assert.match(declined.out, new RegExp(`^declined ${fence.id} .*: The commons already has a fence rule\\.`));

  const accepted = await cli('decide', quiet.id, 'accept', '--reason', 'Agreed.');
  assert.equal(accepted.code, 0, accepted.err);
  assert.match(accepted.out, new RegExp(`^accepted ${quiet.id} “Quiet nights”: the constitution is now version 2`));
  assert.match(String(god.model.state.constitution), /## Amendment 1: Quiet nights\n\nQuiet after dark\./);
  const again = await cli('decide', quiet.id, 'decline', '--reason', 'x');
  assert.notEqual(again.code, 0); assert.match(again.err, /amendment\.closed/);

  const all = JSON.parse((await cli('amendments', '--all', '--json')).out);
  assert.deepEqual(all.amendments.map((a: any) => a.status).sort(), ['accepted', 'declined']);

  // the god's own wording, from a file
  const own = (await asSoul('sim_cy', '/v1/world/amendments', { text: 'Make it shorter.' })).amendment;
  writeFileSync(join(dir, 'new.md'), '# Gov\n\nBe kind. Quiet after dark.\n');
  const worded = await cli('decide', own.id, 'accept', '--text', 'new.md');
  assert.equal(worded.code, 0, worded.err);
  assert.equal(god.model.state.constitution, '# Gov\n\nBe kind. Quiet after dark.\n');

  const gov = await cli('governance');
  assert.equal(gov.code, 0, gov.err);
  assert.match(gov.out, /^constitution v3 · residents decide: off \(you decide; on would need 2 of 3 active residents\)/);
  assert.match(gov.out, /prayers: 0 waiting, 0 answered/);
  assert.match(gov.out, /v2 .* by god — accepted amendment “Quiet nights” \(Ada\)/);
  assert.equal(governanceOf(god).residentsDecide, false, 'reading never flips the switch');
  const wrong = await cli('governance', '--residents-decide', 'maybe');
  assert.notEqual(wrong.code, 0); assert.match(wrong.err, /on or off/);
  const on = await cli('governance', '--residents-decide', 'on');
  assert.equal(on.code, 0, on.err); assert.match(on.out, /residents decide: ON \(an amendment passes with 2 of 3/);
  assert.equal(governanceOf(god).residentsDecide, true);
  assert.match((await cli('governance', '--residents-decide', 'off')).out, /residents decide: off/);
  assert.equal(governanceOf(god).residentsDecide, false);

  const help = await cli('help');
  assert.match(help.out, /govern: amendments \[--all\] · decide <id> accept/);
  const extra = await cli('amendments', 'now');
  assert.equal(extra.code, 2); assert.match(extra.err, /amendments takes no words/);
});
