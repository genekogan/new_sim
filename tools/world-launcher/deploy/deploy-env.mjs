// Deploy settings for the Node deploy and CDN tools: the environment first, then the untracked deploy.env at the
// repo root (SIM_DEPLOY_ENV names another file). Template: deploy.env.example. Same rules as deploy-env.sh.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEPLOY_ENV_FILE = process.env.SIM_DEPLOY_ENV || resolve(dirname(fileURLToPath(import.meta.url)), '../../../deploy.env');
let file;
function fromFile() {
  if (file) return file;
  file = {};
  if (!existsSync(DEPLOY_ENV_FILE)) return file;
  for (const line of readFileSync(DEPLOY_ENV_FILE, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!m) throw Error(`${DEPLOY_ENV_FILE}: not KEY=value: ${line}`);
    file[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return file;
}
/** The setting, or undefined. */
export const deployEnv = name => process.env[name] ?? fromFile()[name];
/** The setting, or an error naming where to set it. */
export function requireDeployEnv(name, what = name) {
  const value = deployEnv(name);
  if (!value) throw Error(`${what}: set ${name} in the environment or in ${DEPLOY_ENV_FILE} (template: deploy.env.example)`);
  return value;
}
