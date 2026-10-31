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
const foot = (x: number) => ({ kind: 'box', at: [x, 0.02, 0], size: [0.06, 0.04, 0.3], round: 0.01, tint: 'frame' });
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
  size: { box: [1.16, 1.68, 0.3] },
  actions: boardActions('whiteboard'),
} as DefInput;

// Entry 19: a notice board several Souls pin notes on at once. `text` holds one note per line ("words — Name") and
// `textBy` the authors' soul ids in the same order, so the face, the read and the depicted-tick gate see one field.
// The `then` below is the naive form; the hand actuator composes the list (pinPatch in apps/server/src/god/actuators.ts)
// and lets only a note's author take it down.
export const PIN_NOTES_MAX = 6, PIN_TEXT_MAX = 60, PIN_PER_SOUL = 2;
/** Where note i sits on the cork face (face-local metres, x right, y up): three across, two down. Shared by the viewer's
 *  cards and the hand that pins or takes it down. */
export const pinSlot = (i: number): [number, number] => [(i % 3 - 1) * 0.39, i < 3 ? 0.19 : -0.19];
const pinMake = structuredClone(noticeV1.make) as unknown as { args: { shapes: { tint?: string }[]; faces: unknown[] } };
pinMake.args.shapes = pinMake.args.shapes.filter(sh => !/^note/.test(sh.tint ?? ''));   // the printed notes give way to real ones
pinMake.args.faces = [{ at: [0, 1.35, 0.066], w: 1.2, h: 0.8, bg: '#b88a5a', ink: '#2a2622' }];
const pinBoard: DefInput = { ...structuredClone(noticeV1), make: pinMake as unknown as DefInput['make'], version: 3, tags: [...(noticeV1.tags ?? []), 'hand-writable', 'pinboard'],
  description: `A roofed notice board on two posts. Souls pin short notes on it by hand (up to ${PIN_NOTES_MAX}, each signed); only a note's author takes it down.`,
  state: { text: { type: 'string', max: PIN_NOTES_MAX * (PIN_TEXT_MAX + 44), default: '' }, textBy: { type: 'string', max: PIN_NOTES_MAX * 41, default: '' } } as DefInput['state'],
  components: { ...structuredClone(noticeV1.components), sign: { lines: [] } },
  actions: [
    { name: 'pin', label: 'Pin a note on the notice board', params: { text: { type: 'string', max: PIN_TEXT_MAX, doc: `your note: one line, up to ${PIN_TEXT_MAX} characters; it is signed with your name` } },
      then: [{ op: 'set', field: 'text', value: { param: 'text' } }, { op: 'set', field: 'textBy', value: '' }] },
    { name: 'unpin', label: 'Take down your note from the notice board', when: [{ field: 'text', not: '' }],
      then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }] },
  ] as NonNullable<DefInput['actions']> };

export const WRITABLE_BOARDS: DefInput[] = [whiteboard, noticeBoard, pinBoard];
