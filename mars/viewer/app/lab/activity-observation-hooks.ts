import { readGalleryTour } from '../../engine/activities/gallery-tour.ts';
import { readTidyTable } from '../../engine/activities/table-cleanup.ts';
import { readArtSharing } from '../../engine/activities/art-sharing.ts';
import { readGroupWarmup } from '../../engine/activities/group-warmup.ts';
import { readOpenJam } from '../../engine/activities/open-jam.ts';
import { readPurposefulRoutine } from '../../engine/activities/purposeful-routine.ts';
// Detached camera facts derived from authoritative records, never camera execution.
import type { Runtime } from '../../engine/runtime/runtime.ts';
import { entityCorners } from '../../engine/spatial/service.ts';
import { readLivingIntention } from '../../engine/activities/living-intention.ts';
import { readClassroom } from '../../engine/activities/classroom.ts';
import { readMusicGathering } from '../../engine/activities/music-gathering.ts';
import type {
  CameraActivityFact,
  CameraEntity,
} from '../../cinematography/activity-observation.ts';
export function cameraEntities(rt: Runtime): CameraEntity[] {
  const entities: CameraEntity[] = Object.values(rt.world.entities).map(
    (e) => ({
      id: e.id,
      kind: e.kind,
      pose: structuredClone(e.pose),
      ...(e.human
        ? { human: structuredClone(e.human) }
        : { corners: entityCorners(e) }),
    }),
  );
  for (const r of Object.values(rt.world.regions))
    entities.push({
      id: r.id,
      kind: 'region',
      pose: { p: [r.polygon[0]?.[0] ?? 0, 0, r.polygon[0]?.[1] ?? 0], yaw: 0 },
      corners: r.polygon.map(([x, z]) => [x, 0, z]),
    });
  return entities;
}
export function cameraActivityReadout(rt: Runtime): {
  activities: CameraActivityFact[];
} {
  const activities: CameraActivityFact[] = [];
  for (const r of rt.records.values()) {
    if (!rt.isActive(r.id)) continue;
    const p = r.params as Record<string, unknown>;
    const actors = [
      p.actor,
      p.performer,
      ...(Array.isArray(p.actors) ? p.actors : []),
    ].filter(
      (v): v is string =>
        typeof v === 'string' && rt.world.entities[v]?.kind === 'human',
    );
    let fact: CameraActivityFact = {
      id: r.id,
      actors,
      phase: r.phase ?? r.verb,
      mode: r.status,
      status: r.status,
      objects: [
        p.station,
        p.book,
        p.plant,
        p.pot,
        p.mat,
        p.displayId,
        p.item,
        p.pad,
        p.pencil,
      ].filter(
        (v): v is string =>
          typeof v === 'string' &&
          !!(rt.world.entities[v] || rt.world.regions[v]),
      ),
    };
    if (r.verb === 'living_intention') {
      const s = readLivingIntention(rt, r.id);
      if (s)
        fact = {
          ...fact,
          actors: [s.actor],
          phase: s.phase ?? r.verb,
          mode: s.mode,
          purpose: s.purpose,
          objects: s.binding
            ? [
                s.binding.params.station,
                s.binding.params.book,
                s.binding.params.plant,
                s.binding.params.mat,
                s.binding.params.pad,
                s.binding.params.pencil,
              ].filter((v): v is string => typeof v === 'string')
            : [],
          waitingReason: s.diagnostic?.message,
        };
    }
    if (r.verb === 'classroom_session') {
      const s = readClassroom(rt, r.id);
      if (s)
        fact = {
          ...fact,
          actors: s.participants
            .filter((q) => q.state === 'participating')
            .map((q) => q.actor),
          departing: s.participants
            .filter((q) => q.state === 'excluded')
            .map((q) => q.actor),
          presenter: s.presenter,
          phase: s.phase ?? r.verb,
          focus: s.floorHolder ?? s.presenter,
          waitingReason: s.waitingReason,
        };
    }
    if (r.verb === 'purposeful_routine') {
      const s = readPurposefulRoutine(rt, r.id);
      if (s)
        fact = {
          ...fact,
          phase: s.phase,
          mode: s.mode,
          focus: s.bindings.actor,
          waitingReason: s.waitingReason,
          objects:
            s.phase === 'preparation' || s.phase === 'food'
              ? [s.bindings.food.pot]
              : s.phase === 'sleep' && s.bindings.sleep
                ? [s.bindings.sleep.mat]
                : s.phase === 'work'
                  ? [s.bindings.work.station]
                  : [],
        };
    }
    if (r.verb === 'tidy_table') {
      const s = readTidyTable(rt, r.id);
      if (s) fact = { ...fact, actors: [s.actor], phase: s.phase, mode: s.mode, focus: s.actor,
        objects: s.current ? [s.current.item, s.current.from.split('#')[0], s.current.to.split('#')[0]] : s.remaining.map(q => q.item),
        waitingReason: s.waitingReason };
    }
    if (r.verb === 'gallery_tour') {
      const s = readGalleryTour(rt, r.id);
      if (s) fact = { ...fact, actors: s.members.filter(q => q.active).map(q => q.actor),
        departing: s.members.filter(q => q.state === 'left' || q.state === 'directed-away').map(q => q.actor),
        phase: r.phase ?? s.mode, mode: s.mode, focus: s.current?.floorHolder,
        objects: s.pad ? [s.pad] : [], waitingReason: s.diagnostic?.message };
    }
    if (r.verb === 'art_sharing') {
      const s = readArtSharing(rt, r.id);
      if (s) fact = { ...fact, actors: s.participants.filter(q => q.physicallyViewing).map(q => q.actor),
        departing: s.participants.filter(q => q.membership === 'left' || q.membership === 'directed-away').map(q => q.actor),
        phase: r.phase ?? r.verb, mode: s.mode, focus: s.floorHolder, objects: [s.pad],
        waitingReason: s.diagnostic?.message };
    }
    if (r.verb === 'group_warmup') {
      const s = readGroupWarmup(rt, r.id);
      if (s) fact = { ...fact, actors: s.participants.filter(q => !!q.child && rt.isActive(q.child)).map(q => q.actor),
        departing: s.participants.filter(q => q.withdrawn).map(q => q.actor),
        phase: s.phase ?? r.verb, mode: s.mode, focus: s.bindings.instructor.actor,
        waitingReason: s.diagnostic?.message };
    }
    if (r.verb === 'open_jam') {
      const s = readOpenJam(rt, r.id);
      if (s) fact = { ...fact, actors: s.bindings.rounds.map(q => q.actor),
        phase: s.phase ?? r.verb, mode: s.mode,
        focus: s.bindings.rounds[s.index]?.actor,
        objects: [s.bindings.station, s.bindings.seat.split('#')[0]],
        waitingReason: s.diagnostic?.message };
    }
    if (r.verb === 'music_gathering') {
      const s = readMusicGathering(rt, r.id);
      if (s)
        fact = {
          ...fact,
          actors: [
            s.bindings.performer,
            ...(s.music?.listeners
              .filter((q) => q.state === 'listening')
              .map((q) => q.actor) ?? []),
            ...s.dancers.filter((q) => !q.withdrawn).map((q) => q.actor),
          ],
          phase: s.phase ?? r.verb,
          mode: s.mode,
          focus: s.floorHolder,
        };
    }
    if (r.diagnostic) fact.waitingReason = r.diagnostic.message;
    if (fact.actors.length) activities.push(fact);
  }
  return structuredClone({ activities });
}
