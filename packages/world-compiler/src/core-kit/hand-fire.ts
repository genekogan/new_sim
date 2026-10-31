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

// Torches (Soul Actions entry 33): the same hand-lit fire. The hand goes to the charred top of the fuel head (tinted `valve`),
// raised a little above the shoulder; the flame (role flame, drawn only while lit) burns on the head and its warm,
// flickering light pools on the ground (night map, flicker pattern for any def named torch). One mechanism, two mounts.
const torchHead = (y: number, z = 0): Shape[] => [
  { kind: 'lathe', at: [0, y - 0.16, z], profile: [[0.018, 0], [0.04, 0.05], [0.056, 0.115], [0.058, 0.13], [0.052, 0.135]], segments: 12, tint: 'iron' },
  { kind: 'cyl', at: [0, y - 0.05, z], r: 0.041, h: 0.1, segments: 12, tint: 'wrap' },
  { kind: 'torus', at: [0, y - 0.075, z], r: 0.043, r2: 0.005, segments: 10, tint: 'iron', pitch: Math.PI / 2 },
  { kind: 'cyl', at: [0, y + 0.006, z], r: 0.03, h: 0.012, segments: 10, tint: 'valve' },
  { kind: 'cone', at: [0, y + 0.17, z], r: 0.066, h: 0.32, segments: 7, tint: 'flame', glow: 1, role: 'flame', pivot: [0, y, z], when: '@on' }];
const torchLook = { iron: { type: 'color', default: '#2b2724', doc: 'iron colour' }, pole: { type: 'color', default: '#6b5034', doc: 'pole colour' }, wrap: { type: 'color', default: '#3a2a1e', doc: 'fuel wrap colour' }, valve: { type: 'color', default: '#1f1712', doc: 'charred top of the head (the hand goes here)' }, flame: { type: 'color', default: '#ff9a3c', doc: 'flame colour' } };
const torchPalette = { iron: '#2b2724', pole: '#6b5034', wrap: '#3a2a1e', valve: '#1f1712', flame: '#ff9a3c' };
const torchSound = { kind: 'fire', radius: 7, volume: 0.22, when: 'on', mode: 'loop', variant: 0 };
const standingTorch: DefInput = {
  schema: 'def/1', name: 'core-standing-torch', version: 1,
  description: 'An iron garden torch on a wooden pole (1.45 m), its head wrapped and soaked to burn. A Soul lights it and puts it out by hand, reaching up to the head; it burns with a flickering flame and throws warm light around it.',
  tags: ['lighting', 'torch', 'fire', 'hand-operated', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'cyl', at: [0, 0.02, 0], r: 0.12, h: 0.04, segments: 10, tint: 'iron' },
    { kind: 'cyl', at: [0, 0.075, 0], r: 0.03, h: 0.07, segments: 8, tint: 'iron' },
    { kind: 'cyl', at: [0, 0.68, 0], r: 0.02, h: 1.2, segments: 8, tint: 'pole' },
    { kind: 'torus', at: [0, 0.5, 0], r: 0.022, r2: 0.005, segments: 8, tint: 'iron', pitch: Math.PI / 2 },
    ...torchHead(1.44)] } } as unknown as DefInput['make'],
  params: torchLook as DefInput['params'], palette: torchPalette,
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: { light: { color: '#ff7f30', range: 3.6, on: true, at: [0, 1.6, 0] }, sound: torchSound } as DefInput['components'],
  size: { box: [0.26, 1.78, 0.26] },
  actions: fireActions('Light the standing torch', 'Put out the standing torch') as DefInput['actions'],
} as DefInput;
// For a wall: back plate at the def's back (z -0.13; place it with its back to the wall), an arm and a collar holding
// the torch upright 0.15 m out from the wall, its head at 1.52 m.
const wallTorch: DefInput = {
  schema: 'def/1', name: 'core-wall-torch', version: 1,
  description: 'An iron wall bracket holding a torch upright 15 cm from the wall, its head at 1.5 m. Place it with its back against a wall. A Soul lights it and puts it out by hand, reaching up to the head; it burns with a flickering flame and throws warm light on the wall and the ground.',
  tags: ['lighting', 'torch', 'fire', 'wall', 'hand-operated', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.006, shapes: [
    { kind: 'box', at: [0, 1.24, -0.12], size: [0.09, 0.26, 0.016], tint: 'iron' },
    { kind: 'box', at: [0, 1.22, -0.06], size: [0.022, 0.022, 0.11], tint: 'iron' },
    { kind: 'box', at: [0, 1.3, -0.075], size: [0.016, 0.016, 0.12], tint: 'iron', pitch: -0.75 },
    { kind: 'cyl', at: [0, 1.225, 0.02], r: 0.03, h: 0.05, segments: 10, tint: 'iron' },
    { kind: 'cyl', at: [0, 1.2, 0.02], r: 0.02, h: 0.36, segments: 8, tint: 'pole' },
    ...torchHead(1.52, 0.02)] } } as unknown as DefInput['make'],
  params: torchLook as DefInput['params'], palette: torchPalette,
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: { light: { color: '#ff7f30', range: 3.6, on: true, at: [0, 1.68, 0.2] }, sound: torchSound } as DefInput['components'],
  size: { box: [0.2, 1.86, 0.28] },
  actions: fireActions('Light the wall torch', 'Put out the wall torch') as DefInput['actions'],
} as DefInput;

