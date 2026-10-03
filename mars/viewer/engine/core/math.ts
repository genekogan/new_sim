// Minimal deterministic vector/pose math. World frame matches the studio:
// metres, Y up, ground plane X/Z. Yaw is rotation about +Y (radians,
// counter-clockwise seen from above, 0 = facing +X).
//
// Engine code must use dsin/dcos/dtan/dasin/dacos/datan/datan2/dexp/dlog from
// this file, never the Math.* transcendentals: ECMAScript leaves those
// implementation-approximated, and V8 builds already disagree in the last bit
// (Chromium vs Node), which breaks cross-host state hashes. The versions below
// use only IEEE-754 +, -, *, /, sqrt (exactly specified), Math.round/abs and
// bit access, so every conforming engine returns the same bits. Enforced by
// engine/test/core.test.ts (source scan).
export type Vec3 = [number, number, number];
export type Vec2 = [number, number]; // (x, z)

export const FT = 0.3048;
export const IN = 0.0254;

export const v2 = (x: number, z: number): Vec2 => [x, z];
export const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale2 = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot2 = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
/**
 * √(x² + y² + z²) from correctly rounded IEEE operations only. Host `Math.hypot` is
 * implementation-approximated (V8, SpiderMonkey and JavaScriptCore use different algorithms and can
 * differ in the last bit), which breaks cross-host state hashes; it is banned in engine source
 * (core.test.ts). No overflow guard: engine lengths are metres.
 */
export const hypot = (x: number, y: number, z = 0) => Math.sqrt(x * x + y * y + z * z);
export const len2 = (a: Vec2) => hypot(a[0], a[1]);
export const dist2 = (a: Vec2, b: Vec2) => hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const norm2 = (a: Vec2): Vec2 => {
  const l = len2(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};
/** Rotate (x, z) by yaw about +Y (counter-clockwise from above). */
export const rot2 = (a: Vec2, yaw: number): Vec2 => {
  const c = dcos(yaw), s = dsin(yaw);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};
export const heading = (d: Vec2) => datan2(d[1], d[0]);
export const wrapAngle = (a: number) => {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
};
export const angleDelta = (from: number, to: number) => wrapAngle(to - from);
/** Round to 1e-6 so hashed/recorded state is stable across float noise. */
export const q6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Oriented rectangle footprint on the ground plane. */
export type OBB2 = { c: Vec2; half: Vec2; yaw: number };

export function obbCorners(o: OBB2): Vec2[] {
  const [hx, hz] = o.half;
  return ([[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]] as Vec2[]).map((p) => add2(o.c, rot2(p, o.yaw)));
}

/** Separating-axis test between two oriented rectangles (touching = overlap). */
export function obbOverlap(a: OBB2, b: OBB2, margin = 0): boolean {
  const ca = obbCorners(a), cb = obbCorners(b);
  const axes: Vec2[] = [rot2([1, 0], a.yaw), rot2([0, 1], a.yaw), rot2([1, 0], b.yaw), rot2([0, 1], b.yaw)];
  for (const ax of axes) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const p of ca) { const d = dot2(p, ax); amin = Math.min(amin, d); amax = Math.max(amax, d); }
    for (const p of cb) { const d = dot2(p, ax); bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
    if (amax + margin < bmin || bmax + margin < amin) return false;
  }
  return true;
}

export function pointInObb(p: Vec2, o: OBB2, margin = 0): boolean {
  const l = rot2(sub2(p, o.c), -o.yaw);
  return Math.abs(l[0]) <= o.half[0] + margin && Math.abs(l[1]) <= o.half[1] + margin;
}

/** Distance from point to segment ab. */
export function distPointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub2(b, a);
  const t = clamp(dot2(sub2(p, a), ab) / Math.max(dot2(ab, ab), 1e-12), 0, 1);
  return dist2(p, add2(a, scale2(ab, t)));
}

