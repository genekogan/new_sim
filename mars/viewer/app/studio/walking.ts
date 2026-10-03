import * as THREE from 'three';
import { steppedAccess, type SteppedAccess } from './stepped-access.ts';

const EYE = 1.7,
  GROUND = -0.16,
  STEP = 0.35,
  CELL = 4;
const CLEARANCE = 0.22;
type AccessSurface = { height: number; lower: number; upper: number; low?: THREE.Mesh; high: THREE.Mesh; axis: THREE.Vector3; begin: number; end: number };
const down = new THREE.Vector3(0, -1, 0);

/** Local mesh queries keep walking independent of campus size. Rebuild on entry
 * so moved buildings and proposed components use their current transforms. */
export class WalkingBody {
  private accessDirection = new THREE.Vector3();
  private access = new Map<THREE.Mesh, SteppedAccess>();
  private cells = new Map<string, THREE.Mesh[]>();
  private ray = new THREE.Raycaster();
  private normal = new THREE.Vector3();
  private normalMatrix = new THREE.Matrix3();
  velocity = 0;
  grounded = false;

  readonly camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.ray.layers.enable(1);
  }

  rebuild(roots: THREE.Object3D[]) {
    this.cells.clear();
    this.access.clear();
    this.accessDirection.set(0, 0, 0);
    for (const root of roots) {
      root.updateWorldMatrix(true, true);
      root.traverseVisible((object) => {
        if (
          !(object instanceof THREE.Mesh) ||
          object.userData.kind === 'reference' ||
          object.userData.walkNoCollision
        )
          return;
        let parent: THREE.Object3D | null = object;
        while (parent) {
          if (
            parent.userData.kind === 'context_person' ||
            parent.userData.layer === 'Aerial reference'
          )
            return;
          parent = parent.parent;
        }
        const traversal = steppedAccess(object);
        if (traversal) this.access.set(object, traversal);
        const bounds = new THREE.Box3().setFromObject(object);
        const x0 = Math.floor(bounds.min.x / CELL),
          x1 = Math.floor(bounds.max.x / CELL);
        const z0 = Math.floor(bounds.min.z / CELL),
          z1 = Math.floor(bounds.max.z / CELL);
        // The CAD aerial backdrop is a visual reference, not a physical floor.
        if ((x1 - x0 + 1) * (z1 - z0 + 1) > 2500) return;
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++) {
            const key = `${x},${z}`;
            if (!this.cells.has(key)) this.cells.set(key, []);
            this.cells.get(key)!.push(object);
          }
      });
    }
  }

  private nearby(position: THREE.Vector3) {
    const meshes = new Set<THREE.Mesh>();
    const x = Math.floor(position.x / CELL),
      z = Math.floor(position.z / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        for (const mesh of this.cells.get(`${x + dx},${z + dz}`) || [])
          meshes.add(mesh);
      }
    return [...meshes];
  }

  private floorInfo(position: THREE.Vector3, top: number, meshes: THREE.Mesh[], accessWitness = false) {
    this.ray.set(new THREE.Vector3(position.x, top, position.z), down);
    this.ray.far = Math.max(0, top - GROUND + 0.01);
    const hit = this.ray.intersectObjects(meshes, false).find((h) => {
      if (!h.face) return false;
      this.normal
        .copy(h.face.normal)
        .applyNormalMatrix(
          this.normalMatrix.getNormalMatrix(h.object.matrixWorld),
        );
      return accessWitness ? this.normal.y > 0.999999 : Math.abs(this.normal.y) > 0.55;
    });
    return { height: Math.max(GROUND, hit?.point.y ?? GROUND), mesh: hit?.object instanceof THREE.Mesh ? hit.object : undefined };
  }

  private floor(position: THREE.Vector3, top: number, meshes: THREE.Mesh[]) {
    return this.floorInfo(position, top, meshes).height;
  }

  /** A short seam envelope requires actual adjacent support witnesses, never a whole-bay ramp. */
  private accessSurface(position: THREE.Vector3, feet: number, movement: THREE.Vector3, meshes: THREE.Mesh[]): AccessSurface | 'blocked' | undefined {
    if (!movement.lengthSq()) return;
    const direction = movement.clone().normalize();
    let attempted = false;
    for (const mesh of meshes) {
      const data = this.access.get(mesh);
      if (!data || data.entry) continue;
      const top = data.top + 0.001;
      const front = this.floorInfo(position.clone().addScaledVector(direction, CLEARANCE), top, meshes, true);
      if (front.mesh === mesh && front.height > feet + STEP) attempted = true;
      if (Math.abs(direction.dot(data.axis)) < 0.5) continue;
      const low = this.floorInfo(position.clone().addScaledVector(data.axis, -CLEARANCE), top, meshes, true);
      const high = this.floorInfo(position.clone().addScaledVector(data.axis, CLEARANCE), top, meshes, true);
      if (high.mesh !== mesh || high.height <= low.height + 0.001) continue;
      if (Math.abs(high.height - data.top) > data.precision) continue;
      const lower = low.mesh ? this.access.get(low.mesh) : undefined;
      if (low.mesh && (!lower || lower.id !== data.id || lower.axis.dot(data.axis) < 0.999 || Math.abs(low.height - lower.top) > lower.precision)) continue;
      const difference = high.height - low.height;
      const ascending = movement.dot(data.axis) > 0;
      const limit = ascending ? Math.min(data.maxRise, lower?.maxRise ?? data.maxRise) : Math.min(data.maxDrop, lower?.maxDrop ?? data.maxDrop);
      if (difference > limit || feet < low.height - 0.001 || feet > high.height + 0.001) continue;
      const gap = lower ? data.start - lower.end : 0;
      const gapLimit = Math.min(data.maxGap, lower?.maxGap ?? data.maxGap);
      // Overlapping physical tiers meet at the higher front, not at the
      // lower bbox end (the authored entry floor extends under the tiers).
      if (gap > gapLimit + 1e-9) continue;
      const seam = data.start;
      const along = position.dot(data.axis);
      if (along < seam - CLEARANCE || along > seam + CLEARANCE) continue;
      const fraction = (along - seam + CLEARANCE) / (2 * CLEARANCE);
      return { height: low.height + fraction * difference, lower: low.height, upper: high.height, low: low.mesh, high: mesh, axis: data.axis, begin: seam - CLEARANCE, end: seam + CLEARANCE };
    }
    return attempted ? 'blocked' : undefined;
  }

  private finishSurface(position: THREE.Vector3, surface: AccessSurface | undefined, movement: THREE.Vector3, meshes: THREE.Mesh[]) {
    if (!surface) return;
    const along = position.dot(surface.axis), delta = movement.dot(surface.axis);
    const below = delta < 0 && along < surface.begin && surface.begin - along <= -delta + 1e-9;
    const above = delta > 0 && along > surface.end && along - surface.end <= delta + 1e-9;
    if (!below && !above) return;
    const expected = below ? surface.lower : surface.upper;
    const expectedMesh = below ? surface.low : surface.high;
    const actual = this.floorInfo(position, surface.upper + 0.001, meshes, true);
    if (actual.mesh !== expectedMesh || Math.abs(actual.height - expected) > Math.max(this.access.get(surface.high)?.precision ?? 1e-6, surface.low ? this.access.get(surface.low)?.precision ?? 1e-6 : 1e-6)) return;
    // Finish on the actually witnessed endpoint instead of beginning a tiny fall.
    return { ...surface, height: expected };
  }

  private edgeHit(hit: THREE.Intersection, surface: AccessSurface | undefined) {
    if (!surface || hit.object !== surface.high || !hit.face || hit.point.y > surface.upper + 0.001) return false;
    this.normal.copy(hit.face.normal).applyNormalMatrix(this.normalMatrix.getNormalMatrix(hit.object.matrixWorld));
    // Only the actual support's vertical front/back edge during this verified seam.
    return Math.abs(this.normal.y) < 1e-6 && Math.abs(this.normal.dot(surface.axis)) > 0.999;
  }

  place() {
    const p = this.camera.position;
    p.y = this.floor(p, Math.max(p.y, EYE), this.nearby(p)) + EYE;
    this.velocity = 0;
    this.grounded = true;
  }

  jump() {
    if (this.grounded) {
      this.velocity = 5;
      this.grounded = false;
    }
  }

  step(dt: number, forward: number, right: number, sprint: boolean) {
    const p = this.camera.position;
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    direction.y = 0;
    direction.normalize();
    const strafe = new THREE.Vector3(-direction.z, 0, direction.x);
    const movement = direction
      .multiplyScalar(forward)
      .addScaledVector(strafe, right);
    if (movement.lengthSq() > 1) movement.normalize();
    movement.multiplyScalar((sprint ? 6 : 3) * dt);
    const meshes = this.nearby(p);
    let feet = p.y - EYE;
    const restingSurface = this.grounded ? this.accessSurface(p, feet, this.accessDirection, meshes) : undefined;
    let surface = restingSurface && restingSurface !== 'blocked' ? restingSurface : undefined;
    // Slide along walls; sample the lower body, torso and head, with clearance.
    for (const axis of ['x', 'z'] as const) {
      const delta = movement[axis];
      if (!delta) continue;
      const heading = new THREE.Vector3();
      heading[axis] = Math.sign(delta);
      const candidate = p.clone(); candidate[axis] += delta;
      let nextSurface = this.grounded ? this.accessSurface(candidate, feet, movement, meshes) : undefined;
      if (nextSurface === 'blocked') continue;
      if (!nextSurface && this.grounded) nextSurface = this.finishSurface(candidate, surface, movement, meshes);
      const nextFeet = nextSurface?.height ?? feet;
      let blocked = false;
      if (nextSurface) {
        this.ray.set(new THREE.Vector3(candidate.x, feet + EYE, candidate.z), new THREE.Vector3(0, 1, 0));
        this.ray.far = Math.max(0, nextSurface.upper - feet) + 0.12;
        blocked = this.ray.intersectObjects(meshes, false).length > 0;
      }
      // Thin horizontal furniture can lie between all three horizontal body
      // rays. Sweep the candidate centre's vertical body band as well, leaving
      // ordinary low steps and only this seam's actual support top admissible.
      this.ray.set(new THREE.Vector3(candidate.x, nextFeet + EYE, candidate.z), down);
      this.ray.far = Math.max(0, nextFeet + EYE - (feet + STEP));
      if (this.ray.intersectObjects(meshes, false).some(hit => {
        if (!nextSurface || !hit.face || (hit.object !== nextSurface.high && hit.object !== nextSurface.low)) return true;
        this.normal.copy(hit.face.normal).applyNormalMatrix(this.normalMatrix.getNormalMatrix(hit.object.matrixWorld));
        const expected = hit.object === nextSurface.high ? nextSurface.upper : nextSurface.lower;
        const precision = hit.object instanceof THREE.Mesh ? this.access.get(hit.object)?.precision ?? 1e-6 : 1e-6;
        return this.normal.y <= 0.999999 || Math.abs(hit.point.y - expected) > precision;
      })) blocked = true;
      for (const height of [0.45, 1, EYE - 0.05]) {
        this.ray.set(new THREE.Vector3(p.x, nextFeet + height, p.z), heading);
        this.ray.far = Math.abs(delta) + CLEARANCE;
        if (this.ray.intersectObjects(meshes, false).some(hit => !this.edgeHit(hit, nextSurface))) {
          blocked = true;
          break;
        }
      }
      if (!blocked) { p[axis] += delta; feet = nextFeet; surface = nextSurface; if (surface) this.accessDirection.copy(movement); }
    }
    const oldFeet = feet;
    this.velocity -= 14 * dt;
    let nextFeet = oldFeet + this.velocity * dt;
    if (this.velocity > 0) {
      this.ray.set(p, new THREE.Vector3(0, 1, 0));
      this.ray.far = this.velocity * dt + 0.12;
      if (this.ray.intersectObjects(meshes, false).length) {
        this.velocity = 0;
        nextFeet = oldFeet;
      }
    }
    const support = surface?.height ?? this.floor(
      p,
      oldFeet + (this.grounded ? STEP : 0.001),
      meshes,
    );
    if (this.velocity <= 0 && nextFeet <= support) {
      nextFeet = support;
      this.velocity = 0;
      this.grounded = true;
    } else this.grounded = false;
    p.y = nextFeet + EYE;
  }
}

