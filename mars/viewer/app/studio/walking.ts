import * as THREE from 'three';

const EYE = 1.7,
  GROUND = -0.16,
  STEP = 0.35,
  CELL = 4;
const down = new THREE.Vector3(0, -1, 0);

/** Local mesh queries keep walking independent of campus size. Rebuild on entry
 * so moved buildings and proposed components use their current transforms. */
export class WalkingBody {
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

  private floor(position: THREE.Vector3, top: number, meshes: THREE.Mesh[]) {
    this.ray.set(new THREE.Vector3(position.x, top, position.z), down);
    this.ray.far = Math.max(0, top - GROUND + 0.01);
    const hit = this.ray.intersectObjects(meshes, false).find((h) => {
      if (!h.face) return false;
      this.normal
        .copy(h.face.normal)
        .applyNormalMatrix(
          this.normalMatrix.getNormalMatrix(h.object.matrixWorld),
        );
      return Math.abs(this.normal.y) > 0.55;
    });
    return Math.max(GROUND, hit?.point.y ?? GROUND);
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
    // Slide along walls; sample the lower body, torso and head, with clearance.
    for (const axis of ['x', 'z'] as const) {
      const delta = movement[axis];
      if (!delta) continue;
      const heading = new THREE.Vector3();
      heading[axis] = Math.sign(delta);
      let blocked = false;
      for (const height of [0.45, 1, EYE - 0.05]) {
        this.ray.set(new THREE.Vector3(p.x, p.y - EYE + height, p.z), heading);
        this.ray.far = Math.abs(delta) + 0.22;
        if (this.ray.intersectObjects(meshes, false).length) {
          blocked = true;
          break;
        }
      }
      if (!blocked) p[axis] += delta;
    }
    const oldFeet = p.y - EYE;
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
    const support = this.floor(
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
