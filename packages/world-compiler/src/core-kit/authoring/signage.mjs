// Signage (L4): a sign with text, a notice board, a picture frame showing media, a poster, a
// chalkboard A-frame, a wayfinding signpost, a market banner. Text comes from state `text`
// (lines split by \n) or the `sign` component; frames show state `media` (an image URL). The
// faces are listed in make.args.faces and drawn by gen-mesh/kits/sign.mesh.ts.
import { box, cbox, cone, cyl, kitDef, sph } from './dsl.mjs';

const WOOD = '#8b6a48', DWOOD = '#5e4630', CREAM = '#efe2c0';
const sign = (name, description, tags, shapes, palette, faces, extra = {}) => kitDef({ name, description, tags: ['signage', 'sign-text', ...tags], shapes, palette, round: 0.012, extraArgs: { faces }, state: { text: { type: 'string', max: 400, default: '' }, ...(extra.state ?? {}) }, ...extra });

export default [
  sign('sign', 'A wooden sign on a post; shows its text (state text, up to 6 lines; e.g. "Welcome to Eden").', ['sign', 'wayfinding', 'marker'],
    [cbox([0, 0.8, 0], [0.1, 1.6, 0.1], 'post'), cbox([0, 1.55, 0.07], [1.2, 0.6, 0.05], 'board'), box([0, 1.88, 0.07], [1.26, 0.05, 0.08], 'post')],
    { post: DWOOD, board: CREAM }, [{ at: [0, 1.55, 0.1], w: 1.1, h: 0.5, bg: CREAM, ink: '#3a2a22' }], { components: { sign: { lines: ['Welcome'] } } }),
  sign('notice-board', 'A roofed notice board on two posts with pinned notes; its text is the notice (state text).', ['board', 'notice', 'village', 'readable'],
    [cbox([-0.7, 0.95, 0], [0.1, 1.9, 0.1], 'post'), cbox([0.7, 0.95, 0], [0.1, 1.9, 0.1], 'post'), cbox([0, 1.35, 0.03], [1.3, 0.9, 0.06], 'frame'), box([0, 1.93, 0.02], [1.6, 0.06, 0.4], 'roof', { pitch: 0.25 }),
      box([-0.42, 1.55, 0.07], [0.24, 0.28, 0.01], 'note1'), box([0.42, 1.15, 0.07], [0.26, 0.2, 0.01], 'note2')],
    { post: DWOOD, frame: WOOD, roof: '#5a4a3a', note1: '#f0d36a', note2: '#a9cfe0' }, [{ at: [0, 1.32, 0.065], w: 0.7, h: 0.6, bg: '#f4f1e8', ink: '#2a2622' }], { components: { readable: { pages: 1 }, sign: { lines: ['Notices'] } } }),
  sign('picture-frame', 'A framed picture to hang on a wall or stand on an easel; shows state media (image URL) or a painting.', ['frame', 'art', 'display', 'media', 'wall'],
    [cbox([0, 0.4, 0], [0.9, 0.7, 0.05], 'frame')],
    { frame: '#b8913f' }, [{ at: [0, 0.4, 0.028], w: 0.76, h: 0.56, media: true, bg: '#7fa7c9' }], { components: { display: { w: 0.76, h: 0.56 } }, state: { media: { type: 'string', max: 500, default: '' } }, layer: 'decor' }),
  sign('screen', 'A large display screen on legs (classroom or cinema); shows state media or text.', ['screen', 'display', 'media', 'classroom'],
    [cbox([0, 1.6, 0], [2.4, 1.4, 0.08], 'frame'), cyl([-1.0, 0.45, 0], 0.04, 0.9, 'leg', { seg: 5 }), cyl([1.0, 0.45, 0], 0.04, 0.9, 'leg', { seg: 5 }), box([0, 0.03, 0], [2.4, 0.06, 0.5], 'leg')],
    { frame: '#2b2b2b', leg: '#5a5f66' }, [{ at: [0, 1.6, 0.045], w: 2.25, h: 1.25, media: true, bg: '#20303f', ink: '#e8f1f6' }], { components: { display: { w: 2.25, h: 1.25 } }, state: { media: { type: 'string', max: 500, default: '' } } }),
  sign('poster', 'A paper poster on a pillar; its text is the poster (state text).', ['poster', 'advert', 'street'],
    [cyl([0, 1.25, 0], 0.32, 2.5, 'pillar', { seg: 10 }), cyl([0, 2.55, 0], 0.36, 0.12, 'cap', { seg: 10 }), cone([0, 2.75, 0], 0.3, 0.3, 'cap', { seg: 10 })],
    { pillar: '#2f5d4a', cap: '#24463a' }, [{ at: [0, 1.5, 0.325], w: 0.5, h: 0.75, bg: '#f1c84b', ink: '#2a2622' }], { components: { sign: { lines: ['Tonight', 'Music', 'at the', 'bandstand'] } } }),
  sign('chalkboard', 'A chalkboard A-frame (café menu); its text is chalk (state text).', ['chalkboard', 'menu', 'cafe', 'market'],
    [box([0, 0.45, 0.15], [0.62, 0.86, 0.03], 'wood', { pitch: -0.32 }), box([0, 0.45, -0.15], [0.62, 0.86, 0.03], 'wood', { pitch: 0.32 }), box([0, 0.47, 0.17], [0.54, 0.76, 0.01], 'slate', { pitch: -0.32 })],
    { wood: '#7d5a3a', slate: '#2d3330' }, [{ at: [0, 0.47, 0.18], w: 0.5, h: 0.7, pitch: -0.32, bg: '#2d3330', ink: '#f2f0e6', font: 'italic 600' }], { components: { sign: { lines: ['Soup', 'Bread', 'Tea'] } } }),
  sign('signpost', 'A wayfinding signpost with three arrow boards; each line of its text labels one arrow.', ['signpost', 'wayfinding', 'direction', 'marker'],
    [cbox([0, 1.25, 0], [0.1, 2.5, 0.1], 'post'), cone([0, 2.57, 0], 0.09, 0.14, 'cap', { seg: 4, yaw: Math.PI / 4 }),
      cbox([0.4, 2.18, 0.06], [0.72, 0.17, 0.035], 'b1'), cone([0.82, 2.18, 0.06], 0.12, 0.14, 'b1', { seg: 3, roll: -Math.PI / 2, scale: [1, 1, 0.25] }),
      cbox([0.06, 1.94, 0.38], [0.035, 0.17, 0.68], 'b2'), cone([0.06, 1.94, 0.78], 0.12, 0.14, 'b2', { seg: 3, pitch: Math.PI / 2, scale: [0.25, 1, 1] }),
      cbox([-0.4, 1.7, -0.06], [0.72, 0.17, 0.035], 'b3'), cone([-0.82, 1.7, -0.06], 0.12, 0.14, 'b3', { seg: 3, roll: Math.PI / 2, scale: [1, 1, 0.25] })],
    { post: DWOOD, cap: '#3f3a33', b1: CREAM, b2: '#d9e6d0', b3: '#efd9c9' },
    [{ at: [0.38, 2.18, 0.08], w: 0.66, h: 0.15, bg: CREAM, ink: '#3a2a22', line: 0 }, { at: [0.08, 1.94, 0.36], w: 0.62, h: 0.15, yaw: Math.PI / 2, bg: '#d9e6d0', ink: '#3a2a22', line: 1 }, { at: [-0.38, 1.7, -0.08], w: 0.66, h: 0.15, yaw: Math.PI, bg: '#efd9c9', ink: '#3a2a22', line: 2 }],
    { components: { sign: { lines: ['Market', 'Lake', 'Woods'] } } }),
  sign('banner', 'A market banner strung between two poles; its text is the banner (state text).', ['banner', 'market', 'festival', 'fabric'],
    [cyl([-2.0, 1.6, 0], 0.05, 3.2, 'pole', { seg: 6 }), cyl([2.0, 1.6, 0], 0.05, 3.2, 'pole', { seg: 6 }), sph([-2.0, 3.25, 0], 0.08, 'gold', { seg: 4 }), sph([2.0, 3.25, 0], 0.08, 'gold', { seg: 4 }), box([0, 2.7, 0], [3.9, 0.7, 0.02], 'cloth')],
    { pole: '#8a6a4a', gold: '#c79a3a', cloth: '#b0573a' }, [{ at: [0, 2.7, 0.012], w: 3.8, h: 0.62, bg: '#b0573a', ink: '#fbf6ea' }], { components: { sign: { lines: ['Market Day'] }, sway: { amount: 0.04, period: 4 } } }),
];
