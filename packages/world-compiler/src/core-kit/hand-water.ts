// Water a Soul turns on and off by hand (Soul Actions entry 15): the hand goes to the part tinted `valve` and the
// water (shapes `when: "@on"`) starts or stops at contact. Frozen v1 showers and fountains keep the generic actuator.
import vocab from './vocab.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

const desk = (vocab.find(d => d.name === 'core-desk-lamp')! as unknown as DefInput).actions!;
const switches = (on: string, off: string) => desk.map(a => ({ ...structuredClone(a), label: a.name === 'switch-on' ? on : off }));
const water = (kind: 'water', radius: number, volume: number) => ({ sound: { kind, radius, volume, when: 'on', mode: 'loop' } });
const palette = { metal: '#8d9499', valve: '#b8322a', stone: '#9b978d', water: '#bfe3f2' };
const params = { metal: { type: 'color', default: palette.metal, doc: 'pipe colour' }, valve: { type: 'color', default: palette.valve, doc: 'valve handle colour (the hand goes here)' }, stone: { type: 'color', default: palette.stone, doc: 'basin colour' }, water: { type: 'color', default: palette.water, doc: 'water colour' } };

const gardenTap: DefInput = {
  schema: 'def/1', name: 'core-garden-tap', version: 1,
  description: 'A garden standpipe with a tap over a small stone basin. A Soul turns it on and off by hand; water runs into the basin while it is on.',
  tags: ['water', 'garden', 'tap', 'hand-operated'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'box', at: [0, 0.45, 0], size: [0.08, 0.9, 0.08], round: 0.01, tint: 'metal' },
    { kind: 'cyl', at: [0, 0.8, 0.09], r: 0.022, h: 0.16, segments: 8, tint: 'metal', pitch: Math.PI / 2 },
    { kind: 'cyl', at: [0, 0.93, 0.02], r: 0.045, h: 0.02, segments: 6, tint: 'valve' },
    { kind: 'cyl', at: [0, 0.05, 0.2], r: 0.22, h: 0.1, segments: 12, r2: 0.18, tint: 'stone' },
    { kind: 'cyl', at: [0, 0.44, 0.17], r: 0.018, h: 0.68, segments: 6, tint: 'water', material: 'water', when: '@on' },
    { kind: 'cyl', at: [0, 0.1, 0.2], r: 0.15, h: 0.012, segments: 12, tint: 'water', material: 'water', when: '@on' }] } } as unknown as DefInput['make'],
  params: params as DefInput['params'], palette,
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: water('water', 8, 0.35) as DefInput['components'],
  size: { box: [0.44, 0.95, 0.88] },   // covers the basin in front of the spout, so nobody stands in it
  actions: switches('Turn on the tap', 'Turn off the tap') as DefInput['actions'],
} as DefInput;

const beachShower: DefInput = {
  schema: 'def/1', name: 'core-beach-shower', version: 1,
  description: 'An outdoor shower on a pole over a slatted tray. A Soul turns it on and off by hand at the valve on the pole; water falls from the head while it is on.',
  tags: ['water', 'bath', 'shower', 'beach', 'hand-operated'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'cyl', at: [0, 1.15, 0], r: 0.04, h: 2.3, segments: 8, tint: 'metal' },
    { kind: 'box', at: [0, 2.26, 0.13], size: [0.04, 0.04, 0.26], round: 0.01, tint: 'metal' },
    { kind: 'cyl', at: [0, 2.22, 0.27], r: 0.1, h: 0.04, segments: 10, tint: 'metal' },
    { kind: 'cyl', at: [0, 1.15, 0.05], r: 0.05, h: 0.03, segments: 6, tint: 'valve', pitch: Math.PI / 2 },
    { kind: 'box', at: [0, 0.02, 0.3], size: [0.7, 0.04, 0.7], round: 0, tint: 'stone' },
    { kind: 'cyl', at: [0, 1.11, 0.27], r: 0.07, h: 2.18, segments: 8, r2: 0.13, tint: 'water', material: 'water', when: '@on' }] } } as unknown as DefInput['make'],
  params: params as DefInput['params'], palette,
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: water('water', 10, 0.4) as DefInput['components'],
  size: { box: [0.7, 2.3, 0.7] },
  actions: switches('Turn on the shower', 'Turn off the shower') as DefInput['actions'],
} as DefInput;