// A neon sign (entry 33): glass tube lettering (state `text`, chosen by its owner, at most 32 characters on 1–2 lines)
// and a tube border on a dark backboard between two posts, switched on and off by hand at the switch box on the outer
// side of the right-hand post (1.2 m; the lamps' contact). The viewer draws the tubes (tag `neon`, gen-mesh/kits/neon.mesh.ts): pale glass
// while off, a stutter as each tube strikes, then a steady glow with a hot core, bloom and spill; the coloured pools
// on the ground are its two lights; a quiet transformer hum while lit.
const neonSign: DefInput = {
  schema: 'def/1', name: 'core-neon-sign', version: 1,
  description: 'A neon sign: glass tube lettering (state text, its owner\'s words, up to 32 characters on one or two lines) and a tube border on a dark board between two posts (top 2.15 m). A Soul switches it on and off by hand at the switch box on the side of the right-hand post; lit, it glows and hums quietly.',
  tags: ['lighting', 'sign', 'neon', 'hand-operated', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.008, shapes: [
    ...[-0.8, 0.8].flatMap((x) => [
      { kind: 'box', at: [x, 1.1, 0], size: [0.05, 2.2, 0.05], tint: 'frame' },
      { kind: 'box', at: [x, 0.015, 0], size: [0.12, 0.03, 0.34], tint: 'frame' }]),
    { kind: 'box', at: [0, 1.78, -0.005], size: [1.7, 0.74, 0.04], tint: 'board' },
    { kind: 'box', at: [0, 2.165, -0.005], size: [1.74, 0.03, 0.06], tint: 'frame' },
    { kind: 'box', at: [0, 1.395, -0.005], size: [1.74, 0.03, 0.06], tint: 'frame' },
    { kind: 'box', at: [0.35, 1.62, -0.07], size: [0.26, 0.13, 0.08], tint: 'frame' },
    // the switch box on the outer side of the right-hand post (seen from the front), its lever facing out
    { kind: 'box', at: [0.855, 1.2, 0], size: [0.06, 0.12, 0.08], tint: 'valve' },
    { kind: 'box', at: [0.892, 1.215, 0], size: [0.016, 0.034, 0.014], tint: 'lever' },
    { kind: 'cyl', at: [0.84, 1.33, 0], r: 0.009, h: 0.14, segments: 6, tint: 'frame' }],
    faces: [{ neon: true, at: [0, 1.78, 0.022], w: 1.56, h: 0.62 }] } } as unknown as DefInput['make'],
  params: { frame: { type: 'color', default: '#1c1d21', doc: 'posts and frame colour' }, board: { type: 'color', default: '#121318', doc: 'backboard colour' },
    valve: { type: 'color', default: '#4a4f57', doc: 'switch box colour (the hand goes here)' }, lever: { type: 'color', default: '#c9ccd2', doc: 'switch lever colour' },
    tube: { type: 'color', default: '#ff3d8e', doc: 'lettering tube colour' }, border: { type: 'color', default: '#2fd6ff', doc: 'border tube colour' } } as DefInput['params'],
  palette: { frame: '#1c1d21', board: '#121318', valve: '#4a4f57', lever: '#c9ccd2', tube: '#ff3d8e', border: '#2fd6ff' },
  state: { on: { type: 'bool', default: false }, text: { type: 'string', max: 32, default: 'OPEN' } } as DefInput['state'],
  // the coloured spill on the ground in front of the board (the viewer draws the glow on the board itself)
  components: { lights: [{ color: '#ff3d8e', range: 5, on: true, at: [-0.45, 1.78, 0.7] }, { color: '#ff3d8e', range: 5, on: true, at: [0.45, 1.78, 0.7] }],
    sound: { kind: 'hum', radius: 9, volume: 0.32, when: 'on', mode: 'loop', variant: 2 } } as DefInput['components'],
  size: { box: [1.86, 2.18, 0.34] },
  actions: switches('Switch on the neon sign', 'Switch off the neon sign') as DefInput['actions'],
} as DefInput;

export const HAND_FIRE: DefInput[] = [candleStand, stringLights, campfire, standingTorch, wallTorch, neonSign];
