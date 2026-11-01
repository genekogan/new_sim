// A chest of drawers whose top drawer a Soul slides open and shut by hand (Soul Actions entry 24). The drawer (kit role
// `drawer`, its knob tinted `brass`) slides straight out of the front (+z) by DRAWER_TRAVEL; the hand stays on the knob
// (native slide path in hand-actuator.ts) and the viewer moves the drawer on the same recorded timeline. The lower drawers
// are fixed fronts. A container, never a passage; no contents yet.
import type { DefInput } from '../schemas.ts';
const box = (at: number[], size: number[], tint: string, extra: Record<string, unknown> = {}) => ({ kind: 'box', at, size, round: 0.004, tint, ...extra });
const knob = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ kind: 'sphere', at: [x, y, 0.265], r: 0.022, segments: 8, tint: 'brass', ...extra });
const W = 0.9, H = 1.25, D = 0.5, TOP = [1.0, 1.21];   // carcass; the top drawer's opening (y)
const drawer = { role: 'drawer', pivot: [0, (TOP[0] + TOP[1]) / 2, 0.25] };
const palette = { wood: '#7f5535', front: '#93613f', inside: '#c9a77c', brass: '#c8a24a' };

export const HAND_DRAWERS: DefInput[] = [{
  schema: 'def/1', name: 'core-drawer-chest', version: 1,
  description: 'A tall wooden chest of drawers (1.25 m). A Soul slides the top drawer open and shut by hand at its knob; the lower drawers are fixed.',
  tags: ['furniture', 'storage', 'drawers', 'hand-operated', 'hand-drawer'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.004, shapes: [
    box([-(W / 2 - 0.0125), H / 2, 0], [0.025, H, D], 'wood', { collide: true }), box([W / 2 - 0.0125, H / 2, 0], [0.025, H, D], 'wood', { collide: true }),
    box([0, H / 2, -D / 2 + 0.01], [W, H, 0.02], 'wood'), box([0, H + 0.015, 0.005], [W + 0.03, 0.03, D + 0.03], 'wood'),
    box([0, 0.04, 0], [W, 0.08, D - 0.02], 'wood'), box([0, TOP[0] - 0.01, 0], [W - 0.05, 0.02, D - 0.03], 'wood'),
    box([0, (TOP[0] + TOP[1]) / 2, -D / 2 + 0.03], [W - 0.05, TOP[1] - TOP[0], 0.01], 'inside'),
    ...[0.84, 0.55, 0.26].flatMap((y) => [box([0, y, 0.24], [W - 0.06, 0.27, 0.02], 'front'), knob(-0.22, y), knob(0.22, y)]),
    // the drawer: front, a hollow box behind it and its knob, all moving together
    box([0, (TOP[0] + TOP[1]) / 2, 0.24], [W - 0.06, TOP[1] - TOP[0] - 0.01, 0.02], 'front', drawer),
    box([-(W / 2 - 0.05), TOP[0] + 0.08, 0.02], [0.012, 0.15, 0.42], 'inside', drawer), box([W / 2 - 0.05, TOP[0] + 0.08, 0.02], [0.012, 0.15, 0.42], 'inside', drawer),
    box([0, TOP[0] + 0.01, 0.02], [W - 0.1, 0.012, 0.42], 'inside', drawer), box([0, TOP[0] + 0.08, -0.19], [W - 0.1, 0.15, 0.012], 'inside', drawer),
    knob(0, (TOP[0] + TOP[1]) / 2, drawer)] } } as unknown as DefInput['make'],
  params: Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])) as DefInput['params'],
  palette,
  state: { open: { type: 'bool', default: false } } as DefInput['state'],
  components: { container: { capacity: 1 } } as DefInput['components'],
  size: { box: [W, H, D] },
  actions: [
    { name: 'open', label: 'Open the drawer', roles: 'anyone', reach: 'touch', params: {}, when: [{ field: 'open', is: false }], then: [{ op: 'set', field: 'open', value: true }] },
    { name: 'close', label: 'Close the drawer', roles: 'anyone', reach: 'touch', params: {}, when: [{ field: 'open', is: true }], then: [{ op: 'set', field: 'open', value: false }] }] as DefInput['actions'],
} as unknown as DefInput];
