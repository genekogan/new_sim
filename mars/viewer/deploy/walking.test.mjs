import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WalkingBody, attachWalking } from '../app/studio/walking.ts';

function setup(meshes = []) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.54, 0);
  const body = new WalkingBody(camera);
  body.rebuild(meshes);
  body.place();
  return { camera, body };
}
function tick(body, frames = 90, f = 0, r = 0, sprint = false) {
  for (let i = 0; i < frames; i++) body.step(1 / 90, f, r, sprint);
}
function box(w, h, d, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.position.set(x, y, z);
  return mesh;
}

test('walking speed is frame independent; diagonal input is normalized; sprint is faster', () => {
  const a = setup(),
    b = setup(),
    c = setup();
  tick(a.body, 90, 1);
  tick(b.body, 90, 1, 1);
  tick(c.body, 90, 1, 0, true);
  assert.ok(Math.abs(a.camera.position.z + 3) < 1e-6);
  assert.ok(
    Math.abs(Math.hypot(b.camera.position.x, b.camera.position.z) - 3) < 1e-6,
  );
  assert.ok(Math.abs(c.camera.position.z + 6) < 1e-6);
  const d = setup();
  for (let i = 0; i < 60; i++) d.body.step(1 / 60, 1, 0, false);
  assert.ok(d.camera.position.distanceTo(a.camera.position) < 1e-6);
});
test('jump leaves the ground, cannot double-jump, and lands at eye height', () => {
  const { body, camera } = setup();
  body.jump();
  tick(body, 15);
  assert.ok(camera.position.y > 2);
  const velocity = body.velocity;
  body.jump();
  assert.equal(body.velocity, velocity);
  tick(body, 120);
  assert.ok(Math.abs(camera.position.y - 1.54) < 1e-6);
  assert.ok(body.grounded);
});
test('wall blocks walking; low stairs can be climbed; moving geometry rebuilds collisions', () => {
  const wall = box(5, 4, 0.1, 0, 2, -2),
    a = setup([wall]);
  tick(a.body, 180, 1);
  assert.ok(a.camera.position.z > -1.8);
  wall.position.x = 20;
  a.body.rebuild([wall]);
  tick(a.body, 90, 1);
  assert.ok(a.camera.position.z < -4);
  const step = box(4, 0.25, 3, 0, -0.035, -2),
    b = setup([step]);
  tick(b.body, 60, 1);
  assert.ok(Math.abs(b.camera.position.y - 1.79) < 0.01);
});
test('floors support walking and ceilings stop upward jumps', () => {
  const floor = box(5, 0.1, 5, 0, 1, 0),
    a = setup([floor]);
  a.camera.position.y = 3;
  a.body.place();
  assert.ok(Math.abs(a.camera.position.y - 2.75) < 1e-6);
  const ceiling = box(5, 0.1, 5, 0, 2.1, 0),
    b = setup([ceiling]);
  b.body.jump();
  let peak = 0;
  for (let i = 0; i < 90; i++) {
    tick(b.body, 1);
    peak = Math.max(peak, b.camera.position.y);
  }
  assert.ok(peak < 2.1);
  assert.ok(b.body.grounded);
});
test('keyboard controls respect input focus, clear held keys on blur, and restore the orbit view', () => {
  class Element extends EventTarget {
    editable = false;
    tabIndex = -1;
    closest() {
      return this.editable ? this : null;
    }
    focus() {
      document.activeElement = this;
    }
    setPointerCapture() {}
  }
  globalThis.HTMLElement = Element;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  document.hidden = false;
  document.pointerLockElement = null;
  const canvas = new Element(),
    input = new Element();
  input.editable = true;
  const camera = new THREE.PerspectiveCamera(43);
  camera.position.set(10, 15, 10);
  const original = camera.position.clone();
  const controls = attachWalking(
    camera,
    canvas,
    () => [],
    () => {},
    () => {},
    () => {},
  );
  const send = (type, code, target = canvas) => {
    const e = new Event(type, { cancelable: true });
    Object.defineProperties(e, {
      code: { value: code },
      target: { value: target },
    });
    window.dispatchEvent(e);
    return e;
  };
  controls.start();
  send('keydown', 'KeyW');
  controls.update(0.1);
  send('keyup', 'KeyW');
  assert.ok(camera.position.z < 10);
  input.focus();
  const before = camera.position.clone();
  assert.equal(send('keydown', 'KeyW', input).defaultPrevented, false);
  controls.update(0.1);
  assert.ok(camera.position.distanceTo(before) < 1e-6);
  canvas.focus();
  send('keydown', 'Space');
  controls.update(0.1);
  assert.ok(camera.position.y > 1.54);
  send('keyup', 'Space');
  send('keydown', 'KeyD');
  window.dispatchEvent(new Event('blur'));
  const x = camera.position.x;
  controls.update(0.1);
  assert.equal(camera.position.x, x);
  send('keydown', 'Escape');
  assert.equal(controls.active, false);
  assert.ok(camera.position.distanceTo(original) < 1e-6);
  assert.equal(camera.fov, 43);
  controls.start();
  document.pointerLockElement = canvas;
  document.dispatchEvent(new Event('pointerlockchange'));
  document.pointerLockElement = null;
  document.dispatchEvent(new Event('pointerlockchange'));
  assert.equal(controls.active, false);
  assert.ok(camera.position.distanceTo(original) < 1e-6);
  controls.dispose();
  delete globalThis.HTMLElement;
  delete globalThis.window;
  delete globalThis.document;
});

