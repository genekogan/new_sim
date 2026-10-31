#!/usr/bin/env node
// Hosts proof media (clips, images, logs, proof.json) for a PR, so the PR links it and the repo never stores it.
//
//   node tools/proof/upload.mjs --pr <n> [--repo owner/name] [--proof <proof.json>] [--dry-run] [--json] <file>...
//
// Targets:
//   default   a GitHub release named `proofs` (a prerelease on tag `proofs`, created on first use), through `gh api`.
//             Release asset names cannot hold "/", so the logical name `pr-<n>/<file>` is stored as `pr-<n>.<file>`.
//   SIM_PROOF_UPLOAD_URL (+ SIM_PROOF_UPLOAD_TOKEN)
//             any endpoint that takes `PUT <url>/pr-<n>/<file>` with `Authorization: Bearer <token>` and answers
//             with JSON `{ "url": ... }` or a Location header; otherwise the public link is
//             `${SIM_PROOF_PUBLIC_URL || SIM_PROOF_UPLOAD_URL}/pr-<n>/<file>`. For a future CDN endpoint.
//
// An existing name is never overwritten: a re-take gets `-2`, `-3`, ... so earlier (failed) takes stay linkable.
// With --proof, each uploaded file's url is written into proof.json `media[]` (matched by file name; new media get
// an entry to complete), then proof.json itself is uploaded last and its link printed: that is the link for the PR.
//
// When the upload is blocked (no gh, not signed in, no permission, no network: common in cloud sessions) it exits 3
// and says so. Then tell the user where the files are and ask them to attach them; never commit media to get
// around it, and never push it to another branch.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const RELEASE_TAG = 'proofs';
const MAX_BYTES = 2 * 1024 ** 3, WARN_BYTES = 100 * 1024 ** 2;
export const TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.json': 'application/json', '.txt': 'text/plain', '.log': 'text/plain', '.md': 'text/markdown', '.html': 'text/html',
};
export const contentType = file => TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
export const kindOf = file => /^video\//.test(contentType(file)) ? 'video' : /^image\//.test(contentType(file)) ? 'image' : 'file';

export class Blocked extends Error {}
const BLOCKED = /HTTP 40[134]|Resource not accessible|not logged|gh auth login|authentication|Could not resolve host|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|proxy|tunnel|ENOENT/i;

export const safeName = s => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
export const logicalName = (pr, file) => `pr-${pr}/${safeName(basename(file))}`;
export const releaseAssetName = (pr, file) => logicalName(pr, file).replace('/', '.');

/** `name`, or `name-2.ext`, `name-3.ext`, ... the first one not in `taken`. */
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const ext = extname(name), stem = name.slice(0, name.length - ext.length);
  for (let i = 2; ; i++) if (!taken.has(`${stem}-${i}${ext}`)) return `${stem}-${i}${ext}`;
}

/** Refuses media that is (or is about to be) committed; warns when it sits in the tree without being ignored. */
export function checkLocal(files, git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), root = ROOT) {
  const problems = [], warnings = [];
  for (const f of files) {
    if (!existsSync(f)) { problems.push(`${f}: no such file`); continue; }
    const size = statSync(f).size;
    if (size > MAX_BYTES) problems.push(`${f}: ${(size / 1024 ** 3).toFixed(1)} GiB is over the 2 GiB asset limit`);
    else if (size > WARN_BYTES) warnings.push(`${f}: ${(size / 1024 ** 2).toFixed(0)} MB; consider a shorter clip`);
    const rel = relative(root, resolve(f));
    if (rel.startsWith('..')) continue;
    let tracked = false, ignored = false;
    try { git('ls-files', '--error-unmatch', '--', rel); tracked = true; } catch { /* untracked */ }
    if (tracked) { problems.push(`${rel}: tracked by git; proof media must not be committed (git rm --cached, keep it under .e2e/)`); continue; }
    try { git('check-ignore', '-q', '--', rel); ignored = true; } catch { /* not ignored */ }
    if (!ignored) warnings.push(`${rel}: inside the repo and not gitignored; keep proof media under .e2e/ so it cannot be committed`);
  }
  return { problems, warnings };
}

