// Joining an entity world (lane P2, GENE-DECISIONS §3): the world's ONE skill and who lives here.
//
//   GET /SKILL.md          the install skill for this world: God mode + Soul mode, each readable alone
//                          (tools/world-skill/SKILL.md with this world's base URL and name filled in)
//   GET /v1/world/souls    the Souls who live here (public: names and where their bodies are)
//
// Joining itself uses the existing owner flow (POST /v1/souls, POST /v1/souls/:id/pair → code,
// POST /v1/agent/pair): the world page's "Join this world as a Soul" drives it for the signed-in person.
import type { Context, Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError } from '../souls.ts';

export type JoinDeps = {
  worldName: string;
  baseOf: (c: Context) => string;
  /** Where agents get the Soul CLI: this world's /eden-agent.mjs when it serves one, else the published copy. */
  soulCliUrl: (c: Context) => string;
  /** Live Souls in this world, oldest first. */
  souls: () => { id: string; entity_id: string; name: string; created_at: number; token_last_used: number | null }[];
  /** Where a body is now (its entity in the god model), when it has one. */
  poseOf?: (entityId: string) => { x: number; y: number; z: number } | null;
  /** LINK: the Soul's self-authored public `now` line, when it has one. */
  nowOf?: (soulId: string) => { text: string; at: number } | null;
};

const skillFile = resolve(new URL('../../../../tools/world-skill/SKILL.md', import.meta.url).pathname);
/** A world name is the creator's text: keep it to plain words so it cannot break the skill's frontmatter or markup. */
export const safeWorldName = (name: string, fallback = 'this world') => name.replace(/[^\p{L}\p{N} '.,!&()-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback;
/** The Soul CLI everyone installs (Codex's, published; CODEX-STATUS §5). */
export const PUBLISHED_SOUL_CLI = 'https://sim.eden.art/w/eden/eden-agent.mjs';
export const worldSkill = (text: string, base: string, worldName: string, soulCli = PUBLISHED_SOUL_CLI) => text.replaceAll('{{BASE}}', base).replaceAll('{{WORLD}}', safeWorldName(worldName)).replaceAll('{{SOUL_CLI}}', soulCli);

export function mountJoinRoutes(app: Hono, d: JoinDeps) {
  const skill = (c: Context) => {
    let text: string;
    try { text = readFileSync(skillFile, 'utf8'); } catch { throw new ApiError(404, 'not-found', 'this server has no world skill'); }
    return c.body(worldSkill(text, d.baseOf(c), d.worldName, d.soulCliUrl(c)), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache' });
  };
  app.get('/SKILL.md', skill);
  app.get('/v1/world/souls', (c) => {
    const ACTIVE_MS = 10 * 60_000, now = Date.now();
    const souls = d.souls().map((s) => {
      const p = d.poseOf?.(s.entity_id) ?? null;
      return { id: s.id, entityId: s.entity_id, name: s.name, since: s.created_at, active: !!s.token_last_used && now - s.token_last_used < ACTIVE_MS, ...(p ? { p: [p.x, p.y, p.z] } : {}), now: d.nowOf?.(s.id) ?? null };
    });
    return c.json({ souls }, 200, { 'cache-control': 'no-store' });
  });
}
