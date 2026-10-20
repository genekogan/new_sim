// Lane U3 (Gene 2026-10-20b): "add the Eden logo (the green 6 sided star one) to top left before live button and it links
// to sim.eden.art". Drawn after Eden's mark (eden3 apps/web/public/eden-logo.png): an upper pyramid over a dark diamond,
// a lower chevron and four side triangles, lit from the left. Inline so it is sharp at every DPR and costs no request.
export const EDEN_HOME = 'https://sim.eden.art';
const LIGHT = '#a3b97a', MID = '#55703a', DEEP = '#5e7c3f', DARK = '#2e4420';
const FACES: readonly [string, string][] = [
  ['510,45 510,362 232,528', LIGHT], ['510,45 788,528 510,362', MID],
  ['232,528 510,362 510,698', DEEP], ['510,362 788,528 510,698', DARK],
  ['232,562 510,728 510,972', LIGHT], ['788,562 510,972 510,728', MID],
  ['108,360 310,360 214,528', LIGHT], ['710,360 912,360 806,528', MID],
  ['214,560 320,728 118,728', LIGHT], ['806,560 900,728 700,728', MID],
];
export function EdenMark() {
  return <a className="eden-mark" href={EDEN_HOME} aria-label="Eden: all worlds" title="Eden">
    <svg viewBox="90 30 840 960" aria-hidden="true">{FACES.map(([points, fill]) => <polygon key={points} points={points} fill={fill} />)}</svg>
  </a>;
}
