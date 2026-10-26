#!/usr/bin/env node
// Shrink a results folder for a git branch: every PNG under <dir> becomes a JPEG no wider than --width (default 1024,
// never upscaled), the PNG is removed, and text files that name `<x>.png` are rewritten to `<x>.jpg` so REPORT.md,
// evidence and story links still resolve (story.html thumbnails are inline data URIs and are unaffected).
//   node tools/playtest/cloud/compress-shots.mjs <dir> [--width 1024] [--quality 75] [--jobs 4]
import { readdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { jpegArgs, imageTool, imageWidth } from '../lib/platform.mjs';
const run = promisify(execFile);

const TEXT = /\.(md|html|json|jsonl|tsv|txt)$/;
export function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p); }
  return out;
}
/** `a/b.png` → `a/b.jpg` in text; only names that were converted (or whose .jpg already exists) are touched. */
export function rewriteRefs(text, converted) {
  return text.replace(/([\w./%-]+)\.png\b/g, (m, stem) => (converted.has(stem.split('/').pop()) ? `${stem}.jpg` : m));
}

export async function compressShots(dir, { width = 1024, quality = 75, jobs = 4, tool = imageTool() } = {}) {
  if (!tool) throw new Error('no image tool (ImageMagick convert or ffmpeg; sips on macOS)');
  const files = walk(dir);
  const pngs = files.filter((f) => f.endsWith('.png'));
  const stems = new Set(files.filter((f) => f.endsWith('.jpg')).map((f) => f.split('/').pop().slice(0, -4))); // earlier passes
  let before = 0, after = 0, i = 0, failed = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, pngs.length) }, async () => {
    while (i < pngs.length) {
      const src = pngs[i++]; const dst = src.slice(0, -4) + '.jpg';
      try { const b = statSync(src).size; const w = tool === 'sips' ? imageWidth(src, tool) : null; const [cmd, args] = jpegArgs(tool, src, dst, { quality, maxWidth: tool === 'sips' && w && w <= width ? null : width }); await run(cmd, args); before += b; after += statSync(dst).size; rmSync(src); stems.add(src.split('/').pop().slice(0, -4)); }
      catch { failed += 1; if (existsSync(dst) && existsSync(src)) rmSync(dst); }
    }
  }));
  let rewritten = 0;
  for (const f of files.filter((x) => TEXT.test(x) && existsSync(x))) {
    const t = readFileSync(f, 'utf8'); if (!t.includes('.png')) continue;
    const n = rewriteRefs(t, stems); if (n !== t) { writeFileSync(f, n); rewritten += 1; }
  }
  return { pngs: pngs.length, failed, beforeBytes: before, afterBytes: after, rewritten, tool };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2); const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? Number(argv[i + 1]) : d; };
  const dir = argv[0];
  if (!dir) { console.error('usage: compress-shots.mjs <dir> [--width 1024] [--quality 75] [--jobs 4]'); process.exit(1); }
  const r = await compressShots(dir, { width: flag('width', 1024), quality: flag('quality', 75), jobs: flag('jobs', 4) });
  console.log(JSON.stringify(r));
  process.exit(r.failed ? 1 : 0);
}
