// Boards a Soul writes on and wipes by hand (Soul Actions entry 13). Frozen v1 signage bytes stay intact:
// notice-board@2 is a revision; the standing whiteboard is new. Both share one write/erase contract.
import signage from './signage.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

/** Board text a Soul may write: short, a few lines, shown on the face and returned only to a reader. */
export const BOARD_TEXT_MAX = 100, BOARD_TEXT_LINES = 3;
const boardActions = (thing: string): NonNullable<DefInput['actions']> => [
  { name: 'write', label: `Write on the ${thing}`, params: { text: { type: 'string', max: BOARD_TEXT_MAX, doc: `up to ${BOARD_TEXT_MAX} characters, at most ${BOARD_TEXT_LINES} lines` } },
    then: [{ op: 'set', field: 'text', value: { param: 'text' } }] },
  { name: 'erase', label: `Wipe the ${thing} clean`, when: [{ field: 'text', not: '' }],
    then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }] },
] as NonNullable<DefInput['actions']>;
const boardState = { text: { type: 'string', max: BOARD_TEXT_MAX, default: '' }, textBy: { type: 'string', max: 40, default: '' } };

const noticeV1 = signage.find(d => d.name === 'core-notice-board')! as unknown as DefInput;
const noticeBoard: DefInput = { ...structuredClone(noticeV1), version: 2, tags: [...(noticeV1.tags ?? []), 'hand-writable'],
  description: 'A roofed notice board on two posts. A Soul can write a short notice on it by hand, or wipe it clean.',
  state: boardState as DefInput['state'], components: { ...structuredClone(noticeV1.components), sign: { lines: [] } }, actions: boardActions('notice board') };

const post = (x: number) => ({ kind: 'extrude', at: [x, 0.012, 0], polygon: [[-0.025, -0.025], [0.025, -0.025], [0.025, 0.025], [-0.025, 0.025]], h: 1.66, tint: 'frame' });
const foot = (x: number) => ({ kind: 'box', at: [x, 0.02, 0], size: [0.06, 0.04, 0.5], round: 0.01, tint: 'frame' });
const whiteboard: DefInput = {
  schema: 'def/1', name: 'core-whiteboard', version: 1,
  description: 'A whiteboard on a wheeled stand. A Soul can write a short note on it by hand, or wipe it clean.',
  tags: ['signage', 'sign-text', 'board', 'whiteboard', 'classroom', 'office', 'hand-writable'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [post(-0.58), post(0.58), foot(-0.58), foot(0.58),
    { kind: 'box', at: [0, 1.2, 0], size: [1.12, 0.74, 0.04], round: 0.01, tint: 'frame' },
    { kind: 'box', at: [0, 1.2, 0.021], size: [1.06, 0.68, 0.006], round: 0, tint: 'board' },
    { kind: 'box', at: [0, 0.85, 0.05], size: [0.9, 0.025, 0.07], round: 0.005, tint: 'frame' }],
    faces: [{ at: [0, 1.2, 0.026], w: 0.98, h: 0.6, bg: '#f6f7f4', ink: '#1d3f8f', font: '600' }] } } as unknown as DefInput['make'],
  params: { frame: { type: 'color', default: '#b9bec4', doc: 'frame colour' }, board: { type: 'color', default: '#f6f7f4', doc: 'board colour' } },
  state: boardState as DefInput['state'],
  components: { readable: { pages: 1 }, sign: { lines: [] } } as DefInput['components'],
  palette: { frame: '#b9bec4', board: '#f6f7f4' },
  size: { box: [1.16, 1.68, 0.5] },
  actions: boardActions('whiteboard'),
} as DefInput;

export const WRITABLE_BOARDS: DefInput[] = [whiteboard, noticeBoard];
