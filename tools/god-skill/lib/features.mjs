// G5 (Gene 2026-10-20): god features switched off for simplicity. The code stays; turn one back on here, or for one
// server or CLI process with SIM_GOD_FEATURES=flags,previews,constitution. The web has its own copy of the switch
// (apps/web/src/god-ui/features.ts).
//   flags          labelled reference flags (core/flag@1): the `flag`/`flags` verbs, Alt+click on the page, their poles
//   previews       the ghost of a preview on the page (?preview=<id>); the dry run and commit <id> stay
//   constitution   the Constitution: `constitution`, `amendments`, `decide`, `governance`, the residents' amendments
export const GOD_FEATURES = Object.freeze({ flags: false, previews: false, constitution: false });
const on = () => (typeof process === 'undefined' ? '' : process.env.SIM_GOD_FEATURES ?? '').split(',').map((s) => s.trim());
/** Is this god feature on? Read at call time, so a test (or one process) can turn it on. */
export const godFeature = (name) => GOD_FEATURES[name] === true || on().includes(name);
