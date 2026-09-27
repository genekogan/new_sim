import * as THREE from 'three';

export const GROUND = -0.16;
export function daylightAt(hour: number) {
  const angle = ((hour - 6) / 24) * Math.PI * 2;
  const elevation = Math.sin(angle);
  return {
    direction: new THREE.Vector3(
      -Math.cos(angle),
      elevation * 0.9,
      -0.38,
    ).normalize(),
    daylight: THREE.MathUtils.smoothstep(elevation, -0.12, 0.22),
    night: 1 - THREE.MathUtils.smoothstep(elevation, -0.2, 0.06),
    warmth: 1 - THREE.MathUtils.smoothstep(elevation, 0.02, 0.55),
  };
}

/** Conservative outdoor navigation. Ground-level mesh bounds are expanded by
 * a person's radius. Diagonals may never cut through blocked cell corners. */
export class CampusPaths {
  readonly size: number;
  readonly spacing = 1;
  readonly half: number;
  readonly blocked: Uint8Array;
  constructor(boxes: THREE.Box3[], half = 60) {
    this.half = half;
    this.size = half * 2 + 1;
    this.blocked = new Uint8Array(this.size * this.size);
    for (const b of boxes) {
      if (b.max.y < GROUND + 0.3 || b.min.y > GROUND + 1.85) continue;
      const minX = Math.max(0, Math.floor(b.min.x - 0.4 + this.half)),
        maxX = Math.min(this.size - 1, Math.ceil(b.max.x + 0.4 + this.half));
      const minZ = Math.max(0, Math.floor(b.min.z - 0.4 + this.half)),
        maxZ = Math.min(this.size - 1, Math.ceil(b.max.z + 0.4 + this.half));
      for (let z = minZ; z <= maxZ; z++)
        for (let x = minX; x <= maxX; x++) this.blocked[z * this.size + x] = 1;
    }
  }
  point(id: number) {
    return new THREE.Vector3(
      (id % this.size) - this.half,
      GROUND,
      Math.floor(id / this.size) - this.half,
    );
  }
  nearest(p: THREE.Vector3, maxDistance = 6) {
    let best = -1,
      d = maxDistance * maxDistance;
    const x0 = Math.max(0, Math.floor(p.x + this.half - maxDistance)),
      x1 = Math.min(this.size - 1, Math.ceil(p.x + this.half + maxDistance));
    const z0 = Math.max(0, Math.floor(p.z + this.half - maxDistance)),
      z1 = Math.min(this.size - 1, Math.ceil(p.z + this.half + maxDistance));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const i = z * this.size + x,
          distance =
            (p.x - (x - this.half)) ** 2 + (p.z - (z - this.half)) ** 2;
        if (!this.blocked[i] && distance < d) {
          best = i;
          d = distance;
        }
      }
    return best;
  }
  /** Check sub-cell connectors too; grid routes alone cannot prevent snapping through walls. */
  clearLine(a: THREE.Vector3, b: THREE.Vector3) {
    const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.1));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(a.x + ((b.x - a.x) * i) / steps) + this.half,
        z = Math.round(a.z + ((b.z - a.z) * i) / steps) + this.half;
      if (
        x < 0 ||
        z < 0 ||
        x >= this.size ||
        z >= this.size ||
        this.blocked[z * this.size + x]
      )
        return false;
    }
    return true;
  }
  neighbors(id: number) {
    const x = id % this.size,
      z = Math.floor(id / this.size),
      out: number[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx,
          nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= this.size || nz >= this.size) continue;
        const n = nz * this.size + nx;
        if (
          this.blocked[n] ||
          (dx &&
            dz &&
            (this.blocked[z * this.size + nx] ||
              this.blocked[nz * this.size + x]))
        )
          continue;
        out.push(n);
      }
    return out;
  }
  pathTo(start: number, end: number) {
    if (start < 0 || end < 0 || this.blocked[start] || this.blocked[end])
      return [];
    // A* keeps long EUC routes from flooding the full 441×441 campus grid.
    const parent = new Int32Array(this.blocked.length).fill(-1),
      costs = new Float64Array(this.blocked.length).fill(Infinity);
    const heap: [number, number][] = [];
    const heuristic = (id: number) => {
      const dx = Math.abs((id % this.size) - (end % this.size)),
        dz = Math.abs(Math.floor(id / this.size) - Math.floor(end / this.size));
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    const push = (id: number, score: number) => {
      let i = heap.length;
      heap.push([id, score]);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][1] <= score) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = [id, score];
    };
    const pop = () => {
      const first = heap[0],
        last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let c = i * 2 + 1;
          if (c + 1 < heap.length && heap[c + 1][1] < heap[c][1]) c++;
          if (heap[c][1] >= last[1]) break;
          heap[i] = heap[c];
          i = c;
        }
        heap[i] = last;
      }
      return first;
    };
    costs[start] = 0;
    parent[start] = start;
    push(start, heuristic(start));
    while (heap.length) {
      const [id, score] = pop();
      if (score > costs[id] + heuristic(id) + 1e-9) continue;
      if (id === end) break;
      for (const next of this.neighbors(id)) {
        const diagonal =
          next % this.size !== id % this.size &&
          Math.floor(next / this.size) !== Math.floor(id / this.size);
        const cost = costs[id] + (diagonal ? Math.SQRT2 : 1);
        if (cost < costs[next]) {
          costs[next] = cost;
          parent[next] = id;
          push(next, cost + heuristic(next));
        }
      }
    }
    if (parent[end] < 0) return [];
    const path = [end];
    while (end !== start) {
      end = parent[end];
      path.push(end);
    }
    return path.reverse();
  }
  route(start: number, seed: number) {
    if (start < 0 || this.blocked[start]) return [];
    const parent = new Int32Array(this.blocked.length).fill(-1),
      queue = [start],
      candidates: number[] = [];
    parent[start] = start;
    const origin = this.point(start);
    for (let k = 0; k < queue.length; k++) {
      const n = queue[k],
        dist = this.point(n).distanceTo(origin);
      if (dist >= 6) candidates.push(n);
      if (dist > 15) continue;
      for (const next of this.neighbors(n))
        if (parent[next] === -1) {
          parent[next] = n;
          queue.push(next);
        }
    }
    if (!candidates.length) return [];
    let end = candidates[Math.abs(seed) % candidates.length];
    const path = [end];
    while (end !== start) {
      end = parent[end];
      path.push(end);
    }
    return path.reverse();
  }
}

export function campfireClearing(paths: CampusPaths) {
  let best = Infinity,
    site = -1;
  for (let i = 0; i < paths.blocked.length; i++) {
    const p = paths.point(i),
      score = (p.x - 1) ** 2 + (p.z - 23) ** 2;
    if (score >= best || score > 400) continue;
    const x = i % paths.size,
      z = Math.floor(i / paths.size);
    let clear = true;
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++)
        if (paths.blocked[(z + dz) * paths.size + x + dx] !== 0) clear = false;
    if (clear) {
      best = score;
      site = i;
    }
  }
  return site >= 0 ? paths.point(site) : null;
}
