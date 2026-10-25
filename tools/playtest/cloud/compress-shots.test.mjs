import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { compressShots, rewriteRefs } from './compress-shots.mjs';
import { imageTool, imageWidth } from '../lib/platform.mjs';

function png(w, h) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 90); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('rewriteRefs only touches converted names', () => {
  assert.equal(rewriteRefs('see shots/pip/1.png and logo.png', new Set(['1'])), 'see shots/pip/1.jpg and logo.png');
});

test('compressShots: PNG → ≤1024 px JPEG, PNG removed, references rewritten, rerun is a no-op', { skip: !imageTool() }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'pt-shots-'));
  mkdirSync(join(d, 'run/shots/pip'), { recursive: true });
  writeFileSync(join(d, 'run/shots/pip/10.png'), png(1280, 8));
  writeFileSync(join(d, 'run/REPORT.md'), '![x](shots/pip/10.png)');
  writeFileSync(join(d, 'run/evidence.jsonl'), '{"shot":"shots/pip/10.png"}\n');
  const r = await compressShots(d);
  assert.equal(r.pngs, 1); assert.equal(r.failed, 0); assert.equal(r.rewritten, 2);
  assert.ok(!existsSync(join(d, 'run/shots/pip/10.png')));
  assert.equal(imageWidth(join(d, 'run/shots/pip/10.jpg')), 1024);
  assert.equal(readFileSync(join(d, 'run/REPORT.md'), 'utf8'), '![x](shots/pip/10.jpg)');
  const r2 = await compressShots(d); assert.equal(r2.pngs, 0); assert.equal(r2.rewritten, 0);
});
