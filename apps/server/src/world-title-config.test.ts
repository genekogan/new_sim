import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import {config} from './config.ts';
import {GodMode} from './god/god.ts';

// V1 (3.2 walk): the viewer titled Eden 2026 "Eden-2026" (and LM "Little-martians-arium") from the URL slug until a late
// god-status call answered. The world's real title must be in the bootstrap config the viewer renders its first frame from.
const app = (f: ReturnType<typeof fixture>, worldKey: string, god?: GodMode) => buildApp({cfg: {...config, port: 5970, worldKey, worldPath: `/w/${worldKey}`, publicUrl: `http://127.0.0.1:5970/w/${worldKey}`, accountAuthRequired: false, webDir: '/nonexistent-title-fixture', marsWebDir: '/nonexistent-title-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, ...(god ? {god} : {}), hub: {clients: new Map(), refreshMe() {}} as never});
const cfgOf = async (a: ReturnType<typeof app>) => (await (await a.request('/v1/config', {headers: {host: '127.0.0.1:5970'}})).json()) as {worldName?: string};

test('bootstrap config carries the world title, never the slug', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:alice', tick: () => f.host.engine.world.tick, emit() {}});
  const saved = process.env.WORLD_NAME; t.after(() => { if (saved === undefined) delete process.env.WORLD_NAME; else process.env.WORLD_NAME = saved; });
  delete process.env.WORLD_NAME;
  assert.equal((await cfgOf(app(f, 'eden-2026', god))).worldName, 'Eden 2026', 'no launcher name: slug words, spaced');
  process.env.WORLD_NAME = 'Little Martians (Arium)';
  const lm = app(f, 'little-martians-arium', god);
  assert.equal((await cfgOf(lm)).worldName, 'Little Martians (Arium)', 'launcher name wins');
  const status = (await (await lm.request('/v1/god/status', {headers: {host: '127.0.0.1:5970'}})).json()) as {name: string};
  assert.equal(status.name, 'Little Martians (Arium)', 'config and god status agree');
  delete process.env.WORLD_NAME;
  assert.equal((await cfgOf(app(f, 'littlemartians'))).worldName, 'Little Martians', 'shared old world keeps its title');
  assert.equal((await cfgOf(app(f, 'mars'))).worldName, 'Mars');
});
