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

export const HAND_WATER: DefInput[] = [gardenTap, beachShower];