export function attachWalking(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  roots: () => THREE.Object3D[],
  onChange: (active: boolean, locked: boolean) => void,
  beforeEnter: () => void,
  afterExit: () => void,
) {
  const body = new WalkingBody(camera),
    keys = new Set<string>();
  const look = new THREE.Euler(0, 0, 0, 'YXZ');
  let active = false,
    dragging = false,
    wasLocked = false;
  const savedPosition = new THREE.Vector3(),
    savedQuaternion = new THREE.Quaternion();
  let savedFov = 43;
  const editable = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    !!target.closest('input,textarea,select,[contenteditable="true"]');
  canvas.tabIndex = 0;
  const clear = () => {
    keys.clear();
    dragging = false;
  };
  const stop = () => {
    if (!active) return;
    active = false;
    clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    camera.position.copy(savedPosition);
    camera.quaternion.copy(savedQuaternion);
    camera.fov = savedFov;
    camera.updateProjectionMatrix();
    onChange(false, false);
    afterExit();
  };
  const start = () => {
    if (active) return;
    beforeEnter();
    savedPosition.copy(camera.position);
    savedQuaternion.copy(camera.quaternion);
    savedFov = camera.fov;
    body.rebuild(roots());
    body.place();
    look.setFromQuaternion(camera.quaternion);
    look.x = 0;
    look.z = 0;
    camera.quaternion.setFromEuler(look);
    camera.fov = 70;
    camera.updateProjectionMatrix();
    active = true;
    canvas.focus({ preventScroll: true });
    onChange(true, false);
  };
  const keydown = (event: KeyboardEvent) => {
    if (
      !active ||
      editable(event.target) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    if (event.code === 'Escape') {
      event.preventDefault();
      stop();
      return;
    }
    if (
      ![
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Space',
        'ShiftLeft',
        'ShiftRight',
      ].includes(event.code)
    )
      return;
    if (
      document.activeElement !== canvas &&
      document.pointerLockElement !== canvas
    )
      return;
    event.preventDefault();
    keys.add(event.code);
    if (event.code === 'Space' && !event.repeat) body.jump();
  };
  const keyup = (event: KeyboardEvent) => {
    keys.delete(event.code);
  };
  const pointerdown = (event: PointerEvent) => {
    if (!active || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
  };
  const pointerup = () => {
    dragging = false;
  };
  const mousemove = (event: MouseEvent) => {
    if (!active || (!dragging && document.pointerLockElement !== canvas))
      return;
    look.setFromQuaternion(camera.quaternion);
    look.y -= event.movementX * 0.002;
    look.x = THREE.MathUtils.clamp(
      look.x - event.movementY * 0.002,
      -1.48,
      1.48,
    );
    camera.quaternion.setFromEuler(look);
  };
  const lockchange = () => {
    const locked = document.pointerLockElement === canvas;
    if (wasLocked && !locked) {
      wasLocked = false;
      stop();
      return;
    }
    wasLocked = locked;
    if (active) {
      canvas.focus({ preventScroll: true });
      onChange(true, locked);
    }
  };
  const visibility = () => {
    if (document.hidden) clear();
  };
  const focusout = () => {
    keys.clear();
  };
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('pointerlockchange', lockchange);
  document.addEventListener('mousemove', mousemove);
  canvas.addEventListener('pointerdown', pointerdown);
  canvas.addEventListener('pointerup', pointerup);
  canvas.addEventListener('pointercancel', pointerup);
  canvas.addEventListener('blur', focusout);
  return {
    get active() {
      return active;
    },
    get grounded() {
      return body.grounded;
    },
    start,
    stop,
    async lock() {
      if (active && canvas.requestPointerLock) {
        try {
          await canvas.requestPointerLock();
        } catch {
          onChange(true, false);
        }
      }
      if (active) canvas.focus({ preventScroll: true });
    },
    update(dt: number) {
      if (!active || document.hidden) return;
      const f = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
      const r = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      const turn =
        Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'));
      const tilt = Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'));
      look.setFromQuaternion(camera.quaternion);
      // Fixed substeps prevent tunneling after a slow frame or a tab switch.
      let remaining = Math.min(dt, 0.1);
      while (remaining > 0) {
        const step = Math.min(remaining, 1 / 90);
        look.y += turn * 1.8 * step;
        look.x = THREE.MathUtils.clamp(
          look.x + tilt * 1.35 * step,
          -1.48,
          1.48,
        );
        camera.quaternion.setFromEuler(look);
        body.step(step, f, r, keys.has('ShiftLeft') || keys.has('ShiftRight'));
        remaining -= step;
      }
    },
    dispose() {
      stop();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('pointerlockchange', lockchange);
      document.removeEventListener('mousemove', mousemove);
      canvas.removeEventListener('pointerdown', pointerdown);
      canvas.removeEventListener('pointerup', pointerup);
      canvas.removeEventListener('pointercancel', pointerup);
      canvas.removeEventListener('blur', focusout);
    },
  };
}
