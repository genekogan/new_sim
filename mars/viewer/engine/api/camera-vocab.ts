// Camera sentences over the op API (LAST_MILE LM-007/008; LAST_MILE §13 ruling: the parser is its own op,
// engine_parse_camera, plus optional `sentences[]` on engine_direct_camera — SPEC:146 keeps NL out of verbs).
// The language layer itself is Codex's camera/parse.ts (imported, never changed here). This file builds its
// ParseVocab from the room's SemanticWorld (regions, assemblies, fixtures, the activities people do), applies
// an alias table (the rack phrases → the rack bay structure), and resolves every parsed subject / interior /
// look-at against that world, so an ambiguous or unknown name is a structured refusal with candidates before
// anything is compiled. Deterministic: every list is sorted; the same sentences and world give the same output.
import { resolveFixture, resolveSubject, type CameraDirection, type Named, type SemanticWorld } from '../camera/direct.ts';
import { parseSentence, type ParseVocab } from '../camera/parse.ts';
import type { Take } from '../take/types.ts';
import type { WorldState } from '../world/types.ts';

/** Phrases (normalised) that name "the racks": the parser maps them all to assembly ref 'rack bay'. */
export const RACK_ALIASES = ['rack bay', 'main pallet racks', 'main pallet rack', 'pallet racks', 'pallet rack', 'main racks', 'the racks', 'racks', 'rack'];

export type CameraAlias = { phrases: string[]; kind: 'assembly'; targets: { id: string; label: string }[]; rule: string };
export type CameraVocab = { vocab: ParseVocab; aliases: CameraAlias[]; activities: string[] };

export type ParsedSentence = { index: number; sentence: string; direction: CameraDirection; notes: string[]; subject: { kind: string; id: string; label: string; said: string } };
export type SentenceRefusal = { index: number; sentence: string; code: string; message: string; question?: string; candidates?: string[]; span?: [number, number]; details?: unknown };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const shortLabel = (l: string) => l.split(' · ')[0].trim();
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

