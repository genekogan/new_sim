export type GodFeature = 'flags' | 'previews' | 'constitution';
export declare const GOD_FEATURES: Readonly<Record<GodFeature, boolean>>;
export declare function godFeature(name: GodFeature): boolean;
