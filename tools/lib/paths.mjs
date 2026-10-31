// Repo-relative locations for local tools and proofs. Nothing here points outside the checkout unless an env var
// says so, so every tool runs the same on any contributor's machine or in CI.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Scratch output (screenshots, reports, local servers' data): $SIM_SCRATCH/<name>, else .local/<name> in this checkout.
export const scratchDir = (name = '') => resolve(process.env.SIM_SCRATCH || join(REPO_ROOT, '.local'), name);

// A private input that is not part of the repo: the env var's value, or a clear error naming it.
export function requiredEnvPath(name, what) {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name} to ${what}`);
  return resolve(value);
}

// The one-measurement-at-a-time claim file shared by timing-sensitive tools: SIM_MEASURE_SLOT (a machine-wide file),
// else a local one, created empty (unclaimed) on first use.
export function measureSlot() {
  const file = process.env.SIM_MEASURE_SLOT || scratchDir('MEASURE.slot');
  if (!existsSync(file)) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, ''); }
  return file;
}