// ---------------------------------------------------------------------------
// Deterministic transcendentals (fdlibm / FreeBSD msun algorithms, pure
// arithmetic). Accuracy: <= 1 ulp vs a correctly rounded result for the
// trig kernels, <= 2 ulp for dtan/dasin/dacos (verified in core.test.ts).
// Range reduction is exact for |x| < 2^20 * pi/2 (~1.65e6). Beyond that the
// argument is first folded with the exactly-specified % by a 33-bit 2*pi: the
// result stays deterministic and in range, but is not an accurate sin/cos of
// such huge arguments (no Payne-Hanek; the engine never gets near 1e6 rad).

// sin/cos kernel coefficients on [-pi/4, pi/4] (msun k_sin.c / k_cos.c)
const S1 = -1.66666666666666324348e-1, S2 = 8.33333333332248946124e-3, S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6, S5 = -2.50507602534068634195e-8, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2, C2 = -1.38888888888741095749e-3, C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7, C5 = 2.08757232129817482790e-9, C6 = -1.13596475577881948265e-11;

/** sin(x + y) for |x + y| <= ~pi/4, y the tail of a reduced argument. */
function ksin(x: number, y: number): number {
  const z = x * x, w = z * z, r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6), v = z * x;
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
/** cos(x + y) for |x + y| <= ~pi/4. */
function kcos(x: number, y: number): number {
  const z = x * x, w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z, h = 1 - hz;
  return h + (((1 - h) - hz) + (z * r - x * y));
}

// Cody-Waite pi/2 in three 33-bit pieces + tail (fdlibm e_rem_pio2.c): n * piece
// is exact for |n| < 2^20, so x - n*pi/2 is formed to ~150 bits.
const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417e0, PIO2_2 = 6.07710050630396597660e-11;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
const PIO4 = 7.85398163397448278999e-1;
// reduced argument (head, tail) of the last remPio2 call; module scratch keeps the hot path allocation-free
let RY0 = 0, RY1 = 0;

const REM_EXACT = 1647099.3291652855; // 2^20 * pi/2
const TWO_PI_33 = 4 * PIO2_1; // exactly representable

/** x = n*pi/2 + (RY0 + RY1) with |RY0 + RY1| <= ~pi/4; returns n. Finite x only. */
function remPio2(x: number): number {
  if (x >= REM_EXACT || x <= -REM_EXACT) x %= TWO_PI_33; // deterministic fold, see header
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_1; // exact (Sterbenz; n*PIO2_1 exact)
  const a = n * PIO2_2; // exact
  const s = r - a;
  let v = s - r; // two-sum(r, -a)
  const lo = (r - (s - v)) - (a + v) - (n * PIO2_3 + n * PIO2_3T);
  const y0 = s + lo;
  v = y0 - s; // two-sum(s, lo)
  RY1 = (s - (y0 - v)) + (lo - v);
  RY0 = y0;
  return n;
}

const TINY_TRIG = 7.450580596923828e-9; // 2^-27: sin x = x, cos x = 1, tan x = x to within 1/2 ulp

/** Deterministic sin(x) (<= 1 ulp). */
export function dsin(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax <= PIO4) {
    if (ax < TINY_TRIG) return x; // keeps -0
    const z = x * x, w = z * z, r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
    return x + z * x * (S1 + z * r);
  }
  if (!(ax < Infinity)) return NaN;
  const n = remPio2(x) & 3;
  return n === 0 ? ksin(RY0, RY1) : n === 1 ? kcos(RY0, RY1) : n === 2 ? -ksin(RY0, RY1) : -kcos(RY0, RY1);
}

/** Deterministic cos(x) (<= 1 ulp). */
export function dcos(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax <= PIO4) return ax < TINY_TRIG ? 1 : kcos(x, 0);
  if (!(ax < Infinity)) return NaN;
  const n = remPio2(x) & 3;
  return n === 0 ? kcos(RY0, RY1) : n === 1 ? -ksin(RY0, RY1) : n === 2 ? -kcos(RY0, RY1) : ksin(RY0, RY1);
}

