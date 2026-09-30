// Camera-owned adapter. No parallel activity model; reads the engine's readout.
import type { ClassroomReadout } from '../engine/activities/types.ts';
import type { WorldState } from '../engine/world/types.ts';
import type { SpatialScene } from '../engine/spatial/types.ts';
import { entityFootprint } from '../engine/spatial/service.ts';
import type { Observation } from './types.ts';
export class Observer {
  session = '';
  version = 0;
  cursor = 0;
  fingerprint = '';
  reset(session: string) {
    this.session = session;
    this.version = 0;
    this.cursor = 0;
    this.fingerprint = '';
  }
  read(
    world: WorldState,
    tick: number,
    time: number,
    scene: SpatialScene,
    activity?: ClassroomReadout,
    geometryVersion = 0,
    aspect = 16 / 9,
  ): Observation {
    const members =
      activity?.participants
        .filter((p) => p.state === 'participating')
        .map((p) => p.actor)
        .sort() ??
      Object.values(world.entities)
        .filter((e) => e.kind === 'human')
        .map((e) => e.id)
        .sort();
    const departing =
      activity?.participants
        .filter((p) => p.state === 'excluded')
        .map((p) => p.actor)
        .sort() ?? [];
    const semantic = {
      phase: activity?.phase ?? 'idle',
      speaker: activity?.floorHolder,
      presenter:
        (activity as (ClassroomReadout & { presenter?: string }) | undefined)
          ?.presenter ?? activity?.floorHolder,
      focus: activity?.attentionTarget?.actor,
      members,
      display: world.entities.screen ? 'screen' : undefined,
      departing,
    };
    const fp = JSON.stringify([semantic, geometryVersion, aspect]);
    if (fp !== this.fingerprint) {
      this.version++;
      this.cursor++;
      this.fingerprint = fp;
    }
    const subjects: Observation['subjects'] = {};
    for (const e of Object.values(world.entities).sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (e.kind === 'human') {
        const seated = e.human?.activity === 'sit';
        const height = seated ? 1.4 : 1.75;
        subjects[e.id] = {
          p: [...e.pose.p],
          yaw: e.pose.yaw,
          height,
          kind: 'human',
          points: [
            [e.pose.p[0], e.pose.p[1] + height * 0.72, e.pose.p[2]],
            [e.pose.p[0], e.pose.p[1] + height - 0.1, e.pose.p[2]],
          ],
        };
      } else if (e.kind === 'fixture') {
        const extent = entityFootprint(e);
        const height = Math.max(0.3, extent.y1 - extent.y0);
        subjects[e.id] = {
          p: [...e.pose.p],
          yaw: e.pose.yaw,
          height,
          points: [[e.pose.p[0], extent.y1 + 0.02, e.pose.p[2]]],
        };
      }
    }
    return {
      schema: 'mars-camera-observation/1',
      session: this.session,
      tick,
      time,
      aspect,
      semanticVersion: this.version,
      geometryVersion,
      eventCursor: this.cursor,
      subjects,
      activity: semantic,
      scene,
    };
  }
}
/** Exact engine entity footprints, conservatively boxed. Never move/hide them. */
export function cameraScene(
  world: WorldState,
  base: SpatialScene,
): SpatialScene {
  return {
    ...base,
    obstacles: [
      ...base.obstacles,
      ...Object.values(world.entities)
        .filter((e) => e.kind !== 'human')
        .map((e) => ({
          id: e.id,
          label: e.id,
          kind: 'fixture' as const,
          ...entityFootprint(e),
        })),
    ],
  };
}