// ── targets ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** GitHub release target through `gh api`. `run(args, opts)` returns stdout; injected in tests. */
export function githubTarget({ repo, run, dryRun = false }) {
  const gh = (args, input) => {
    try { return run(['api', ...args], input); } catch (e) {
      const msg = `${e.stderr ?? ''} ${e.message ?? ''}`.trim();
      throw BLOCKED.test(msg) ? new Blocked(`gh api ${args[0] === '-X' ? args.slice(0, 3).join(' ') : args[0]}: ${msg.split('\n')[0]}`) : e;
    }
  };
  let release = null, taken = null;
  const ensure = () => {
    if (release) return release;
    try { release = JSON.parse(gh([`repos/${repo}/releases/tags/${RELEASE_TAG}`])); }
    catch (e) {
      if (!(e instanceof Blocked) || !/404|Not Found/i.test(e.message)) throw e;
      if (dryRun) { release = { id: 0, assets: [] }; taken = new Set(); return release; }
      release = JSON.parse(gh(['-X', 'POST', `repos/${repo}/releases`, '-f', `tag_name=${RELEASE_TAG}`, '-f', `name=${RELEASE_TAG}`,
        '-F', 'prerelease=true', '-f', 'make_latest=false',
        '-f', 'body=Proof media for pull requests (clips, images, proof.json), uploaded by tools/proof/upload.mjs. Assets are named pr-<n>.<file>. Not a release of the software.']));
    }
    return release;
  };
  return {
    name: `GitHub release "${RELEASE_TAG}" on ${repo}`,
    upload(pr, file) {
      const rel = ensure();
      if (!taken) taken = new Set(JSON.parse(gh([`repos/${repo}/releases/${rel.id}/assets?per_page=100`, '--paginate', '--slurp'])).flat().map(a => a.name));
      const name = uniqueName(releaseAssetName(pr, file), taken);
      taken.add(name);
      if (dryRun) return { name, url: `https://github.com/${repo}/releases/download/${RELEASE_TAG}/${name}`, dryRun: true };
      const out = JSON.parse(gh(['-X', 'POST', `https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`,
        '-H', `Content-Type: ${contentType(file)}`, '--input', file]));
      return { name, url: out.browser_download_url };
    },
  };
}

