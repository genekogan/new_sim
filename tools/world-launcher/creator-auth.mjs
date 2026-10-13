import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
export function verifiedCreator(authorization, auth, publicOrigin, root) {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
  if (!token || token.length > 32768) return Promise.resolve(null);
  return new Promise((done) => {
    const child = spawn(process.execPath, [`--env-file=${resolve(auth.envFile)}`, 'tools/world-launcher/verify-creator.mjs'], {
      cwd: root, stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH,
        DEV_AUTH: '0', AUTH_PROVIDER: 'clerk', ACCOUNT_AUTH_REQUIRED: '1', ENABLE_WORLD_ENGINE: '1',
        ACCOUNT_REGISTRY_PATH: auth.registryPath, PUBLIC_URL: publicOrigin, BRAIN_MODE: 'fake',
        ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', WORLD_MODEL_BUDGET_USD: '0' } });
    let output = '', complete = false;
    const finish = (id) => { if (complete) return; complete = true; clearTimeout(timer); done(id); };
    const timer = setTimeout(() => { child.kill(); finish(null); }, 15000);
    child.stdout.on('data', (chunk) => { output += chunk; if (output.length > 1024) { child.kill(); finish(null); } });
    child.on('error', () => finish(null)); child.stdin.on('error', () => {});
    child.on('close', (code) => {
      let id = null; try { id = code === 0 ? JSON.parse(output) : null; } catch {}
      finish(typeof id === 'string' && /^acct_[a-zA-Z0-9_-]+$/.test(id) ? id : null);
    });
    child.stdin.end(token);
  });
}
