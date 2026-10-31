// Music a Soul turns on and off by hand (Soul Actions entry 20): the hand goes to the knob (the part tinted `valve`, as on
// a tap) and the music starts or stops at contact. Visitors hear a song from a deterministic score at depicted world seconds
// (apps/web/src/gen-mesh/sound.ts playJukeboxes, the piano's score clock), so every viewer hears the same song at the same
// moment. The `music` sound below is only how the sound layer finds it; the generic music loop never plays for it.
import vocab from './vocab.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

const desk = (vocab.find(d => d.name === 'core-desk-lamp')! as unknown as DefInput).actions!;
const palette = { wood: '#7a4a2a', trim: '#d9b26a', grille: '#3a2f28', dial: '#ffd98a', dark: '#2a2420', valve: '#c9a24a' };
const params = { wood: { type: 'color', default: palette.wood, doc: 'cabinet colour' }, trim: { type: 'color', default: palette.trim, doc: 'trim colour' }, valve: { type: 'color', default: palette.valve, doc: 'knob colour (the hand goes here)' } };

const jukebox: DefInput = {
  schema: 'def/1', name: 'core-jukebox', version: 1,
  description: 'A standing wooden jukebox with a lit dial. A Soul turns it on and off by hand at the knob; it plays songs that everyone nearby hears.',
  tags: ['music', 'jukebox', 'radio', 'hand-operated'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.02, shapes: [
    { kind: 'box', at: [0, 0.65, 0], size: [0.8, 1.3, 0.5], round: 0.03, tint: 'wood' },
    { kind: 'cyl', at: [0, 1.3, 0], r: 0.4, h: 0.5, segments: 16, tint: 'wood', pitch: Math.PI / 2 },
    { kind: 'box', at: [0, 0.45, 0.255], size: [0.6, 0.6, 0.02], round: 0.01, tint: 'grille' },
    ...[0.25, 0.37, 0.49, 0.61].map(y => ({ kind: 'box', at: [0, y, 0.27], size: [0.56, 0.015, 0.012], tint: 'trim' })),
    { kind: 'box', at: [0, 1.05, 0.26], size: [0.5, 0.2, 0.02], round: 0.01, tint: 'dark', when: '!@on' },
    { kind: 'box', at: [0, 1.05, 0.26], size: [0.5, 0.2, 0.02], round: 0.01, tint: 'dial', glow: 1, when: '@on' },
    { kind: 'box', at: [0, 0.9, 0.255], size: [0.72, 0.03, 0.02], tint: 'trim' },
    { kind: 'cyl', at: [0.32, 1.08, 0.28], r: 0.045, h: 0.04, segments: 10, tint: 'valve', pitch: Math.PI / 2 }] } } as unknown as DefInput['make'],
  params: params as DefInput['params'], palette,
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: { sound: { kind: 'music', radius: 22, volume: 0.5, when: 'on', mode: 'loop' } } as DefInput['components'],
  size: { box: [0.8, 1.7, 0.5] },
  actions: desk.map(a => ({ ...structuredClone(a), label: a.name === 'switch-on' ? 'Turn on the jukebox' : 'Turn off the jukebox' })) as DefInput['actions'],
} as DefInput;

export const HAND_MUSIC: DefInput[] = [jukebox];