/** Deterministic tan(x) (<= 2 ulp), as the ratio of the shared-reduction kernels. */
export function dtan(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax <= PIO4) return ax < TINY_TRIG ? x : ksin(x, 0) / kcos(x, 0);
  if (!(ax < Infinity)) return NaN;
  const odd = remPio2(x) & 1;
  const s = ksin(RY0, RY1), c = kcos(RY0, RY1);
  return odd ? -c / s : s / c;
}

// atan (fdlibm s_atan.c): atan(x) = atan(c) + atan((x - c) / (1 + x*c)) around c in {0.5, 1, 1.5, inf}
const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT0 = 3.33333333333329318027e-1, AT1 = -1.99999999998764832476e-1, AT2 = 1.42857142725034663711e-1;
const AT3 = -1.11111104054623557880e-1, AT4 = 9.09088713343650656196e-2, AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2, AT7 = -5.83357013379057348645e-2, AT8 = 4.97687799461593236017e-2;
const AT9 = -3.65315727442169155270e-2, AT10 = 1.62858201153657823623e-2;

/** Deterministic atan(x) (<= 1 ulp). */
export function datan(x: number): number {
  if (x !== x) return x;
  const neg = x < 0;
  let ax = neg ? -x : x, id: number;
  if (ax >= 7.378697629483821e19) return neg ? -ATAN_HI[3] - ATAN_LO[3] : ATAN_HI[3] + ATAN_LO[3]; // |x| >= 2^66
  if (ax < 0.4375) {
    if (ax < 1.862645149230957e-9) return x; // |x| < 2^-29 (keeps -0)
    id = -1;
    ax = x;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) { id = 0; ax = (2 * ax - 1) / (2 + ax); }
    else { id = 1; ax = (ax - 1) / (ax + 1); }
  } else if (ax < 2.4375) { id = 2; ax = (ax - 1.5) / (1 + 1.5 * ax); }
  else { id = 3; ax = -1 / ax; }
  const z = ax * ax, w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) return ax - ax * (s1 + s2);
  const r = ATAN_HI[id] - ((ax * (s1 + s2) - ATAN_LO[id]) - ax);
  return neg ? -r : r;
}

// fdlibm e_atan2.c pi / pi_lo / pi_o_2; pi_lo is written at double precision (it parses to the same double as fdlibm's 1.2246467991473531772e-16).
const PI_ = 3.14159265358979311600e0, PI_LO = 1.2246467991473532e-16, PIO2_ = 1.57079632679489655800e0;
const isNeg = (v: number) => v < 0 || (v === 0 && 1 / v < 0);

/** Deterministic atan2(y, x) (<= 1 ulp), ECMAScript/C99 special cases incl. signed zeros. */
export function datan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x === 1) return datan(y);
  const m = (isNeg(y) ? 1 : 0) | (isNeg(x) ? 2 : 0);
  if (y === 0) return m === 0 || m === 1 ? y : m === 2 ? PI_ : -PI_;
  if (x === 0) return m & 1 ? -PIO2_ : PIO2_;
  if (x === Infinity || x === -Infinity) {
    if (y === Infinity || y === -Infinity) return [PIO4, -PIO4, 3 * PIO4, -3 * PIO4][m];
    return [0, -0, PI_, -PI_][m];
  }
  if (y === Infinity || y === -Infinity) return m & 1 ? -PIO2_ : PIO2_;
  const ay = y < 0 ? -y : y, ax = x < 0 ? -x : x;
  if (ay > ax * 1.152921504606847e18) return m & 1 ? -PIO2_ - 0.5 * PI_LO : PIO2_ + 0.5 * PI_LO; // |y/x| > 2^60
  const z = m & 2 && ay * 1.152921504606847e18 < ax ? 0 : datan(ay / ax); // |y/x| < 2^-60 with x < 0 -> pi
  return m === 0 ? z : m === 1 ? -z : m === 2 ? PI_ - (z - PI_LO) : (z - PI_LO) - PI_;
}

