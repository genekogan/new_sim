// A drum kit a Soul sits at and plays (Soul Actions entry 26). "Play the drums" seats the Soul on the stool through the
// existing play-music activity (instrument drums); the viewer plays and draws a drum part on the piano's own clock, so a
// pianist and a drummer near each other play in time. No new server faculty.
import type { DefInput } from '../schemas.ts';
const drum = (at: number[], r: number, h: number, extra: Record<string, unknown> = {}) => [
  { kind: 'cyl', at, r, h, segments: 18, tint: 'shell', ...extra },
  { kind: 'cyl', at: [at[0], at[1] + h / 2 + 0.002, at[2]], r: r * 0.96, h: 0.004, segments: 18, tint: 'head', ...extra }];
const stand = (x: number, z: number, h: number) => ({ kind: 'cyl', at: [x, h / 2, z], r: 0.012, h, segments: 6, tint: 'chrome' });
const cymbal = (at: number[], r: number) => ({ kind: 'cyl', at, r, h: 0.006, segments: 20, r2: r * 0.9, tint: 'brass' });
export const INSTRUMENTS: DefInput[] = [{
  schema: 'def/1', name: 'core-drum-kit', version: 1,
  description: 'A drum kit with a stool: bass drum, snare, tom, hi-hat and a crash cymbal. A Soul sits and plays the drums; a pianist nearby plays in time with it.',
  tags: ['furniture', 'music', 'instrument', 'percussion'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'cyl', at: [0, 0.3, -0.08], r: 0.28, h: 0.36, segments: 20, tint: 'shell', pitch: Math.PI / 2 },
    { kind: 'cyl', at: [0, 0.3, 0.105], r: 0.26, h: 0.006, segments: 20, tint: 'head', pitch: Math.PI / 2 },
    stand(0.1, 0.18, 0.55), ...drum([0.1, 0.6, 0.18], 0.17, 0.13),
    stand(-0.12, -0.02, 0.62), ...drum([-0.12, 0.68, 0.06], 0.12, 0.14, { pitch: -0.25 }),
    stand(0.32, 0.2, 0.84), cymbal([0.32, 0.84, 0.2], 0.17), cymbal([0.32, 0.81, 0.2], 0.17),
    stand(-0.38, -0.05, 1.05), cymbal([-0.38, 1.06, -0.05], 0.22),
    { kind: 'cyl', at: [0, 0.25, 0.58], r: 0.03, h: 0.5, segments: 8, tint: 'chrome' },
    { kind: 'cyl', at: [0, 0.5, 0.58], r: 0.17, h: 0.06, segments: 14, tint: 'seat' }] } } as unknown as DefInput['make'],
  params: { shell: { type: 'color', default: '#8e2f2a', doc: 'drum shell colour' }, head: { type: 'color', default: '#ece6d6', doc: 'drum head colour' }, chrome: { type: 'color', default: '#a7adb3', doc: 'stand colour' }, brass: { type: 'color', default: '#c9a24a', doc: 'cymbal colour' }, seat: { type: 'color', default: '#242424', doc: 'stool colour' } } as DefInput['params'],
  palette: { shell: '#8e2f2a', head: '#ece6d6', chrome: '#a7adb3', brass: '#c9a24a', seat: '#242424' },
  slots: [{ id: 'stool', kind: 'seat', p: [0, 0.53, 0.58], yaw: Math.PI, height: 0.53, accepts: { tags: ['body'] }, capacity: 1 }],
  components: { instrument: { kind: 'drums' }, seat: { height: 0.53 } } as DefInput['components'],
  size: { box: [1.0, 1.1, 1.0] },
} as unknown as DefInput];
