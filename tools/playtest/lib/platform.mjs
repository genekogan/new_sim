// Platform helpers so the harness runs on the laptop (macOS) and in a cloud box (Linux): Playwright resolution,
// Chromium launch args, reclaimable memory, JPEG thumbnails. Each takes its platform/probes as injectable options.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LAPTOP_VIEWER_PKG = join(homedir(), 'Eden/sim/mars/viewer/package.json');
const which = (cmd) => { try { return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim() || null; } catch { return null; } };
const npmRootGlobal = () => { try { return execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 15000 }).trim() || null; } catch { return null; } };

/** Where to look for Playwright, in order: the global `playwright` (cloud: browsers pre-installed for that version),
 *  then the server root's mars/viewer, then the laptop viewer. → [{from, kind:'global'|'pkg', name, dir|pkg}] */
export function playwrightCandidates({ serverRoot = null, env = process.env, globalRoot = undefined } = {}) {
  const out = [];
  if (env.PLAYTEST_PLAYWRIGHT_PKG) out.push({ from: 'PLAYTEST_PLAYWRIGHT_PKG', kind: 'pkg', pkg: env.PLAYTEST_PLAYWRIGHT_PKG });
  const dirs = [...(env.NODE_PATH ?? '').split(':').filter(Boolean), globalRoot === undefined ? npmRootGlobal() : globalRoot, '/usr/lib/node_modules', '/usr/local/lib/node_modules', process.cwd()].filter(Boolean);
  for (const dir of [...new Set(dirs)]) out.push({ from: `global ${dir}`, kind: 'global', dir });
  if (serverRoot) out.push({ from: 'server root mars/viewer', kind: 'pkg', pkg: join(serverRoot, 'mars/viewer/package.json') });
  out.push({ from: 'laptop viewer', kind: 'pkg', pkg: LAPTOP_VIEWER_PKG });
  return out;
}

/** → {chromium, from, path} or null. Global candidates load `playwright`; package candidates `@playwright/test` then `playwright`. */
export function resolvePlaywright(opts = {}) {
  const req = createRequire(import.meta.url);
  for (const c of playwrightCandidates(opts)) {
    const tries = c.kind === 'global' ? [['playwright', [c.dir]]] : (existsSync(c.pkg) ? [['@playwright/test', null], ['playwright', null]] : []);
    for (const [name, paths] of tries) {
      try {
        const path = paths ? req.resolve(name, { paths }) : createRequire(c.pkg).resolve(name);
        const mod = paths ? req(path) : createRequire(c.pkg)(name);
        if (mod?.chromium) return { chromium: mod.chromium, from: c.from, name, path };
      } catch { /* next */ }
    }
  }
  return null;
}

