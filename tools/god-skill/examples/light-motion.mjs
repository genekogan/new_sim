#!/usr/bin/env node
// Served at <world-url>/god/examples/light-motion.mjs. Pure examples: no HTTP, writes or entities.
// Save this file, then: node light-motion.mjs spin > spin.def.json
//                     node eden-god.mjs define spin.def.json
// Define/inspect first; place only an intended part of the owner's build. No motion-test entities needed.
// spin: axis x/y/z, rpm, optional role (the kit shape's role pivot); on:false/playing:false stops it.
// sway: amount 0..1, period seconds; whole-object gentle lean.
// hover: height metres above the resting pose, bob metres, period seconds.
// route: ref names an EXISTING path entity (replace parade-path); speed m/s, altitude metres.
//        A closed path loops with loop:true; an open path or loop:false goes back and forth.
// sound: kind, radius metres, volume 0..1, optional when state / !state, mode loop/change.
//        A viewer must enable sound; loop runs while the condition holds. It is presentation, not a Soul ride.
// light: at [x,z] or [x,y,z] is local (yaw/scale follow the entity). Only x/z move the pool;
//        y locates the halo. lights:[...] replaces light and allows 1..8 independent bulbs.
//        Patterns: steady, blink/pulse/chase .5 Hz, twinkle 1/3 Hz; reduced motion makes them steady.
//        Chase phases follow array order; twinkle phases follow entity id + bulb index.
//        `find twinkle` / `place twinkle-lights` use the built-in example. Look at hour 21.
import { pathToFileURL } from 'node:url';
const shape = { kind: 'sphere', at: [0, .5, 0], r: .5, segments: 5, color: '#e6b654', collide: false };
const def = (name, components, shapes = [shape], box = [1, 1, 1]) => ({
  schema: 'def/1', name, description: `Authored ${name} example; decorative presentation.`,
  tags: ['decor', name], layer: 'decor', size: { box },
  make: { kind: 'gen', gen: 'kit/2', args: { shapes } }, components,
});
export const examples = {
  spin: def('spin-example', { spin: { axis: 'y', rpm: 2 } }),
  sway: def('sway-example', { sway: { amount: .2, period: 6 } }),
  hover: def('hover-example', { hover: { height: 2, bob: .15, period: 4 } }),
  route: def('route-example', { route: { ref: 'parade-path', speed: 1, loop: true, altitude: 1 } }),
  sound: def('sound-example', { sound: { kind: 'chime', radius: 12, volume: .3, when: 'on', mode: 'loop' } }),
  twinkle: def('twinkle-example', { lights: [
    { at: [-1, 2, 0], range: 4, color: '#ffe9c4', pattern: 'twinkle' },
    { at: [1, 2, 0], range: 4, color: '#ffc780', pattern: 'twinkle' },
  ] }, [-1, 1].map(x => ({ ...shape, at: [x, 2, 0], r: .15, glow: .8 })), [2.3, 2.15, .3]),
};
examples.sound.state = { on: { type: 'bool', default: true } };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const example = examples[process.argv[2]];
  if (!example) { console.error(`usage: node light-motion.mjs <${Object.keys(examples).join('|')}>  (prints def/1; creates nothing)`); process.exitCode = 2; }
  else console.log(JSON.stringify(example, null, 2));
}
