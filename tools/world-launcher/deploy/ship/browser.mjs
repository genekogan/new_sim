// Real Chrome for the post-release walks (ship.sh): the shared Chrome lease and Playwright, as the release owner's scratch
// scripts used them (team/ops/chrome-lease.mjs, 3 slots, waits up to 45 min; Playwright from mars/viewer).
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
// SIM_CHROME_LEASE: a machine-wide lease module shared by several checkouts (optional).
const TEAM_LEASE = process.env.SIM_CHROME_LEASE || '';

/** Take a Chrome slot; returns release(). The team's shared lease when it exists, else this checkout's (same slots). */
export async function lease(label) {
  if (TEAM_LEASE && existsSync(TEAM_LEASE)) return (await import(TEAM_LEASE)).chromeLease(label);
  return (await import('../../../god-skill/lib/chrome-lease.mjs')).chromeLease(label, { waitMs: 45 * 60_000 });
}

/** Playwright's chromium: this checkout's mars/viewer, else the canonical checkout's, else SHIP_PLAYWRIGHT_FROM. */
export function chromium() {
  const bases = [process.env.SHIP_PLAYWRIGHT_FROM, resolve(ROOT, 'mars/viewer')].filter(Boolean);
  for (const b of bases) { try { return createRequire(resolve(b, 'package.json'))('@playwright/test').chromium; } catch { /* next */ } }
  throw Error(`no @playwright/test under ${bases.join(', ')} (pnpm install in mars/viewer, or set SHIP_PLAYWRIGHT_FROM)`);
}