/** PLAYWRIGHT_BROWSERS_PATH: keep a set value; else the macOS cache or /opt/pw-browsers when they exist. Returns the value. */
export function browsersPath({ env = process.env, platform = process.platform, exists = existsSync, home = homedir() } = {}) {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return env.PLAYWRIGHT_BROWSERS_PATH;
  const mac = join(home, 'Library/Caches/ms-playwright');
  if (platform === 'darwin' && exists(mac)) return (env.PLAYWRIGHT_BROWSERS_PATH = mac);
  if (exists('/opt/pw-browsers')) return (env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers');
  return null;
}

const DARWIN_GPU = {
  metal: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
const LINUX_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
/** Chromium args by platform. darwin: the scenario's gpu (metal default). linux: headless with SwiftShader GL whatever
 *  the scenario asks (no GPU in the box; root needs --no-sandbox). → {args, gpu} where gpu is what is actually used. */
export function launchArgs({ gpu = 'metal', platform = process.platform } = {}) {
  if (platform === 'linux') return { args: LINUX_ARGS, gpu: 'swiftshader' };
  const g = DARWIN_GPU[gpu] ? gpu : 'metal';
  return { args: DARWIN_GPU[g], gpu: g };
}

/** Reclaimable memory in GB: vm_stat (free+inactive+purgeable+speculative) on macOS, MemAvailable on Linux. */
export function parseVmStat(vm) {
  const page = Number(vm.match(/page size of (\d+)/)?.[1] ?? 16384);
  const pages = (k) => Number(vm.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] ?? 0);
  return Math.round((pages('Pages free') + pages('Pages inactive') + pages('Pages purgeable') + pages('Pages speculative')) * page / 1073741824 * 10) / 10;
}
export function parseMeminfo(text) { const kb = Number(text.match(/^MemAvailable:\s+(\d+)\s*kB/m)?.[1]); return Number.isFinite(kb) ? Math.round(kb / 1048576 * 10) / 10 : null; }
export function freeMemGb({ platform = process.platform } = {}) {
  try {
    if (platform === 'darwin') return parseVmStat(execFileSync('vm_stat', { encoding: 'utf8', timeout: 10000 }));
    if (platform === 'linux') return parseMeminfo(readFileSync('/proc/meminfo', 'utf8'));
  } catch { /* unknown */ }
  return null;
}

/** Which tool makes JPEGs here: sips (darwin), else ImageMagick convert/magick, else ffmpeg. */
export function imageTool({ platform = process.platform, has = which } = {}) {
  if (platform === 'darwin' && has('sips')) return 'sips';
  if (has('magick')) return 'magick';
  if (has('convert')) return 'convert';
  if (has('ffmpeg')) return 'ffmpeg';
  return null;
}
/** argv for one JPEG conversion: fit within maxDim (both sides) or maxWidth (width only), never upscale. quality 1-100. */
export function jpegArgs(tool, src, dst, { quality = 72, maxWidth = null, maxDim = null } = {}) {
  if (tool === 'sips') return ['sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), ...(maxDim ? ['-Z', String(maxDim)] : []), ...(maxWidth ? ['--resampleWidth', String(maxWidth)] : []), src, '--out', dst]];
  if (tool === 'magick' || tool === 'convert') {
    const geo = maxDim ? `${maxDim}x${maxDim}>` : maxWidth ? `${maxWidth}x>` : null;
    const pre = tool === 'magick' ? ['magick', [src]] : ['convert', [src]];
    return [pre[0], [...pre[1], ...(geo ? ['-resize', geo] : []), '-quality', String(quality), `jpg:${dst}`]];
  }
  if (tool === 'ffmpeg') {
    const q = Math.max(2, Math.min(31, Math.round(31 - (quality / 100) * 29))); // ffmpeg -q:v: 2 best .. 31 worst
    const vf = maxDim ? `scale='min(${maxDim},iw)':'min(${maxDim},ih)':force_original_aspect_ratio=decrease` : maxWidth ? `scale='min(${maxWidth},iw)':-2` : null;
    return ['ffmpeg', ['-y', '-loglevel', 'error', '-i', src, ...(vf ? ['-vf', vf] : []), '-q:v', String(q), '-frames:v', '1', dst]];
  }
  throw new Error('no image tool (sips, ImageMagick or ffmpeg)');
}
/** Pixel width (sips -g / identify / ffprobe); null when unknown. */
export function imageWidth(src, tool = imageTool()) {
  try {
    if (tool === 'sips') return Number(execFileSync('sips', ['-g', 'pixelWidth', src], { encoding: 'utf8' }).match(/pixelWidth:\s*(\d+)/)?.[1]) || null;
    if (tool === 'magick' || tool === 'convert') return Number(execFileSync(tool === 'magick' ? 'magick' : 'identify', [...(tool === 'magick' ? ['identify'] : []), '-format', '%w', src], { encoding: 'utf8' })) || null;
    return Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', src], { encoding: 'utf8' })) || null;
  } catch { return null; }
}
let cachedTool;
/** Convert src to a JPEG at dst; throws when no tool exists or the conversion fails. */
export function toJpeg(src, dst, opts = {}) {
  const tool = opts.tool ?? (cachedTool ??= imageTool());
  // sips --resampleWidth upscales; the other tools are given "shrink only" geometry
  const o = tool === 'sips' && opts.maxWidth && (imageWidth(src, tool) ?? 0) <= opts.maxWidth ? { ...opts, maxWidth: null } : opts;
  const [cmd, argv] = jpegArgs(tool, src, dst, o);
  execFileSync(cmd, argv, { stdio: 'ignore' });
  return dst;
}