test('arrows turn and look independently of WASD; movement, looking and jumping work together', () => {
  class Element extends EventTarget {
    closest() {
      return null;
    }
    focus() {
      document.activeElement = this;
    }
  }
  globalThis.HTMLElement = Element;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  document.hidden = false;
  document.pointerLockElement = null;
  const canvas = new Element(),
    camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.54, 0);
  const controls = attachWalking(
    camera,
    canvas,
    () => [],
    () => {},
    () => {},
    () => {},
  );
  const key = (type, code) => {
    const e = new Event(type, { cancelable: true });
    Object.defineProperties(e, {
      code: { value: code },
      target: { value: canvas },
    });
    window.dispatchEvent(e);
    return e;
  };
  const angles = () =>
    new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  try {
    controls.start();
    const start = camera.position.clone();
    assert.ok(key('keydown', 'ArrowLeft').defaultPrevented);
    controls.update(0.1);
    key('keyup', 'ArrowLeft');
    assert.ok(angles().y > 0);
    assert.ok(camera.position.distanceTo(start) < 1e-6);
    key('keydown', 'ArrowRight');
    controls.update(0.1);
    key('keyup', 'ArrowRight');
    assert.ok(Math.abs(angles().y) < 1e-6);
    key('keydown', 'ArrowUp');
    controls.update(0.1);
    key('keyup', 'ArrowUp');
    assert.ok(angles().x > 0);
    key('keydown', 'ArrowDown');
    controls.update(0.1);
    key('keyup', 'ArrowDown');
    assert.ok(Math.abs(angles().x) < 1e-6);
    for (const code of ['KeyW', 'ArrowRight', 'ArrowUp', 'Space'])
      key('keydown', code);
    controls.update(0.1);
    assert.ok(
      camera.position.x > 0 && camera.position.z < 0,
      'forward movement follows the turn',
    );
    assert.ok(
      camera.position.y > 1.54 && angles().x > 0,
      'jump and look operate while moving',
    );
    for (const code of ['KeyW', 'ArrowRight', 'Space']) key('keyup', code);
    for (let i = 0; i < 30; i++) controls.update(0.1);
    assert.ok(
      Math.abs(angles().x - 1.48) < 1e-6,
      'upward look stops before flipping',
    );
    key('keyup', 'ArrowUp');
    key('keydown', 'ArrowDown');
    for (let i = 0; i < 60; i++) controls.update(0.1);
    assert.ok(
      Math.abs(angles().x + 1.48) < 1e-6,
      'downward look stops before flipping',
    );
    window.dispatchEvent(new Event('blur'));
    const rotation = camera.quaternion.clone();
    controls.update(0.1);
    assert.ok(
      camera.quaternion.angleTo(rotation) < 1e-6,
      'blur clears arrow input',
    );
    // Equal real time yields equal turn/pitch at different frame rates.
    controls.stop();
    controls.start();
    key('keydown', 'ArrowLeft');
    key('keydown', 'ArrowUp');
    for (let i = 0; i < 30; i++) controls.update(1 / 30);
    const at30 = camera.quaternion.clone();
    controls.stop();
    controls.start();
    key('keydown', 'ArrowLeft');
    key('keydown', 'ArrowUp');
    for (let i = 0; i < 120; i++) controls.update(1 / 120);
    assert.ok(camera.quaternion.angleTo(at30) < 1e-6);
  } finally {
    controls.dispose();
    delete globalThis.HTMLElement;
    delete globalThis.window;
    delete globalThis.document;
  }
});