/** Deterministic asin(x) = atan2(x, sqrt((1-x)(1+x))) (<= 2 ulp); NaN outside [-1, 1]. */
export const dasin = (x: number): number => datan2(x, Math.sqrt((1 - x) * (1 + x)));
/** Deterministic acos(x) = atan2(sqrt((1-x)(1+x)), x) (<= 2 ulp); NaN outside [-1, 1]. */
export const dacos = (x: number): number => datan2(Math.sqrt((1 - x) * (1 + x)), x);

// Bit access for exp/log (IEEE-754 binary64 words).
const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
F64[0] = 1;
const HI = U32[1] === 0x3ff00000 ? 1 : 0, LO = 1 - HI;
/** 2^k for integer k in [-1022, 1023], exact. */
function pow2(k: number): number {
  U32[HI] = (k + 1023) << 20;
  U32[LO] = 0;
  return F64[0];
}

// exp (fdlibm e_exp.c): x = k ln2 + r, exp(r) by a Remez rational form
const LN2_HI = 6.93147180369123816490e-1, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e0;
const P1 = 1.66666666666666019037e-1, P2 = -2.77777777770155933842e-3, P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6, P5 = 4.13813679705723846039e-8;

/** Deterministic exp(x) (<= 1 ulp). */
export function dexp(x: number): number {
  if (x !== x) return x;
  if (x > 7.09782712893383973096e2) return Infinity;
  if (x < -7.45133219101941108420e2) return 0;
  const ax = x < 0 ? -x : x;
  let hi = 0, lo = 0, k = 0;
  if (ax > 0.34657359027997264) { // 0.5 ln2
    if (ax < 1.0397207708399179) { // 1.5 ln2
      k = x < 0 ? -1 : 1;
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    } else {
      k = x < 0 ? -Math.round(-INV_LN2 * x) : Math.round(INV_LN2 * x);
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (ax < 3.725290298461914e-9) return 1 + x; // 2^-28
  const t = x * x, c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - ((lo - (x * c) / (2 - c)) - hi);
  return k >= -1021 ? (k > 1023 ? y * 2 * pow2(k - 1) : y * pow2(k)) : y * pow2(k + 1000) * pow2(-1000);
}

// log (fdlibm e_log.c): x = 2^k (1 + f), log(1 + f) = f - s(f - R), s = f / (2 + f)
const LG1 = 6.666666666666735130e-1, LG2 = 3.999999999940941908e-1, LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1, LG5 = 1.818357216161805012e-1, LG6 = 1.531383769920937332e-1, LG7 = 1.479819860511658591e-1;

/** Deterministic natural log(x) (<= 1 ulp). */
export function dlog(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  let k = 0;
  if (x < 2.2250738585072014e-308) { k = -54; x *= 18014398509481984; } // subnormal: scale by 2^54
  F64[0] = x;
  let hx = U32[HI];
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i0 = (hx + 0x95f64) & 0x100000;
  U32[HI] = hx | (i0 ^ 0x3ff00000); // normalize x or x/2 into [sqrt(2)/2, sqrt(2))
  k += i0 >> 20;
  const f = F64[0] - 1, dk = k;
  if ((0x000fffff & (2 + hx)) < 3) { // |f| < 2^-20
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const R = f * f * (0.5 - 0.3333333333333333 * f); // fdlibm 0.33333333333333333, same double
    return k === 0 ? f - R : dk * LN2_HI - ((R - dk * LN2_LO) - f);
  }
  const s = f / (2 + f), z = s * s, w = z * z;
  const i = (hx - 0x6147a) | (0x6b851 - hx);
  const R = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7))) + w * (LG2 + w * (LG4 + w * LG6));
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + R)) : dk * LN2_HI - ((hfsq - (s * (hfsq + R) + dk * LN2_LO)) - f);
  }
  return k === 0 ? f - s * (f - R) : dk * LN2_HI - ((s * (f - R) - dk * LN2_LO) - f);
}
