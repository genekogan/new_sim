// Lane ERR: client error reports are deduplicated, bounded (rate, table, disk) and keep no personal data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserOf, clientErrors, scrub, scrubPath } from './client-errors.mjs';

const UA_PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const UA_DESK = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const word = (n) => { let w = ''; do { w = String.fromCharCode(97 + (n % 26)) + w; n = Math.floor(n / 26); } while (n); return w; };
const body = (o) => Buffer.from(JSON.stringify(o));
const fresh = (limits = {}, now = () => 1_800_000_000_000) => { const dir = mkdtempSync(join(tmpdir(), 'cerr-')); return { dir, ce: clientErrors({ dir, build: 'we-aaaaaaaaaaaa', limits: { flushMs: 1, ...limits }, now }) }; };

test('the four injected failures each appear once, with the page build, world and browser class', () => {
  const { ce } = fresh();
  const send = (e, ua = UA_DESK, ip = '9.9.9.9') => ce.ingest(ip, ua, body({ b: 'we-bbbbbbbbbbbb', w: 'eden-2026', e }));
  assert.deepEqual(send([{ k: 'js', m: 'Error: injected test throw', s: 'LiveWorld' }, { k: 'gl', m: 'context lost' }]), [204, null]);
  assert.deepEqual(send([{ k: 'asset', m: '404', s: 'https://sim.eden.art/worlds/w/eden-2026/assets/missing.glb?v=3' }, { k: 'ws', m: 'close 1006' }], UA_PHONE, '8.8.8.8'), [204, null]);
  send([{ k: 'js', m: 'Error: injected test throw', s: 'LiveWorld', n: 4 }], UA_DESK, '7.7.7.7');   // the same kind again
  const s = ce.summary();
  assert.equal(s.kinds, 4); assert.equal(s.newSinceRelease, 4);
  const js = s.top.find((r) => r.kind === 'js');
  assert.equal(js.count, 5); assert.equal(js.visitors, 2); assert.deepEqual(js.builds, { 'we-bbbbbbbbbbbb': 2 }); assert.deepEqual(js.worlds, { 'eden-2026': 2 });
  assert.equal(js.firstBuild, 'we-bbbbbbbbbbbb'); assert.equal(js.new, true);
  const glb = s.top.find((r) => r.kind === 'asset');
  assert.equal(glb.source, 'https://sim.eden.art/worlds/w/eden-2026/assets/missing.glb', 'query string stripped');
  assert.deepEqual(glb.browsers, { 'safari/phone': 1 });
  assert.equal(s.top.find((r) => r.kind === 'ws').message, 'close 1006');
});

test('no PII is stored: names in quotes, tokens, Clerk ids, emails, addresses, query strings and user agents are gone', () => {
  const { ce, dir } = fresh();
  const secret = ['Kwyjibo says "meet me at the well at noon, love Gene"', 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzJhYmMifQ.c2ln', 'user_2pQ7xYzAbCdEfGhIjKlMnOp', 'gene@example.com', '81.2.69.160', '?token=sk_live_abc123def456ghi789', 'session=abcd'];
  ce.ingest('81.2.69.160', UA_DESK, body({ b: 'we-x', w: 'mine', e: [
    { k: 'rej', m: `Error: failed for ${secret[2]} ${secret[3]} from ${secret[4]} ${secret[1]} ${secret[6]}`, s: 'api-request' },
    { k: 'js', m: `TypeError: ${secret[0]}`, s: 'SoulCard' },
    { k: 'res', m: 'script', s: `https://sim.eden.art/worlds/assets/x.js${secret[5]}` },
    { k: 'asset', m: '404', s: `/worlds/w/mine/v1/u/${secret[2]}/a.glb#${secret[3]}` },
  ] }));
  ce.flush();
  const stored = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n') + JSON.stringify(ce.summary());
  for (const bad of ['Kwyjibo', 'meet me', 'Gene', 'eyJ', 'user_2pQ7', 'gene@example.com', '81.2.69.160', 'sk_live', 'abcd', 'Macintosh', 'Chrome/141']) assert.ok(!stored.includes(bad), `stored data must not contain ${bad}`);
  assert.match(stored, /chrome\/desktop/);
  const rows = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['b', 'c', 'fp', 'k', 'n', 't', 'v', 'w'], 'an event row holds no text at all');
  assert.equal(scrub('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON'), 'Unexpected token \'<\', "…"... is not valid JSON');
  assert.equal(scrubPath('https://assets.eden.art/assets/36/3621c4510692b73cd6654b209ad977caa771c4a50b80b09cf27c332db67d5831.glb?x=1'), 'https://assets.eden.art/assets/36/3621c4510692b73cd6654b209ad977caa771c4a50b80b09cf27c332db67d5831.glb', 'content hashes name the asset');
  assert.equal(browserOf(UA_PHONE), 'safari/phone');
});

