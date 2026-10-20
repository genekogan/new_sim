// G5 (Gene 2026-10-20): god features switched off for simplicity; the code stays. The page's copy of the switch the
// server and the god CLI read (tools/god-skill/lib/features.mjs): keep the two in step.
//   flags          reference flags: their poles in the world, Alt+click to drop one, the Flags list
//   previews       a preview's ghost in the world (?preview=<id>) and the Previews list
//   constitution   the Constitution in the God modal (owner and visitor)
export type GodFeature = 'flags' | 'previews' | 'constitution';
export const GOD_FEATURES: Readonly<Record<GodFeature, boolean>> = { flags: false, previews: false, constitution: false };
export const godFeature = (name: GodFeature): boolean => GOD_FEATURES[name];
/** An owner's reference flag (core/flag@1 or its stored core-flag@1), not a flagpole. */
export const isFlagDef = (def: unknown) => /^core[-/]flag@/.test(String(def ?? ''));
