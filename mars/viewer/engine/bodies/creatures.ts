// Creature bodies (backlog R11a): animated non-human residents — a duck, a snail, a dog. In the engine a
// creature is a rigid ground-planned body (family 'floater', type 'creature', model = species id): it routes
// with the ordinary planner at its own radius and speed, and never runs limb programs (no hands, no seat
// posture, no rides). Its look and gait are procedural and drawn by the viewer (app/engine-view/creatures.ts)
// from the sampled pose, speed and activity; nothing about the animation is engine state.
//
// What each species can do beyond the rigid core (glide-equivalent movement, settle, turn, look, follow,
// speak) is declared here once, with the plain-words reason for everything it cannot do, so the server's
// refusals are honest ("a snail has no arms to hug with") rather than generic. Pure data: no DOM, no runtime.
import type { Body } from '../world/types.ts';

export type CreatureId = 'duck' | 'snail' | 'dog';

export type CreatureSpecies = {
  id: CreatureId;
  name: string;
  /** Drawn size relative to the rig's natural model (a resident must read at the camera's closest follow distance:
   *  the duck is a big farmyard duck, the snail one of Gene's "large snails"). */
  scale: number;
  /** Footprint radius (m) the route planner and clearance checks use. */
  radius: number;
  /** Eye height above the ground pose (m); stored as the body's hoverHeight (labels, eyes, portraits read it). */
  eyeHeight: number;
  /** Walking speed (m/s) on land; never above WALK_SPEED_CAP 1.4. */
  speed: number;
  /** Swimming speed (m/s) in deep water, or null when the species does not swim. */
  swimSpeed: number | null;
  /** The word for its way of moving on land / in water, and for settling. */
  moves: string;
  swims: string | null;
  settles: string;
  /** Plain-words reasons for what it cannot do, keyed by edge verb; `hands` covers every hand action. */
  cannot: { hands: string; hug: string; sit: string; swim?: string; dance: string; ride: string };
};

const NO_HANDS = (who: string, what: string) => `${who} has no hands; ${what}`;

export const CREATURES: Readonly<Record<CreatureId, CreatureSpecies>> = Object.freeze({
  duck: {
    id: 'duck', name: 'Duck', scale: 1.5, radius: 0.33, eyeHeight: 0.54, speed: 0.6, swimSpeed: 0.8,
    moves: 'waddle', swims: 'paddle', settles: 'sits down on the ground',
    cannot: {
      hands: NO_HANDS('A duck', 'it can carry nothing and use no tools'),
      hug: 'A duck has wings, not arms, and cannot hug; it can sit beside someone or follow them',
      sit: 'A duck sits on the ground, not on seats; try settle',
      dance: 'A duck cannot dance with a partner; it can bob in place (settle) or follow someone',
      ride: 'A duck cannot ride vehicles',
    },
  },
  snail: {
    id: 'snail', name: 'Snail', scale: 2.2, radius: 0.44, eyeHeight: 0.53, speed: 0.15, swimSpeed: null,
    moves: 'slide', swims: null, settles: 'withdraws into its shell',
    cannot: {
      hands: NO_HANDS('A snail', 'it can carry nothing and use no tools'),
      hug: 'A snail has no arms to hug with; it can slide over, settle or follow someone',
      sit: 'A snail cannot sit; it withdraws into its shell instead (try settle)',
      swim: 'A snail does not swim; it would sink',
      dance: 'A snail cannot dance with a partner',
      ride: 'A snail cannot ride vehicles',
    },
  },
  dog: {
    id: 'dog', name: 'Dog', scale: 1, radius: 0.3, eyeHeight: 0.55, speed: 1.4, swimSpeed: 0.6,
    moves: 'trot', swims: 'paddle', settles: 'lies down',
    cannot: {
      hands: NO_HANDS('A dog', 'it can carry nothing and use no tools'),
      hug: 'A dog cannot hug (no arms); it can follow someone and lie down beside them',
      sit: 'A dog lies on the ground, not on seats; try settle',
      dance: 'A dog cannot dance with a partner; it can follow someone',
      ride: 'A dog cannot ride vehicles',
    },
  },
});

export const CREATURE_IDS = Object.keys(CREATURES) as CreatureId[];

export const creatureSpecies = (id: unknown): CreatureSpecies | undefined =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(CREATURES, id) ? CREATURES[id as CreatureId] : undefined;

/** The species of a body, when it is a creature. */
export function creatureOf(body: Pick<Body, 'family' | 'type' | 'model'> | null | undefined): CreatureSpecies | undefined {
  return body?.family === 'floater' && body.type === 'creature' ? creatureSpecies(body.model) : undefined;
}

/** The body a species is born with (the owner preset). */
export function creatureBody(id: CreatureId): Body {
  const s = CREATURES[id];
  return { family: 'floater', type: 'creature', model: s.id, radius: s.radius, hoverHeight: s.eyeHeight };
}

/** Eye heights allowed for creature bodies (a duck's eye is well under the floater minimum of 0.4 m). */
export const CREATURE_EYE_RANGE: readonly [number, number] = [0.1, 1.2];