test('a flood stays bounded: 10k errors from one page, 10k distinct kinds from 1k addresses, oversized bodies, one address', () => {
  let t = 1_800_000_000_000; const { ce, dir } = fresh({ maxKinds: 50, logBytes: 4096 }, () => t);
  const codes = { 204: 0, 429: 0, 413: 0 };
  for (let i = 0; i < 10_000; i++) { t += 1; codes[ce.ingest('6.6.6.6', UA_DESK, body({ b: 'we-x', w: 'flood', e: [{ k: 'js', m: `boom ${i}`, s: 'x' }] }))[0]]++; }
  assert.ok(codes[204] <= 12, `one address over 10 s: burst 10 + 0.2/s, got ${codes[204]}`); assert.ok(codes[429] >= 9_988);
  for (let i = 0; i < 1_000; i++) { t += 10_000; ce.ingest(`10.0.${i >> 8}.${i & 255}`, UA_DESK, body({ b: 'we-x', w: 'flood', e: Array.from({ length: 12 }, (_, j) => ({ k: 'js', m: `distinct kind ${word(i * 12 + j)} ${'x'.repeat(300)}`, s: 'y', n: 1e9 })) })); }
  assert.equal(ce.ingest('5.5.5.5', UA_DESK, Buffer.alloc(9000, 32))[0], 413);
  ce.flush();
  const s = ce.summary({ limit: 500 });
  assert.equal(s.kinds, 50, 'the table keeps at most maxKinds');
  assert.ok(s.top.every((r) => r.count <= 1000 && r.message.length <= 160), `counts and texts capped: ${JSON.stringify(s.top[0])}`);
  assert.ok(s.stats.rate > 0 && s.stats.size === 1);
  const bytes = readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  assert.ok(readdirSync(dir).filter((f) => f.endsWith('.jsonl')).length <= 2, 'events.jsonl + one rotated file');
  assert.ok(bytes < 50 * 2_000 + 2 * 4096 + 1024, `bounded disk, got ${bytes}`);
});

test('new kinds are counted from the build that went live; a later release starts at zero and keeps old kinds old', () => {
  let t = 1_800_000_000_000; const dir = mkdtempSync(join(tmpdir(), 'cerr-'));
  const a = clientErrors({ dir, build: 'we-one', now: () => t, limits: { flushMs: 1 } });
  a.ingest('1.1.1.1', UA_DESK, body({ b: 'we-one', e: [{ k: 'js', m: 'old error', s: 'a' }] })); a.flush();
  assert.equal(a.newSinceRelease(), 1);
  t += 60_000;
  const b = clientErrors({ dir, build: 'we-two', now: () => t, limits: { flushMs: 1 } });
  assert.equal(b.newSinceRelease(), 0);
  t += 1000; b.ingest('1.1.1.2', UA_DESK, body({ b: 'we-two', e: [{ k: 'js', m: 'old error', s: 'a' }, { k: 'gl', m: 'context lost' }] }));
  assert.equal(b.newSinceRelease(), 1, 'only the context loss is new');
  const s = b.summary(); assert.equal(s.top.find((r) => r.kind === 'js').new, false); assert.deepEqual(s.top.find((r) => r.kind === 'js').builds, { 'we-one': 1, 'we-two': 1 });
  // a handover: the old generation writes after the new one read the table; the new one (nothing unsaved) re-reads it
  b.flush(); t += 1000; a.ingest('1.1.1.3', UA_DESK, body({ b: 'we-one', e: [{ k: 'arrival', m: 'not done in 60 s', s: 'snapshot' }] })); a.flush();
  assert.ok(b.summary().top.some((r) => r.kind === 'arrival'));
});

test('bad input is refused without storing anything', () => {
  const { ce } = fresh();
  assert.equal(ce.ingest('1.2.3.4', UA_DESK, Buffer.from('{nope'))[0], 400);
  assert.deepEqual(ce.ingest('1.2.3.5', UA_DESK, body({ b: '<script>', w: '../etc', e: [{ k: 'evil', m: 'x' }, 'str', null] })), [204, null]);
  assert.equal(ce.summary().kinds, 0);
});
