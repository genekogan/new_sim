import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';

/** Minimal RGB PNG (w×h, grey). */
function png(w, h) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 128); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
import { launchArgs, browsersPath, parseVmStat, parseMeminfo, imageTool, jpegArgs, playwrightCandidates, resolvePlaywright, toJpeg, imageWidth } from './platform.mjs';
import { quota, quotaAllows } from './quota.mjs';
import { marsWebDir } from '../arena/provision.mjs';

test('launch args: darwin keeps the scenario gpu, linux is SwiftShader headless without sandbox', () => {
  assert.equal(launchArgs({ platform: 'darwin' }).gpu, 'metal');
  assert.ok(launchArgs({ platform: 'darwin', gpu: 'metal' }).args.includes('--use-angle=metal'));
  assert.equal(launchArgs({ platform: 'darwin', gpu: 'swiftshader' }).gpu, 'swiftshader');
  const l = launchArgs({ platform: 'linux', gpu: 'metal' });
  assert.equal(l.gpu, 'swiftshader');
  for (const a of ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader']) assert.ok(l.args.includes(a), a);
  assert.ok(!l.args.includes('--use-angle=metal'));
});

test('browsers path: set value kept; macOS cache only when it exists; /opt/pw-browsers on linux', () => {
  assert.equal(browsersPath({ env: { PLAYWRIGHT_BROWSERS_PATH: '/x' }, platform: 'darwin', exists: () => true }), '/x');
  const e1 = {}; assert.equal(browsersPath({ env: e1, platform: 'darwin', exists: () => false, home: '/h' }), null); assert.equal(e1.PLAYWRIGHT_BROWSERS_PATH, undefined);
  const e2 = {}; assert.equal(browsersPath({ env: e2, platform: 'darwin', exists: (p) => p === '/h/Library/Caches/ms-playwright', home: '/h' }), '/h/Library/Caches/ms-playwright');
  const e3 = {}; assert.equal(browsersPath({ env: e3, platform: 'linux', exists: (p) => p === '/opt/pw-browsers', home: '/h' }), '/opt/pw-browsers');
});

test('memory: vm_stat reclaimable pages and /proc/meminfo MemAvailable', () => {
  const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                               65536.\nPages active:  1.\nPages inactive:                           65536.\nPages speculative:                            0.\nPages purgeable:                          131072.\n';
  assert.equal(parseVmStat(vm), 4);
  assert.equal(parseMeminfo('MemTotal:       15728640 kB\nMemFree:  100 kB\nMemAvailable:   12582912 kB\n'), 12);
  assert.equal(parseMeminfo('nothing'), null);
});

test('image tool order and argv: sips on darwin, ImageMagick then ffmpeg elsewhere', () => {
  const has = (set) => (c) => (set.includes(c) ? `/bin/${c}` : null);
  assert.equal(imageTool({ platform: 'darwin', has: has(['sips', 'convert']) }), 'sips');
  assert.equal(imageTool({ platform: 'linux', has: has(['sips', 'convert', 'ffmpeg']) }), 'convert');
  assert.equal(imageTool({ platform: 'linux', has: has(['ffmpeg']) }), 'ffmpeg');
  assert.equal(imageTool({ platform: 'linux', has: has([]) }), null);
  assert.deepEqual(jpegArgs('convert', 'a.png', 'b.jpg', { quality: 60, maxWidth: 1024 }), ['convert', ['a.png', '-resize', '1024x>', '-quality', '60', 'jpg:b.jpg']]);
  assert.deepEqual(jpegArgs('sips', 'a.png', 'b.jpg', { quality: 60, maxDim: 640 })[1], ['-s', 'format', 'jpeg', '-s', 'formatOptions', '60', '-Z', '640', 'a.png', '--out', 'b.jpg']);
  const ff = jpegArgs('ffmpeg', 'a.png', 'b.jpg', { quality: 72, maxWidth: 640 });
  assert.equal(ff[0], 'ffmpeg'); assert.ok(ff[1].includes("scale='min(640,iw)':-2"));
  assert.throws(() => jpegArgs(null, 'a', 'b'));
});

test('toJpeg converts a PNG with the local tool, shrinking only', { skip: !imageTool() }, () => {
  const d = mkdtempSync(join(tmpdir(), 'pt-plat-'));
  writeFileSync(join(d, 'a.png'), png(2000, 10));
  toJpeg(join(d, 'a.png'), join(d, 'a.jpg'), { quality: 70, maxWidth: 1024 });
  assert.ok(existsSync(join(d, 'a.jpg')) && statSync(join(d, 'a.jpg')).size > 0);
  assert.equal(imageWidth(join(d, 'a.jpg')), 1024);
  toJpeg(join(d, 'a.jpg'), join(d, 'b.jpg'), { quality: 70, maxWidth: 2048 });
  assert.equal(imageWidth(join(d, 'b.jpg')), 1024);
  for (const t of ['convert', 'ffmpeg'].filter((x) => imageTool({ platform: 'linux', has: (c) => (c === x ? x : null) }) === x)) { try { toJpeg(join(d, 'a.png'), join(d, `${t}.jpg`), { tool: t, quality: 60, maxWidth: 640 }); assert.equal(imageWidth(join(d, `${t}.jpg`), t === 'convert' ? 'convert' : 'ffmpeg'), 640, t); } catch (e) { if (!/ENOENT/.test(e.message)) throw e; } }
});

test('playwright candidates: override, globals, server root, laptop; resolution finds one on this machine', () => {
  const c = playwrightCandidates({ serverRoot: '/srv', env: { PLAYTEST_PLAYWRIGHT_PKG: '/p/package.json', NODE_PATH: '/np' }, globalRoot: '/g' });
  assert.equal(c[0].from, 'PLAYTEST_PLAYWRIGHT_PKG');
  assert.deepEqual(c.filter((x) => x.kind === 'global').slice(0, 2).map((x) => x.dir), ['/np', '/g']);
  assert.ok(c.findIndex((x) => x.from === 'server root mars/viewer') < c.findIndex((x) => x.from === 'laptop viewer'));
  assert.ok(c.findIndex((x) => x.kind === 'global') < c.findIndex((x) => x.from === 'server root mars/viewer'));
  const pw = resolvePlaywright();
  if (pw) assert.equal(typeof pw.chromium.launch, 'function');
});

test('quota: skipped with a note when usage.py is absent, and allowed', async () => {
  const q = await quota({ usagePy: '/nonexistent/usage.py' });
  assert.equal(q.skipped, true); assert.match(q.note, /skipped/);
  assert.equal(quotaAllows(q).allowed, true); assert.match(quotaAllows(q).note, /skipped/);
});

test('mars web overlay: env, laptop, ../mars-web beside the server root, then .lane', () => {
  const d = mkdtempSync(join(tmpdir(), 'pt-ov-'));
  const kit = (dir) => { mkdirSync(join(dir, 'modular/humanoid'), { recursive: true }); writeFileSync(join(dir, 'modular/humanoid/kit.json'), '{}'); };
  mkdirSync(join(d, 'server')); const home = join(d, 'home');
  assert.equal(marsWebDir(join(d, 'server'), { env: {}, home }), join(d, 'server/.lane/mars-web'));
  kit(join(d, 'mars-web')); assert.equal(marsWebDir(join(d, 'server'), { env: {}, home }), join(d, 'mars-web'));
  kit(join(home, 'Eden/team/playtest/mars-web')); assert.equal(marsWebDir(join(d, 'server'), { env: {}, home }), join(home, 'Eden/team/playtest/mars-web'));
  kit(join(d, 'env')); assert.equal(marsWebDir(join(d, 'server'), { env: { PLAYTEST_MARS_WEB: join(d, 'env') }, home }), join(d, 'env'));
});
