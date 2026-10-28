import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Op, WorldModel } from '@sim/world-compiler';
import { paintingEasel, planFinishedPainting, type ArtFailure } from './art.ts';
import { PAINTING_RENDERER, PaintingRejected, rasterizePainting, validatePainting, type Painting } from './painting.ts';

type Soul = { soulId: string; entityId: string; name: string; owner: string };
export type PaintingIntent = { target: string; binding: string; actor: string; owner: string; recipe: Painting; renderer: typeof PAINTING_RENDERER };
export type PaintingPublished = { target: string; media: string; title: string; maker: string; renderer: typeof PAINTING_RENDERER };
type Result = { accepted: boolean; seq?: number; failures?: unknown[] };
export type PaintingDeps = { model(): WorldModel; dir: string; basePath: string; worldId: string;
  /** Calls complete inside the world edit transaction; notifies receipt observers after model publication. */
  commit(ops: Op[], note: string, complete: () => void, durable: () => void): Result };
const fail = (code: string, message: string): ArtFailure => ({ ok: false, status: 409, code, message });
const digest = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const binding = (model: WorldModel, id: string): string | null => {
  const e = model.entities.get(id); if (!e) return null;
  const def = model.resolvedDef(e.def); if (!paintingEasel(def)) return null;
  // The target's full bounded entity record also catches ownership/parent/pose/def
  // changes. World pose catches an ancestor moving while the canvas stays local.
  return digest(JSON.stringify([e, def, model.worldPose(e)]));
};

export function createPaintingService(d: PaintingDeps) {
  const base = d.basePath.replace(/\/$/, '');
  if (!/^\/(?!\/)[^\s?#]*$/.test(base || '/') || base.includes('..')) throw new Error('painting basePath must be a local world path');
  return {
    prepare(soul: Soul, target: string, raw: unknown): PaintingIntent | ArtFailure {
      let recipe: Painting; try { recipe = validatePainting(raw); } catch (e) { if (e instanceof PaintingRejected) return fail(e.code, e.message); throw e; }
      const b = binding(d.model(), target); if (!b) return fail('painting.no-easel', 'This offer has no single-canvas painting easel.');
      return { target, binding: b, actor: soul.entityId, owner: soul.owner, recipe, renderer: PAINTING_RENDERER };
    },
    /** Synchronous: no other painter can interleave validation and durable commit.
     * Call only for the receipt's genuine successful program completion. */
    complete(soul: Soul, receipt: string, intent: PaintingIntent, done: (p: PaintingPublished) => void): { ok: true } | ArtFailure {
      if (intent.actor !== soul.entityId || intent.owner !== soul.owner) return fail('painting.identity-changed', 'The original Soul/body binding changed before this painting finished.');
      if (intent.renderer !== PAINTING_RENDERER) return fail('painting.renderer', 'This painting uses an unsupported renderer version.');
      const model = d.model();
      if (!intent.binding || binding(model, intent.target) !== intent.binding) return fail('painting.target-changed', 'The easel or its canvas changed while you painted; the current picture has been preserved.');
      let recipe: Painting; try { recipe = validatePainting(intent.recipe); } catch (e) { if (e instanceof PaintingRejected) return fail(e.code, e.message); throw e; }
      const publication = {worldId:d.worldId,receiptId:receipt};
      const png = rasterizePainting(recipe, publication), sha = digest(png), path = join(d.dir, `${sha}.png`), media = `${base}/art/${sha}.png`;
      const plan = planFinishedPainting(model, { kind: 'soul', id: soul.soulId, name: soul.name }, { frame: intent.target, media, title: recipe.title });
      if (!plan.ok) return plan;
      const state = (plan.ops[0] as unknown as { state: { maker: string } }).state;
      const published: PaintingPublished = { target: intent.target, media, title: recipe.title, maker: state.maker, renderer: PAINTING_RENDERER };
      // Immutable PNGs remain in the existing art store. One current pointer per
      // easel; every finished painting adds a small retained file. Identity in
      // the PNG keeps rollback cleanup independent of other world processes.
      const previous = model.entities.get(intent.target)!.state;
      const note = `painting/1 ${JSON.stringify({ receipt, target: intent.target, maker: state.maker, media, renderer: PAINTING_RENDERER, publication, recipe, previous: { media: previous?.media ?? '', title: previous?.title ?? '', maker: previous?.maker ?? '' } })}`;
      let created = false, committed = false;
      try {
        if (!existsSync(path)) {
          mkdirSync(d.dir, { recursive: true }); const tmp = `${path}.${randomUUID()}.tmp`;
          try { writeFileSync(tmp, png, { flag: 'wx' }); try { linkSync(tmp, path); created = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; } }
          finally { if (existsSync(tmp)) unlinkSync(tmp); }
        }
        const result = d.commit(plan.ops, note, () => done(published), () => { committed = true; });
        if (!result.accepted) return fail('painting.refused', 'The world refused the finished painting; the previous canvas has been preserved.');
        committed = true; return { ok: true };
      } finally {
        // A newly created output cannot survive a refused/rolled-back edit.
        // An abrupt process death between file publication and SQL COMMIT can
        // leave at most one small unreferenced PNG for that completion. Normal
        // refusals/exceptions clean it; existing immutable history is retained.
        if (created && !committed) {
          if (existsSync(path)) unlinkSync(path);
        }
      }
    },
  };
}
export type PaintingService = ReturnType<typeof createPaintingService>;
