// Read-only camera plumbing; policy and semantic interpretation belong to cinematography.
import type { Diagnostic } from '../../engine/actions/types.ts';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import type { Spatial } from '../../engine/spatial/service.ts';
import type { SpatialScene, Obstacle } from '../../engine/spatial/types.ts';

type FrozenData<T> = T extends object ? { readonly [K in keyof T]: FrozenData<T[K]> } : T;
export interface LabCameraGeometry {
  readonly schema: 'mars-lab-camera-geometry/1';
  readonly scenarioEpoch: number;
  readonly epoch: number;
  /** Effective current scene, including static fixtures/components and contributed support. */
  readonly scene: FrozenData<SpatialScene>;
  readonly fixtures: readonly FrozenData<Obstacle>[];
}
function freeze<T>(data: T): FrozenData<T> {
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) freeze(value);
    Object.freeze(data);
  }
  return data as FrozenData<T>;
}
export class LabCameraGeometryCache {
  private runtime?: Runtime;
  private cached?: LabCameraGeometry;
  read(rt: Runtime, scenarioEpoch: number): LabCameraGeometry | Diagnostic {
    const spatial = rt.services.spatial as Spatial | undefined;
    if (!spatial?.sync)
      return { code: 'camera.lab.geometry-unavailable', message: 'This Lab world has no spatial scene for camera observation', subjects: ['lab-world'] };
    // Only derived spatial caches change: no authoritative entities, claims or actions.
    spatial.sync(rt.world);
    if (this.runtime === rt && this.cached?.scenarioEpoch === scenarioEpoch && this.cached.epoch === spatial.epoch) return this.cached;
    const scene = freeze(structuredClone(spatial.scene));
    const ids = new Set(Object.values(rt.world.entities).filter((e) => e.kind === 'fixture').map((e) => e.id));
    this.cached = Object.freeze({ schema: 'mars-lab-camera-geometry/1' as const, scenarioEpoch, epoch: spatial.epoch, scene, fixtures: Object.freeze(scene.obstacles.filter((o) => ids.has(o.id))) });
    this.runtime = rt;
    return this.cached;
  }
}

/** Reject the whole render request before any camera or world state changes. */
export function labCameraDiagnostic(position: number[], target: number[], fov?: number): Diagnostic | null {
  const vector = (v: number[]) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!vector(position) || !vector(target) || position.every((p, i) => p === target[i]))
    return { code: 'camera.lab.invalid-pose', message: 'Camera position and target must be distinct finite three-coordinate points', subjects: ['lab-camera'] };
  if (fov !== undefined && (!Number.isFinite(fov) || fov < 20 || fov > 80))
    return { code: 'camera.lab.invalid-fov', message: 'Lab camera FOV must be finite and between 20 and 80 degrees', subjects: ['lab-camera'] };
  return null;
}
