#!/usr/bin/env node
// Massing appears with start: no grey-kit entities, definitions or cleanup calls.
// The existing harness records the real-server transcript later, under lead control.
// Explicit --world is useful for that recording; this worker does not run it.
import { run } from './_harness.mjs';

const batch = (ops, note) => `act '${JSON.stringify({ ops, note })}'`;
await run('church-massing', {
  title: 'a black stone church, massing first',
  steps: [
    'build start church --title "Black stone church" --steps "shell,roof and tower,openings,interior,furnish" --at 0,0 --size 40,16 --mass "nave 0,0 22x10 h5 gable; tower -15,0 6x6 h30 pyramid"',
    'look --at 0,0 --span 44',
    batch([{ op: 'place', def: 'core/chapel@1', name: 'church', p: [0, 0], params: { w: 22, d: 10, floorHeight: 5, material: 'stone', wall: '#202329', trim: '#3a3d43', roof: 'flat', windows: 0.25 } }], 'shell: nave walls, rooms and entrance'),
    'look --at church --span 44',
    'build step',
    batch([
      { op: 'set', id: 'church', params: { roof: 'gable', roofColor: '#24262b' } },
      { op: 'place', def: 'core/tower@1', name: 'church-tower', p: [-15, 0], params: { w: 6, d: 6, floors: 6, floorHeight: 5, material: 'stone', wall: '#202329', trim: '#3a3d43', roof: 'hip', roofPitch: 45, roofColor: '#24262b' } },
    ], 'roof and tower'),
    'build step',
    // A replacement, if needed, must remove and place in this same batch.
    batch([{ op: 'set', id: 'church', params: { windows: 0.8, front: 's' } }], 'openings: windows and south entrance'),
    'build step',
    'place rug --inside church --name nave-rug',
    'build step',
    'furnish church --style chapel --group interior',
    'describe church',
    // Optional extra use check: verify-use church --uses enter,sit
    'build done "nave, tower, furnished interior"',
  ],
  look: '--at church --span 44 --from s',
});
