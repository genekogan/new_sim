/** Readonly metadata contracts only; no renderer, rig or binding authority. */
export type HumanTemplate = 'casual' | 'punk' | 'woman';
export type HumanPresetId = 'casual-river' | 'casual-clay' | 'punk-sage' | 'punk-plum' | 'longhair-ocean' | 'longhair-citrus';
export type LinearRGBA = readonly [number, number, number, number];
export interface SourceMaterial {
 readonly name: string;
 readonly doubleSided: boolean;
 readonly pbrMetallicRoughness: Readonly<{baseColorFactor: LinearRGBA; metallicFactor: number; roughnessFactor: number}>;
}
export interface SourcePrimitive {
 readonly node: string; readonly nodeIndex: number; readonly skin: number;
 readonly mesh: number; readonly meshName: string; readonly primitive: number;
 readonly material: number; readonly materialName: string;
 readonly attributes: Readonly<Record<string, number>>; readonly index: number;
 readonly positionCount: number; readonly vertexColors: readonly string[];
}
export interface HumanAssetMetadata {
 readonly path: string; readonly sha256: string; readonly bytes: number;
 readonly jsonSHA256: string; readonly binarySHA256: string;
 readonly materials: readonly SourceMaterial[]; readonly primitives: readonly SourcePrimitive[];
 readonly skins: readonly Readonly<{name: string; joints: readonly string[]; inverseBindMatrices: number}>[];
 readonly animations: readonly Readonly<{name: 'Idle' | 'Walk' | 'Wave'; channels: number; samplers: number}>[];
 readonly images: 0; readonly textures: 0; readonly extensionsUsed: readonly string[];
}
export interface MaterialBindingMetadata {
 readonly node: string; readonly mesh: number; readonly primitive: number; readonly vertexColors: readonly string[];
}
export interface HumanMaterialSlot {
 readonly index: number; readonly name: string;
 readonly operation: 'retain-original' | 'owned-clone-base-color' | 'owned-clone-paired-skin-shade';
 readonly sRGBHex: string | null; readonly baseColorLinear: LinearRGBA; readonly originalBaseColorLinear: LinearRGBA;
 readonly retainMetallicRoughnessSideAlpha: true; readonly retainOriginalMaps: true;
 readonly bindings: readonly MaterialBindingMetadata[];
}
export interface SimplePreset {
 readonly quality: 'Simple'; readonly bindingGranted: false; readonly reason: string;
}
export interface HumanPreset {
 readonly id: HumanPresetId; readonly label: string; readonly version: typeof PRESET_VERSION;
 readonly template: HumanTemplate; readonly sourceAssetSHA256: string; readonly sourceURL: string;
 readonly quality: 'InertPreset'; readonly bindingGranted: false;
 readonly materialSlots: readonly HumanMaterialSlot[];
 readonly geometryRigRootClips: string; readonly accessory: string;
 readonly costs: Readonly<{conditionalOwnedMaterialClones: number; extraTextures: 0; extraGeometry: 0; extraDraws: 0; actualHeapGPUFrame: null}>;
}
export type PresetSelection = HumanPreset | SimplePreset;
export declare const PRESET_VERSION: 'human-presets/1';
export declare const HUMAN_ASSETS: Readonly<Record<HumanTemplate, HumanAssetMetadata>>;
export declare const HUMAN_PRESETS: readonly HumanPreset[];
/** Invalid values intentionally accepted for runtime Simple fallback; no template writer. */
export declare function presetForSoul(stableSoulId: unknown, version?: unknown): PresetSelection;
export declare function presetForAsset(stableSoulId: unknown, version: unknown, assetSHA256: unknown): PresetSelection;
export declare function compatiblePresetForSoul(stableSoulKey: unknown, existingTemplateName: unknown, version: unknown, actualSourceGLBSHA: unknown): PresetSelection;

export type SocialHumanPresetId = HumanPresetId | 'casual-ochre' | 'casual-violet';
export interface SocialHumanPreset extends Omit<HumanPreset, 'id' | 'version'> {
 readonly id: SocialHumanPresetId; readonly version: typeof SOCIAL_PRESET_VERSION;
}
export declare const SOCIAL_PRESET_VERSION: 'human-presets/social-8/2';
export declare const SOCIAL_HUMAN_PRESETS: readonly SocialHumanPreset[];
export declare const SOCIAL_PUBLIC_SOURCE: Readonly<{sceneSHA256: string; takesSHA256: string; renderSceneRef: string}>;
export interface SocialPublicAssignment {readonly actorId: string; readonly stableSoulKey: string; readonly template: HumanTemplate; readonly presetId: SocialHumanPresetId; readonly version: typeof SOCIAL_PRESET_VERSION; readonly sourceAssetSHA256: string}
export declare const SOCIAL_PUBLIC_ASSIGNMENTS: readonly SocialPublicAssignment[];
export declare function socialPresetForSoul(stableSoulKey: unknown, existingTemplateName: unknown, version: unknown, actualSourceGLBSHA: unknown): SocialHumanPreset | SimplePreset;
export declare function presetByIdAndVersion(id: unknown, version: unknown): HumanPreset | SocialHumanPreset | SimplePreset;
