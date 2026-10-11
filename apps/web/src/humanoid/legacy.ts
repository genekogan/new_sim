// Migration: the core/humanoid@2 look that reproduces a body's appearance today, for bodies with no params.
// Template by id hash (humans.ts templateFor) → preset; the 8 audited public Souls of the social-preset cohort
// (presets.mjs SOCIAL_PUBLIC_ASSIGNMENTS, applied today only when the template matches) → their palette as
// explicit colours. With this, the provenance-gated adapter is no longer needed for those Souls.
import {SOCIAL_PUBLIC_ASSIGNMENTS, SOCIAL_HUMAN_PRESETS} from '../../../../mars/viewer/app/engine-view/content/details/human-presets/presets.mjs';
import {legacyPreset, PRESET_LOOKS, resolveLook, type Look, type Preset} from './look.ts';

/** GLB material name → look colour keys, per legacy template (Skin_Darker follows skin, as presets.mjs pairs it). */
const COLOUR_OF: Record<Preset, Record<string, (keyof Look)[]>> = {
  casual: {Skin: ['skin'], LightBrown: ['top1'], Red_Dark: ['shoes1'], White: ['soles'], Eyebrows: ['brows'], Hair: ['hair1'], LightBlue: ['bottom1'], Eye: ['eyes']},
  punk: {Skin: ['skin'], White: ['top2'], Black: ['top1', 'shoes1', 'soles'], Eyebrows: ['brows'], Red: ['hair1'], Earrings: ['accent'], LightBlue: ['bottom1'], Eye: ['eyes']},
  woman: {Skin: ['skin'], White: ['top1'], Grey: ['shoes1', 'soles'], Hair_Brown: ['brows'], Hair_Blond: ['hair1'], Orange: ['bottom1'], Brown: ['eyes']},
};
type SocialRow = {actorId: string; stableSoulKey: string; template: string; presetId: string};
type SocialPreset = {id: string; template: Preset; materialSlots: {name: string; sRGBHex: string | null}[]};

/** The explicit look of a social palette on its template (unlisted slots keep the template's colours). */
export function socialLook(presetId: string): Look | null {
  const p = (SOCIAL_HUMAN_PRESETS as unknown as SocialPreset[]).find(x => x.id === presetId); if (!p) return null;
  const look: Look = {preset: 'none', ...PRESET_LOOKS[p.template]};
  for (const m of p.materialSlots) if (m.sRGBHex) for (const k of COLOUR_OF[p.template][m.name] ?? []) (look as Record<string, unknown>)[k] = m.sRGBHex.toLowerCase();
  return resolveLook(look);
}
/** Today's look of a humanoid with no params. `socialPresets` mirrors the viewer's humanPresets flag. */
export function legacyLook(entityId: string, publicSoulKey?: string, socialPresets = false): Look {
  const preset = legacyPreset(entityId);
  if (socialPresets && publicSoulKey) {
    const row = (SOCIAL_PUBLIC_ASSIGNMENTS as unknown as SocialRow[]).find(r => r.stableSoulKey === publicSoulKey);
    if (row && row.template === preset) { const look = socialLook(row.presetId); if (look) return look; }
  }
  return resolveLook({preset});
}
