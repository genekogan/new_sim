import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const env = process.env;
export const config = {
  port: Number(env.PORT ?? 4500),
  host: env.HOST ?? '127.0.0.1',
  dataDir: resolve(env.DATA_DIR ?? './data'),
  webDir: resolve(env.WEB_DIR ?? new URL('../../web/dist', import.meta.url).pathname),
  publicUrl: (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 4500}`).replace(/\/$/, ''),
  privyAppId: env.PRIVY_APP_ID ?? '',
  privyAppSecret: env.PRIVY_APP_SECRET ?? '',
  typesafeKey: env.TYPESAFE_API_KEY || undefined,
  anthropicKey: env.ANTHROPIC_API_KEY || undefined,
  adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  brainMode: (env.BRAIN_MODE === 'fake' ? 'fake' : 'live') as 'live' | 'fake',
  budgetUsdPerDay: Number(env.BRAIN_BUDGET_USD_PER_DAY ?? 5),
  narratorModel: env.NARRATOR_MODEL ?? 'claude-haiku-4-5-20251001',
  worldSeed: env.WORLD_SEED ?? 'sim-genesis-1',
  snapshotEveryTicks: Number(env.SNAPSHOT_EVERY_TICKS ?? 20 * 60 * 5),
  seedNatives: env.SEED_NATIVES !== '0',
  maxSoulsPerUser: Number(env.MAX_SOULS_PER_USER ?? 5),
};
mkdirSync(config.dataDir, { recursive: true });
export type Config = typeof config;
