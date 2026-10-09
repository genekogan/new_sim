import {worldThinkingBudgetV1} from './thinking-budget.ts';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = process.env;
const thinkingBudget=worldThinkingBudgetV1(env);
const worldKey = env.WORLD_KEY ?? 'toy';
if (!['toy', 'mars', 'littlemartians', 'eden'].includes(worldKey)) throw new Error('invalid WORLD_KEY');
export const config = {
  archiveTakes: env.ARCHIVE_TAKES === '1',
  r2: {account:env.R2_ACCOUNT_ID,bucket:env.R2_BUCKET,endpoint:env.R2_ENDPOINT,access:env.R2_ACCESS_KEY_ID,secret:env.R2_SECRET_ACCESS_KEY,prefix:env.R2_PREFIX??'sim'},
  worldKey,
  /** Markdown served at /skill.md (App's agent skill). Unset: edge worlds get a built-in edge stub; central worlds the legacy skill. */
  skillFile: env.EDGE_SKILL_FILE || undefined as string | undefined,
  /** Source-owned onboarding Markdown, served with the selected world's base and display name. */
  instructionsFile: (env.EDGE_INSTRUCTIONS_FILE || resolve(new URL('../../../tools/edge-skill/INSTRUCTIONS.md',import.meta.url).pathname)) as string | undefined,
  /** App's agent CLI served at /eden-agent.mjs (read per request). Unset: 404. */
  cliFile: env.EDGE_CLI_FILE || undefined as string | undefined,
  /** Who chooses Souls' actions: 'edge' (owners' own agents; the world runs no Soul mind) or 'central' (legacy brain, kept for a future NPC driver). */
  // Default 'edge'. Under node --test (NODE_TEST_CONTEXT) legacy suites keep 'central'; edge tests opt in explicitly.
  mindDriver: ((env.MIND_DRIVER ?? (env.NODE_TEST_CONTEXT ? 'central' : 'edge')) === 'central' ? 'central' : 'edge') as 'edge' | 'central',
  livingWorld: env.ENABLE_LIVING_WORLD === '1',
  worldId: env.WORLD_ID ?? (worldKey === 'toy' ? 'toy-1' : `${worldKey}-1`),
  worldPath: env.WORLD_PATH ?? `/w/${worldKey}`,
  ownerId: env.WORLD_OWNER_ID ?? (env.DEV_AUTH === '1' ? 'dev:admin' : ''),
  marsWebDir: resolve(env.MARS_WEB_DIR ?? new URL('../../../mars/viewer/dist/client', import.meta.url).pathname),
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
  budgetUsdPerDay: thinkingBudget.target,
  thinkingBudgetCeiling: thinkingBudget.ceiling,
  authorizedThinkingWorldId: thinkingBudget.authorizedWorldId,
  narratorModel: env.NARRATOR_MODEL ?? 'claude-haiku-4-5-20251001',
  compilerModel: env.COMPILER_MODEL ?? env.NARRATOR_MODEL ?? 'claude-haiku-4-5-20251001',
  talkModel: env.TALK_MODEL ?? env.NARRATOR_MODEL ?? 'claude-haiku-4-5-20251001',
  worldSeed: env.WORLD_SEED ?? 'sim-genesis-1',
  engine: (env.ENGINE === 'mars' ? 'mars' : 'toy') as 'toy' | 'mars',
  snapshotEveryTicks: Number(env.SNAPSHOT_EVERY_TICKS ?? 20 * 60 * 5),
  seedNatives: env.SEED_NATIVES !== '0',
  maxSoulsPerUser: Number(env.MAX_SOULS_PER_USER ?? 5),
  inviteRequired: env.INVITE_REQUIRED !== '0',
  build: env.BUILD_ID || (() => { try { return readFileSync(new URL('../../../BUILD', import.meta.url), 'utf8').trim(); } catch { return 'dev'; } })(),
};
mkdirSync(config.dataDir, { recursive: true });
export type Config = typeof config;