// Entry 16: a sprinkler that soaks the garden planters within its reach when a Soul turns it on by hand.
export const SPRINKLER_REACH = 3.5;
const gardenSprinkler: DefInput = {
  schema: 'def/1', name: 'core-garden-sprinkler', version: 1,
  description: `A garden sprinkler on a short standpipe. A Soul turns it on and off by hand at the valve on its back; while it is on it sprays forward over the planters within ${SPRINKLER_REACH} m.`,
  tags: ['water', 'garden', 'sprinkler', 'hand-operated', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'box', at: [0, 0.3, 0], size: [0.06, 0.6, 0.06], round: 0.01, tint: 'metal' },
    { kind: 'cyl', at: [0, 0.64, 0], r: 0.05, h: 0.05, segments: 10, tint: 'metal' },
    { kind: 'cyl', at: [0, 0.42, -0.05], r: 0.04, h: 0.03, segments: 6, tint: 'valve', pitch: -Math.PI / 2 },
    // an arc sprinkler: thin jets fan forward and up from the head; the valve is on the back, where the Soul stands
    { kind: 'cyl', at: [-0.7, 1.358, 0.68], r: 0.012, r2: 0.05, h: 2.4, segments: 6, pitch: 0.95, yaw: -0.8, tint: 'water', material: 'water', when: '@on' },
    { kind: 'cyl', at: [-0.38, 1.358, 0.899], r: 0.012, r2: 0.05, h: 2.4, segments: 6, pitch: 0.95, yaw: -0.4, tint: 'water', material: 'water', when: '@on' },
    { kind: 'cyl', at: [0.0, 1.358, 0.976], r: 0.012, r2: 0.05, h: 2.4, segments: 6, pitch: 0.95, yaw: 0, tint: 'water', material: 'water', when: '@on' },
    { kind: 'cyl', at: [0.38, 1.358, 0.899], r: 0.012, r2: 0.05, h: 2.4, segments: 6, pitch: 0.95, yaw: 0.4, tint: 'water', material: 'water', when: '@on' },
    { kind: 'cyl', at: [0.7, 1.358, 0.68], r: 0.012, r2: 0.05, h: 2.4, segments: 6, pitch: 0.95, yaw: 0.8, tint: 'water', material: 'water', when: '@on' }] } } as unknown as DefInput['make'],
  params: { ...params, reach: { type: 'number', min: 1, max: 8, default: SPRINKLER_REACH, doc: 'metres of garden it waters' } } as DefInput['params'], palette,
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: water('water', 9, 0.3) as DefInput['components'],
  size: { box: [0.2, 0.65, 0.2] },
  actions: switches('Turn on the sprinkler', 'Turn off the sprinkler') as DefInput['actions'],
} as DefInput;
const plantPalette = { wood: '#7a5a3c', soil: '#5b4632', fill: '#2f2418', leaf: '#4f8f3a', bloom: '#e8b6c8' };
const gardenPlanter: DefInput = {
  schema: 'def/1', name: 'core-garden-planter', version: 1,
  description: 'A wooden garden planter with soil and a flowering plant. It droops and browns when dry and stands up green and flowering when watered (moisture 0..1).',
  tags: ['garden', 'planter', 'plant', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'box', at: [0, 0.18, 0], size: [0.9, 0.36, 0.5], round: 0.02, tint: 'wood' },
    { kind: 'box', at: [0, 0.36, 0], size: [0.82, 0.02, 0.42], round: 0, tint: 'soil' },
    { kind: 'cyl', at: [0, 0.372, 0], r: 0.38, h: 0.006, segments: 12, tint: 'fill', role: 'fill' },
    { kind: 'sphere', at: [-0.2, 0.62, 0], r: 0.2, segments: 8, tint: 'leaf', role: 'head', pivot: [0, -0.25, 0] },
    { kind: 'sphere', at: [0.2, 0.6, 0.02], r: 0.18, segments: 8, tint: 'leaf', role: 'head', pivot: [0, -0.23, 0] },
    { kind: 'sphere', at: [0, 0.72, -0.03], r: 0.17, segments: 8, tint: 'leaf', role: 'head', pivot: [0, -0.35, 0] },
    { kind: 'sphere', at: [-0.12, 0.84, 0.08], r: 0.06, segments: 6, tint: 'bloom', role: 'head', pivot: [0, -0.47, 0] },
    { kind: 'sphere', at: [0.15, 0.78, 0.1], r: 0.055, segments: 6, tint: 'bloom', role: 'head', pivot: [0, -0.41, 0] }] } } as unknown as DefInput['make'],
  params: Object.fromEntries(Object.entries(plantPalette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])) as DefInput['params'], palette: plantPalette,
  state: { moisture: { type: 'number', min: 0, max: 1, default: 0.1 } } as DefInput['state'],
  size: { box: [0.9, 0.9, 0.5] },
} as DefInput;

export const HAND_WATER: DefInput[] = [gardenTap, beachShower, gardenSprinkler, gardenPlanter];
