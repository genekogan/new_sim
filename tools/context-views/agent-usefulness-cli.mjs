// Copied as eden.mjs into a fresh seat. It forwards byte-pinned served CLI
// readonly commands, logs harness telemetry, and refuses call13 before spawn.
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function validateSeatCall(args, arm) {
  const [verb, ...rest] = args;
  if (['help', 'version'].includes(verb)) { if (rest.length) throw Error('unexpected readonly CLI arguments'); return { verb }; }
  if (verb === 'context') {
    if (rest.some(arg => /[\r\n\0]/.test(arg)) || rest.length > 20) throw Error('invalid context query');
    return { verb };
  }
  if (verb !== 'views' || arm !== 'visual') throw Error('this session permits readonly context commands only');
  let original = false, detail = false, file; const refs = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--original') original = true;
    else if (rest[i] === '--detail') detail = true;
    else if (rest[i] === '--out') file = rest[++i];
    else if (rest[i].startsWith('--')) throw Error('unsupported views option');
    else refs.push(rest[i]);
  }
  if (refs.length !== 1 || !/^e_[a-z0-9]+(?:\/[A-Za-z0-9_/-]+)?$/.test(refs[0])) throw Error('select exactly one published stable ref per PNG');
  if (typeof file !== 'string' || basename(file) !== file || !/^[a-z][a-z0-9-]{0,40}\.png$/.test(file)) throw Error('PNG output must stay in the seat folder');
  if (!original && !detail) throw Error('architectural PNGs require prewarmed --detail');
  return { verb, ref: refs[0], original, detail, file };
}
function main() {
  const config = JSON.parse(readFileSync('.usefulness-session.json', 'utf8'));
  const previous = existsSync('.usefulness-calls.jsonl') ? readFileSync('.usefulness-calls.jsonl', 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  if (previous.length >= 12) throw Error('twelve readonly CLI calls exhausted');
  const args = process.argv.slice(2); let parsed;
  try {
    parsed = validateSeatCall(args, config.arm);
    if (parsed.file && !config.allowedImageRefHashes?.includes(createHash('sha256').update(`${parsed.ref}:${parsed.original}`).digest('hex')))
      throw Error('image target is outside the frozen prewarm');
  } catch (error) {
    appendFileSync('.usefulness-calls.jsonl', JSON.stringify({ at: Date.now(), call: previous.length + 1, args, denied: true, error: error.message }) + '\n'); throw error;
  }
  const downloads = previous.filter(call => call.file);
  if (parsed.file && (downloads.length >= 4 || previous.some(call => call.file === parsed.file))) throw Error('four distinct PNG downloads maximum; no overwriting');
  const source = readFileSync('eden-served.mjs');
  if (createHash('sha256').update(source).digest('hex') !== config.cliSha256) throw Error('served CLI bytes changed');
  const record = { at: Date.now(), call: previous.length + 1, args, ...parsed };
  // Write admission before executing so failures count and cannot retry for free.
  appendFileSync('.usefulness-calls.jsonl', JSON.stringify(record) + '\n');
  const result = spawnSync(process.execPath, ['eden-served.mjs', ...args], { cwd: process.cwd(), encoding: 'utf8',
    timeout: 10000, maxBuffer: 1024 * 1024, env: { ...process.env, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', CODEX_API_KEY: '' } });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  try { main(); } catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