/** Names a vocabulary list offers the parser: ids and short labels, one entry per normalised spelling. */
function names(list: Named[], opts: { labels: boolean }): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (s: string) => {
    const k = norm(s);
    if (!k || k.length > 40 || seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  for (const n of list) {
    add(n.id);
    if (opts.labels) add(shortLabel(n.label));
  }
  return out.sort((a, b) => (norm(a) < norm(b) ? -1 : norm(a) > norm(b) ? 1 : 0));
}

/** Every activity / task a person has in the take (or the world): the group vocabulary. */
export function activitiesOf(world: WorldState, take?: Take): string[] {
  const out: string[] = [];
  for (const e of Object.values(world.entities)) if (e.human?.activity) out.push(e.human.activity);
  for (const c of take?.changes ?? []) if (c[2] === 'activity' && typeof c[3] === 'string') out.push(c[3]);
  return sorted(out).filter((a) => a !== 'idle');
}

/**
 * The parser vocabulary and alias table of a SemanticWorld. The rack alias (LM-008) targets the take's rack bay
 * structures (a raised + beamed bay); with none, the scene assemblies whose label names a rack. One target → the
 * phrase resolves to it; several → a question with the candidates; none → the ordinary unknown-name refusal.
 */
export function cameraVocab(sw: SemanticWorld, activities: string[]): CameraVocab {
  const bays = sw.assemblies.filter((a) => a.source === 'take-structure' && a.names.includes('rack bay'));
  const sceneRacks = sw.assemblies.filter((a) => a.source === 'scene' && /\brack/i.test(a.label));
  const targets = (bays.length ? bays : sceneRacks).map((a) => ({ id: a.id, label: a.label }));
  const regionIds = new Set(sw.regions.map((r) => r.id));
  const rule = bays.length ? "the take's rack bay structure(s) (raised uprights + beams)" : 'scene assemblies whose name contains "rack"';
  return {
    vocab: {
      regions: names(sw.regions, { labels: true }),
      // take structures are named generically ('rack bay' / 'structure'); the alias table makes them concrete. A scene
      // assembly with a region's id is that region's building (the region already takes its height): named once, as the region
      assemblies: names(sw.assemblies.filter((a) => a.source === 'scene' && !regionIds.has(a.id)), { labels: true }),
      fixtures: names(sw.fixtures, { labels: true }),
      groups: activities,
    },
    aliases: [{ phrases: RACK_ALIASES, kind: 'assembly', targets, rule }],
    activities,
  };
}

function refusalOf(index: number, sentence: string, d: { code: string; message: string; details?: unknown }): SentenceRefusal {
  const det = (d.details ?? {}) as { question?: string; candidates?: { id: string }[] };
  return {
    index,
    sentence,
    code: d.code,
    message: d.message,
    ...(det.question ? { question: det.question } : {}),
    ...(det.candidates ? { candidates: det.candidates.map((c) => c.id) } : {}),
    ...(d.details ? { details: d.details } : {}),
  };
}

/** Parse, alias and resolve each sentence against `sw`. Directions come back with subject refs rewritten to resolved ids. */
export function parseCameraSentences(sw: SemanticWorld, sentences: string[], cv: CameraVocab): { directions: ParsedSentence[]; refusals: SentenceRefusal[] } {
  const directions: ParsedSentence[] = [];
  const refusals: SentenceRefusal[] = [];
  sentences.forEach((sentence, index) => {
    const p = parseSentence(sentence, cv.vocab);
    if (!p.ok) {
      refusals.push({ index, sentence, ...p.refusal });
      return;
    }
    const d = structuredClone(p.direction);
    const said = d.subject.ref;
    const t = d.at ?? 0;
    if (d.subject.kind === 'group') {
      const q = norm(d.subject.ref);
      if (!cv.activities.includes(q)) {
        refusals.push({
          index,
          sentence,
          code: 'camera.direct.unknown',
          message: `subject: nobody is doing '${d.subject.ref}' here — activities: ${cv.activities.join(', ') || 'none'}`,
          question: 'Which activity are the people doing?',
          candidates: cv.activities,
        });
        return;
      }
      directions.push({ index, sentence, direction: d, notes: p.notes, subject: { kind: 'group', id: q, label: `people doing ${q}`, said } });
      return;
    }
    // alias table (LM-008): "the main pallet racks" etc.
    const alias = d.subject.kind === 'assembly' ? cv.aliases.find((a) => a.phrases.includes(norm(d.subject.ref))) : undefined;
    if (alias && alias.targets.length > 1) {
      refusals.push({
        index,
        sentence,
        code: 'camera.direct.ambiguous',
        message: `subject: '${said}' names ${alias.targets.length} assemblies (${alias.rule}) — which one? ${alias.targets.map((x) => `${x.id} ('${x.label}')`).join(' | ')}`,
        question: `Which assembly is '${said}'?`,
        candidates: alias.targets.map((x) => x.id),
      });
      return;
    }
    if (alias && alias.targets.length === 1) d.subject.ref = alias.targets[0].id;
    const r = resolveSubject(sw, d.subject, t);
    if (!r.ok) {
      refusals.push(refusalOf(index, sentence, r.diagnostic));
      return;
    }
    d.subject.ref = r.subject.id;
    if (d.context?.interior) {
      const ri = resolveSubject(sw, { kind: 'region', ref: d.context.interior }, t, undefined, 'context.interior');
      if (!ri.ok) {
        refusals.push(refusalOf(index, sentence, ri.diagnostic));
        return;
      }
      d.context.interior = ri.subject.id;
    }
    if (d.context?.lookAt) {
      const within = d.context.interior ? sw.regions.find((x) => x.id === d.context!.interior)?.polygon : undefined;
      const rf = resolveFixture(sw, d.context.lookAt, within);
      if (!rf.ok) {
        refusals.push(refusalOf(index, sentence, rf.diagnostic));
        return;
      }
    }
    directions.push({ index, sentence, direction: d, notes: p.notes, subject: { kind: r.subject.kind, id: r.subject.id, label: r.subject.label, said } });
  });
  return { directions, refusals };
}
