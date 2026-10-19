// P1 phones: the profile type and its all-on default, apart from the pinned capture-hash lists (optional-appearance-profiles.ts,
// which loads with the old worlds' scene kit)
export type OptionalAppearanceProfiles=Readonly<{understory:boolean;nativeSocial:boolean}>;
export const ALL_OPTIONAL_APPEARANCE_PROFILES:OptionalAppearanceProfiles=Object.freeze({understory:true,nativeSocial:true});
