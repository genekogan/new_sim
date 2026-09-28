import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// The original host-Math ban, now applied only to executable tokens rather than comments.
const HOST_MATH = /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|cbrt|pow|hypot)\b/;

/** Keep code and newlines at their original offsets; blank comments and literal bodies. */
function codeOnly(src: string): string {
  const out: string[] = src.split('').map((c) => c === '\n' ? '\n' : ' ');
  let i = 0;
  const word = (c: string | undefined) => !!c && /[A-Za-z_$]/.test(c);
  const ident = (c: string | undefined) => !!c && /[\w$]/.test(c);
  function quote(q: string) {
    i++;
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i++] === q) return;
    }
  }
  function regex() {
    i++;
    let cls = false;
    while (i < src.length) {
      const c = src[i++];
      if (c === '\\') { i++; continue; }
      if (c === '[') cls = true;
      else if (c === ']') cls = false;
      else if (c === '/' && !cls) break;
    }
    while (ident(src[i])) i++;
  }
  function template() {
    i++; // opening backtick
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; code(true); continue; }
      i++;
    }
  }
  function code(interpolation = false) {
    let depth = interpolation ? 1 : 0;
    let regexAllowed = true;
    while (i < src.length) {
      const c = src[i], next = src[i + 1];
      if (/\s/.test(c)) { out[i] = c; i++; continue; }
      if (c === '/' && next === '/') { i += 2; while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && next === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i = Math.min(src.length, i + 2); continue; }
      if (c === '"' || c === "'") { quote(c); regexAllowed = false; continue; }
      if (c === '`') { template(); regexAllowed = false; continue; }
      if (c === '/' && regexAllowed) { regex(); regexAllowed = false; continue; }
      if (word(c)) {
        const start = i;
        while (ident(src[i])) { out[i] = src[i]; i++; }
        regexAllowed = /^(return|throw|case|delete|void|typeof|instanceof|in|of|yield|await)$/.test(src.slice(start, i));
        continue;
      }
      if (/[0-9]/.test(c)) {
        while (i < src.length && /[0-9A-Za-z_.]/.test(src[i])) { out[i] = src[i]; i++; }
        regexAllowed = false;
        continue;
      }
      out[i] = c;
      i++;
      if (c === '{') { depth++; regexAllowed = true; }
      else if (c === '}') { depth--; regexAllowed = false; if (interpolation && depth === 0) return; }
      else regexAllowed = !/[)\].]/.test(c);
    }
  }
  code();
  return out.join('');
}

// Exact site identity is path + trimmed source line. Removing a site also requires deleting its entry.
const EXISTING_EXPONENTS: readonly [string, string][] = [
  ['camera/quality.ts', 'if (q.contacts && q.contacts.some((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2 <= cr2)) continue;'],
  ['carry/fragile.ts', 'const run = Math.sqrt((b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2);'],
  ['construction/invariants.ts', 'const hz = Math.sqrt((p[0] - h.pose.p[0]) ** 2 + (p[2] - h.pose.p[2]) ** 2);'],
  ['construction/solar.ts', 'const d = Math.sqrt((b.p[0] - a.p[0]) ** 2 + (b.p[1] - a.p[1]) ** 2 + (b.p[2] - a.p[2]) ** 2) + Math.abs(angleDelta(a.yaw, b.yaw)) + Math.abs((b.pitch ?? 0) - (a.pitch ?? 0)) + Math.abs((b.roll ?? 0) - (a.roll ?? 0));'],
  ['construction/stance.ts', 'const l = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2);'],
  ['core/hash.ts', 'view.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));'],
  ['env/sun.ts', 'arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;'],
  ['social/actions.ts', 'const cost = moves.reduce((s, m, j) => s + dist2(m.p, pos2(order[j].a)) ** 2, 0);'],
  ['social/slots.ts', 'if (id && id !== except) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = id; } }'],
  ['spatial/grid.ts', 'if (id) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = id; } }'],
  ['spatial/path.ts', 'const d = (i - ci) ** 2 + (j - cj) ** 2;'],
  ['take/metrics.ts', 'const d = Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) / POS_Q;'],
  ['take/metrics.ts', 'const d = Math.sqrt((e.pose.p[0] - q[0]) ** 2 + (e.pose.p[2] - q[1]) ** 2);'],
  ['vehicles/curve.ts', 'const d = (i - ci) ** 2 + (j - cj) ** 2;'],
];
const site = (file: string, line: string) => `${file}\0${line}`;

function scannerFixtures() {
  const allowed = [
    '/** a ** b */',
    "const glob = '**/*.ts';",
    'const regex = /\\*\\*|Math\\.sin/;',
    'const okay = Math.sqrt(4) + Math.abs(-1);',
    'const plain = `comment ** text`;',
  ].join('\n');
  assert.doesNotMatch(codeOnly(allowed), /\*\*|Math\.sin/);
  const banned = [
    'const t = `value ${a ** b}`;',
    'const x = Math.sin(1) + Math.hypot(1, 2);',
    'let y = a ** b;',
    'y **= 2;',
  ].join('\n');
  const code = codeOnly(banned);
  assert.equal((code.match(/\*\*/g) ?? []).length, 3);
  assert.match(code, /Math\.sin/);
  assert.match(code, /Math\.hypot/);
}

test('engine production source excludes host Math transcendentals and new ** / **= operators; 14 existing sites are allowlisted', () => {
  scannerFixtures();
  const root = path.resolve(import.meta.dirname, '..');
  const host: string[] = [], exponents: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (ent.name !== 'test') walk(path.join(dir, ent.name));
        continue;
      }
      if (!/\.(ts|tsx|mts|js|mjs)$/.test(ent.name)) continue;
      const file = path.join(dir, ent.name), relative = path.relative(root, file).split(path.sep).join('/');
      const original = readFileSync(file, 'utf8').split('\n');
      codeOnly(original.join('\n')).split('\n').forEach((line, n) => {
        if (HOST_MATH.test(line)) host.push(`${relative}:${n + 1}: ${original[n].trim()}`);
        if (/\*\*=|\*\*/.test(line)) exponents.push(site(relative, original[n].trim()));
      });
    }
  };
  walk(root);
  assert.deepEqual(host, [], `use engine/core/math.ts instead of host Math:\n${host.join('\n')}`);
  assert.deepEqual(exponents.sort(), EXISTING_EXPONENTS.map(([f, l]) => site(f, l)).sort(),
    'each exponent operator in production code needs an exact-site review; delete stale allowlist entries when sites disappear');
});
