// Fire and festoon lights a Soul lights and puts out by hand (Soul Actions entry 22): the same contact on/off as the lamps
// and taps. The hand goes to the part tinted `valve` (a wick, a switch box, the kindling at a fire ring) and the flames,
// bulbs, light and crackle exist only while `on` (fx/flames.ts burns any flame part that is drawn). Frozen v1 candle,
// string lights and campfire keep their remote toggle.
import vocab from './vocab.json' with { type: 'json' };
import vocabW1 from './vocab-w1.json' with { type: 'json' };
import vocabW2 from './vocab-w2.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

type Shape = { kind: string; at: number[]; tint?: string; when?: string; role?: string; glow?: number; [k: string]: unknown };
const desk = (vocab.find(d => d.name === 'core-desk-lamp')! as unknown as DefInput).actions!;
const switches = (on: string, off: string) => desk.map(a => ({ ...structuredClone(a), label: a.name === 'switch-on' ? on : off }));
// a fire is lit and put out (the words Souls use, and the v1 action names), through the same on/off contact
const fireActions = (on: string, off: string) => switches(on, off).map(a => ({ ...a, name: a.name === 'switch-on' ? 'light' : 'put-out' }));
const shapesOf = (d: DefInput) => (d.make as unknown as { args: { shapes: Shape[] } }).args.shapes;
const lit = (s: Shape) => (s.role === 'flame' ? { ...s, when: '@on' } : s);

const candleStand: DefInput = {
  schema: 'def/1', name: 'core-candle-stand', version: 1,
  description: 'A wrought-iron floor candle stand (1.2 m) holding a pillar candle. A Soul lights it and puts it out by hand at the wick; it gives a small warm light while it burns.',
  tags: ['lighting', 'candle', 'hand-operated', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'cyl', at: [0, 0.015, 0], r: 0.16, h: 0.03, segments: 10, tint: 'iron' },
    { kind: 'cyl', at: [0, 0.55, 0], r: 0.018, h: 1.04, segments: 8, tint: 'iron' },
    { kind: 'torus', at: [0, 0.6, 0], r: 0.05, r2: 0.008, segments: 8, tint: 'iron' },
    { kind: 'cyl', at: [0, 1.07, 0], r: 0.075, h: 0.02, segments: 12, tint: 'iron' },
    { kind: 'cyl', at: [0, 1.155, 0], r: 0.04, h: 0.15, segments: 12, tint: 'wax' },
    { kind: 'cyl', at: [0, 1.237, 0], r: 0.003, h: 0.014, segments: 4, tint: 'valve' },
    { kind: 'cone', at: [0, 1.265, 0], r: 0.012, h: 0.045, segments: 6, tint: 'flame', glow: 1, role: 'flame', pivot: [0, 1.244, 0], when: '@on' }] } } as unknown as DefInput['make'],
  params: { iron: { type: 'color', default: '#2e2a27', doc: 'iron colour' }, wax: { type: 'color', default: '#f1e7d0', doc: 'wax colour' }, valve: { type: 'color', default: '#2b2623', doc: 'wick colour (the hand goes here)' }, flame: { type: 'color', default: '#ffb347', doc: 'flame colour' } } as DefInput['params'],
  palette: { iron: '#2e2a27', wax: '#f1e7d0', valve: '#2b2623', flame: '#ffb347' },
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: { light: { color: '#ffb860', range: 2, on: true, at: [0, 1.27, 0] } } as DefInput['components'],   // the smallest pool: one candle
  size: { box: [0.34, 1.3, 0.34] },
  actions: fireActions('Light the candle', 'Put out the candle') as DefInput['actions'],
} as DefInput;

// v1 festoon with a weatherproof switch box on the left post; off by default, so a Soul switches it on at dusk.
const lightsV1 = vocabW1.find(d => d.name === 'core-string-lights')! as unknown as DefInput;
const stringLights: DefInput = {
  ...structuredClone(lightsV1), version: 2,
  description: `${lightsV1.description} A Soul switches them on and off by hand at the switch box on the left post.`,
  tags: [...lightsV1.tags!, 'hand-operated', 'local-fixture'],
  make: { ...lightsV1.make, args: { ...(lightsV1.make as unknown as { args: object }).args, shapes: [...shapesOf(lightsV1),
    { kind: 'box', at: [-4, 1.2, -0.085], size: [0.08, 0.12, 0.05], round: 0.008, tint: 'valve' }] } } as unknown as DefInput['make'],
  params: { ...lightsV1.params, valve: { type: 'color', default: '#9c2f24', doc: 'switch box colour (the hand goes here)' } } as DefInput['params'],
  palette: { ...lightsV1.palette, valve: '#9c2f24' },
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  // four small lights along the sag (bulb height), so the halo sits on the festoon, not one orb over its middle
  components: { ...Object.fromEntries(Object.entries(lightsV1.components ?? {}).filter(([k]) => k !== 'light')), lights: [-3, -1, 1, 3].map((x) => ({ color: '#ffd9a0', range: 4, on: true, at: [x, Math.abs(x) === 3 ? 2.66 : 2.48, 0] })) } as DefInput['components'],
  actions: switches('Switch on the string lights', 'Switch off the string lights') as DefInput['actions'],
} as DefInput;

// v1 campfire: flames, light and crackle only while lit; kindling at the front stones is where the hand goes (crouching).
// The footprint is the stone ring, so the Soul crouches just outside it; the seat logs keep their slots.
const fireV1 = vocabW2.find(d => d.name === 'core-campfire')! as unknown as DefInput;
const campfire: DefInput = {
  ...structuredClone(fireV1), version: 2,
  description: 'A campfire in a ring of stones (1.6 m) with crossed logs; sit round it on three logs. A Soul crouches at the ring to light it and to put it out by hand; it burns and crackles while lit.',
  tags: [...fireV1.tags!, 'hand-operated', 'local-fixture'],
  make: { ...fireV1.make, args: { ...(fireV1.make as unknown as { args: object }).args, shapes: [...shapesOf(fireV1).map(lit),
    { kind: 'cyl', at: [0, 0.16, 0.6], r: 0.05, h: 0.08, segments: 6, tint: 'valve', pitch: Math.PI / 2 }] } } as unknown as DefInput['make'],
  params: { ...fireV1.params, valve: { type: 'color', default: '#6b4a2e', doc: 'kindling colour (the hand goes here)' } } as DefInput['params'],
  palette: { ...fireV1.palette, valve: '#6b4a2e' },
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: { ...fireV1.components, sound: { kind: 'fire', radius: 12, volume: 0.55, when: 'on', mode: 'loop' } } as DefInput['components'],
  size: { box: [1.7, 0.9, 1.7] },
  actions: fireActions('Light the campfire', 'Put out the campfire') as DefInput['actions'],
} as DefInput;

export const HAND_FIRE: DefInput[] = [candleStand, stringLights, campfire];
