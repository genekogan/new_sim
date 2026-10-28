import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const CODEX_RUNTIME = Object.freeze({ launcher: '/opt/homebrew/bin/codex', version: 'codex-cli 0.163.0',
  launcherRealpath: '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js',
  launcherSha256: '61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70',
  binary: '/opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
  binarySha256: '8813367285524ac798dd96d1b071aea30d58708c7226fd236cd275cf1cfdee31' });
export function pinCodexRuntime() {
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  if (realpathSync(CODEX_RUNTIME.launcher) !== CODEX_RUNTIME.launcherRealpath ||
    sha(readFileSync(CODEX_RUNTIME.launcher)) !== CODEX_RUNTIME.launcherSha256 ||
    realpathSync(CODEX_RUNTIME.binary) !== CODEX_RUNTIME.binary || sha(readFileSync(CODEX_RUNTIME.binary)) !== CODEX_RUNTIME.binarySha256)
    throw Error('reviewed Codex runtime changed; no fallback');
  // Existing adapter resolves `codex` using PATH; pin it before preflight/turn.
  process.env.PATH = '/opt/homebrew/bin:' + String(process.env.PATH ?? '').split(':').filter(path => path !== '/opt/homebrew/bin').join(':');
  return { ...CODEX_RUNTIME, availability: 'Bundled binary contains requested model label; account/API availability not established without the scheduled turn.' };
}
