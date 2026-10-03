// Synthetic "Mars proving ground" (SPEC section 28), Y-up metres, triangle soup.
// Layout (plan view, X right, Z down):
//   wall test      : wall x=-15, z in [-28,-12]
//   U-trap         : back wall z=-26 x in [-4,4], sides x=+-4 z in [-26,-16], open to +Z
//   narrow passage : barrier z=-20 across x in [8,30] with a 1.0 m wide, 4 m long corridor at x in [19.5,20.5]
//   platform A     : x in [-10,0], z in [5,15], deck top y=2.88 (16 x 0.18), complete stair on its west side
//   platform B     : x in [8,18], z in [5,15], same, stair missing steps 6..11
// Everything is closed boxes with outward-facing triangles.

export const RISE = 0.18, TREAD = 0.28, STEPS = 16, DECK = RISE * STEPS; // 2.88
export const DECK_THICK = 0.2;

export function makeProvingGround({ missingSteps = [6, 7, 8, 9, 10, 11], completeB = false, passage = 1.0 } = {}) {
  const pos = [], idx = [];
  const boxes = []; // [minx,miny,minz,maxx,maxy,maxz, label]
  const box = (x0, y0, z0, x1, y1, z1, label) => {
    boxes.push([x0, y0, z0, x1, y1, z1, label]);
    const b = pos.length / 3;
    const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) pos.push(x, y, z);
    const quads = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]];
    for (const q of quads) {
      for (const t of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
        // orient outward: normal . (centroid - boxcenter) > 0
        const P = t.map((i) => pos.slice((b + i) * 3, (b + i) * 3 + 3));
        const e0 = P[1].map((v, k) => v - P[0][k]), e1 = P[2].map((v, k) => v - P[0][k]);
        const n = [e0[1] * e1[2] - e0[2] * e1[1], e0[2] * e1[0] - e0[0] * e1[2], e0[0] * e1[1] - e0[1] * e1[0]];
        const cen = [0, 1, 2].map((k) => (P[0][k] + P[1][k] + P[2][k]) / 3 - c[k]);
        const d = n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2];
        idx.push(...(d >= 0 ? t : [t[0], t[2], t[1]]).map((i) => b + i));
      }
    }
  };
  // ground slab (top at y=0)
  box(-30, -0.2, -30, 30, 0, 30, 'ground');
  const H = 2.5, T = 0.1; // wall height, half thickness
  box(-15 - T, 0, -28, -15 + T, H, -12, 'wall');
  // U
  box(-4, 0, -26 - T, 4, H, -26 + T, 'u-back');
  box(-4 - T, 0, -26, -4 + T, H, -16, 'u-left');
  box(4 - T, 0, -26, 4 + T, H, -16, 'u-right');
  // narrow passage: barrier + 4 m corridor, 1.0 m clear between inner faces
  const cw = 20 - passage / 2, ce = 20 + passage / 2;
  box(8, 0, -20 - T, cw - T, H, -20 + T, 'barrier-w');
  box(ce + T, 0, -20 - T, 30, H, -20 + T, 'barrier-e');
  box(cw - 2 * T, 0, -22, cw, H, -18, 'corridor-w');
  box(ce, 0, -22, ce + 2 * T, H, -18, 'corridor-e');
  box(8 - T, 0, -30, 8 + T, H, -8, 'passage-side'); // forces use of corridor from the east field
  // platforms + posts + stairs
  const platform = (px0, pz0, name, missing) => {
    const px1 = px0 + 10, pz1 = pz0 + 10;
    box(px0, DECK - DECK_THICK, pz0, px1, DECK, pz1, `${name}-deck`);
    for (const [x, z] of [[px0, pz0], [px1 - 0.3, pz0], [px0, pz1 - 0.3], [px1 - 0.3, pz1 - 0.3]]) box(x, 0, z, x + 0.3, DECK - DECK_THICK, z + 0.3, `${name}-post`);
    // stair on west side, climbing +X, 1.2 m wide at z in [9.4, 10.6]
    const sx0 = px0 - STEPS * TREAD;
    for (let i = 1; i <= STEPS; i++) {
      if (missing.includes(i)) continue;
      // solid step blocks; upper steps of the broken stair float (no support) on purpose
      const y0 = missing.length && i > Math.max(...missing) ? i * RISE - 0.05 : 0;
      box(sx0 + (i - 1) * TREAD, y0, pz0 + 4.4, sx0 + i * TREAD, i * RISE, pz0 + 5.6, `${name}-step${i}`);
    }
    return { deck: [px0, px1, pz0, pz1], stair: [sx0, px0, pz0 + 4.4, pz0 + 5.6] };
  };
  const A = platform(-10, 5, 'A', []);
  const B = platform(8, 5, 'B', completeB ? [] : missingSteps);
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), boxes, A, B };
}

// Canonical query points (y = floor height)
export const P = {
  wallStart: [-18, 0, -20], wallEnd: [-12, 0, -20],
  uStart: [0, 0, -24], uEnd: [0, 0, -29],
  passSouth: [20, 0, -26], passNorth: [20, 0, -14],
  groundW: [-20, 0, 10],
  underA: [-5, 0, 10], topA: [-5, DECK, 10], // same XZ, different floors
  underA2: [-3, 0, 12], topA2: [-3, DECK, 12],
  underB: [13, 0, 10], topB: [13, DECK, 10],
  stairBBottom: [8 - STEPS * TREAD - 0.8, 0, 10], stairBTop: [9, DECK, 10],
};