/** Generic HTTP PUT target (SIM_PROOF_UPLOAD_URL). */
export function httpTarget({ url, token, publicUrl, fetchImpl = fetch, read = readFileSync, dryRun = false }) {
  const base = url.replace(/\/+$/, ''), pub = (publicUrl || url).replace(/\/+$/, '');
  const taken = new Set();
  return {
    name: `upload endpoint ${new URL(base).host}`,
    async upload(pr, file) {
      const name = uniqueName(logicalName(pr, file), taken);
      taken.add(name);
      if (dryRun) return { name, url: `${pub}/${name}`, dryRun: true };
      let res;
      try {
        res = await fetchImpl(`${base}/${name}`, { method: 'PUT', body: read(file), headers: { 'Content-Type': contentType(file), 'If-None-Match': '*', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
      } catch (e) { throw new Blocked(`PUT ${new URL(base).host}: ${e.message}`); }
      if (res.status === 412) { taken.add(name); return this.upload(pr, file); }
      if ([401, 403, 404, 407].includes(res.status)) throw new Blocked(`PUT ${new URL(base).host}: HTTP ${res.status}`);
      if (!res.ok) throw Error(`PUT ${name}: HTTP ${res.status}`);
      let link = res.headers?.get?.('location');
      try { const j = await res.json(); if (j?.url) link = j.url; } catch { /* no JSON body */ }
      return { name, url: link || `${pub}/${name}` };
    },
  };
}

export function pickTarget({ env = process.env, repo, run, fetchImpl, dryRun }) {
  if (env.SIM_PROOF_UPLOAD_URL) return httpTarget({ url: env.SIM_PROOF_UPLOAD_URL, token: env.SIM_PROOF_UPLOAD_TOKEN, publicUrl: env.SIM_PROOF_PUBLIC_URL, fetchImpl, dryRun });
  if (!repo) throw new Blocked('no repository: pass --repo owner/name (or set GITHUB_REPOSITORY)');
  return githubTarget({ repo, run, dryRun });
}

/** Writes uploaded links into proof.json media[] (by file name); returns the updated object. */
export function linkMedia(proof, uploaded) {
  const media = Array.isArray(proof.media) ? proof.media : [];
  for (const u of uploaded) {
    const file = basename(u.file);
    const entry = media.find(m => m.file && basename(m.file) === file);
    if (entry) entry.url = u.url;
    else media.push({ file, url: u.url, kind: kindOf(file), ...(kindOf(file) === 'video' ? { uncut: null, realSpeed: null, seconds: null, viewport: null } : {}), caption: '' });
  }
  return { ...proof, media };
}

export async function uploadAll({ pr, files, proofPath = null, target, read = readFileSync, write = writeFileSync }) {
  const uploaded = [];
  for (const file of files) uploaded.push({ file, ...(await target.upload(pr, file)) });
  let proofLink = null;
  if (proofPath) {
    const proof = linkMedia(JSON.parse(read(proofPath, 'utf8')), uploaded);
    write(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
    const r = await target.upload(pr, proofPath);
    proofLink = r.url;
    uploaded.push({ file: proofPath, ...r });
  }
  return { uploaded, proofLink };
}

export function blockedMessage({ reason, files, pr, proofPath }) {
  const all = [...files, ...(proofPath ? [proofPath] : [])];
  return [
    `Proof upload blocked: ${reason}`,
    'Nothing was uploaded and nothing was committed. The proof stays where it is:',
    ...all.map(f => `  ${resolve(f)}`),
    'Next: tell the user the upload is blocked and where these files are. They can drag the clips into the PR description',
    `(GitHub hosts them), or run from a machine with access: node tools/proof/upload.mjs --pr ${pr}${proofPath ? ` --proof ${proofPath}` : ''} ${files.join(' ')}`,
    'Mark the Proof section "pending upload" with each clip\'s duration, viewport and commit. Never commit media to work around this.',
  ].join('\n');
}

function repoFromGit() {
  try {
    const u = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(u)?.[1] ?? null;
  } catch { return null; }
}

async function main(argv) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const valued = new Set(['--pr', '--repo', '--proof']);
  const files = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
  const pr = opt('--pr'), proofPath = opt('--proof') ?? null, dryRun = argv.includes('--dry-run');
  if (!pr || !/^\d+$/.test(pr) || (!files.length && !proofPath)) {
    console.error('usage: upload.mjs --pr <n> [--repo owner/name] [--proof proof.json] [--dry-run] [--json] <file>...');
    return 2;
  }
  const local = checkLocal([...files, ...(proofPath ? [proofPath] : [])]);
  for (const w of local.warnings) console.error(`warn: ${w}`);
  if (local.problems.length) { for (const p of local.problems) console.error(`error: ${p}`); return 1; }
  const repo = opt('--repo') ?? process.env.GITHUB_REPOSITORY ?? repoFromGit();
  const run = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  try {
    const target = pickTarget({ repo, run, dryRun });
    console.error(`${dryRun ? 'dry run: would upload' : 'uploading'} ${files.length + (proofPath ? 1 : 0)} file(s) to ${target.name}`);
    const out = await uploadAll({ pr: Number(pr), files, proofPath, target, write: dryRun ? () => {} : writeFileSync });
    if (argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
    else {
      for (const u of out.uploaded) console.log(`${u.url}  (${basename(u.file)})`);
      if (out.proofLink) console.log(`\nproof.json for the PR's Proof section: ${out.proofLink}`);
    }
    return 0;
  } catch (e) {
    if (e instanceof Blocked) { console.error(blockedMessage({ reason: e.message, files, pr, proofPath })); return 3; }
    throw e;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
