// Soul Actions entry 43 (entry 41's finding for M04): before a hand reaches for something, the body lets an idle gesture
// go (folded arms, a hand at the hair) and only then reaches. One finite, recorded pause: the body stands as it is for
// `seconds`; viewers fade the gesture out on this record's clock, and the reach that follows starts from plain standing
// (humans.ts: a reach right after a let-go fades no gesture of its own). The record stays on the body after the pause
// (as an ended hand transfer's does) so the next reach knows it was preceded; the next let-go overwrites it.
import { z } from 'zod';
import type { ActionDef, StepResult } from '../actions/types.ts';
export type LetGoV1 = { startTick: number; seconds: number };
export const LET_GO_SECONDS = 1.1;
type Params = { actor: string; seconds?: number };
type Exec = { p: Params; t: number; seconds: number };
export const letGo: ActionDef<Params, true, Exec> = {
  verb: 'let_go_v1',
  description: 'Stand still a moment and let an idle gesture go before a hand reaches for something (recorded; no world change).',
  schema: z.object({ actor: z.string().min(1).max(80), seconds: z.number().min(0.3).max(3).optional() }).strict(),
  reservations: (_w, p) => [{ resource: 'actor:' + p.actor, mode: 'exclusive' }],
  plan(rt, p) { return rt.world.entities[p.actor]?.human ? { ok: true, program: true } : { ok: false, diagnostic: { code: 'let-go.actor', message: `${p.actor} is not a person`, subjects: [p.actor] } }; },
  start(rt, p) { const s = p.seconds ?? LET_GO_SECONDS, h = rt.world.entities[p.actor].human!; h.letGoV1 = { startTick: rt.tick, seconds: s }; return { p: structuredClone(p), t: 0, seconds: s }; },
  step(rt, ex, dt): StepResult {
    const h = rt.world.entities[ex.p.actor]?.human; if (!h) return { status: 'failed', diagnostic: { code: 'let-go.gone', message: 'The body is gone', subjects: [ex.p.actor] } };
    ex.t += dt; if (h.activity !== 'idle' && h.activity !== 'walk') h.activity = 'idle';
    return ex.t + 1e-9 >= ex.seconds ? { status: 'completed' } : { status: 'running', phase: 'letting-go' };
  },
  cancel() { return { ok: true }; },
  resumable: true,
};
