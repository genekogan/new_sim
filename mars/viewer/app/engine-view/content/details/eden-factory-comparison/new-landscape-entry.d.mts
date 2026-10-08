import type{OwnedEdenFinish}from'../eden-expansion-materials/materials.mjs';
export type NewLandscapeKind='expansion-ground'|'expansion-path'|'cultivated-soil';
export type NewLandscapeRefusal=Readonly<{quality:'SimpleOriginal';reason:string;material:null}>;
export type NewLandscapeStudyFinish=OwnedEdenFinish&Readonly<{kind:NewLandscapeKind;baseline:Readonly<Record<string,unknown>>;provenance:Readonly<Record<string,unknown>>;actualAttachment:false;validateBeforeAttach():boolean}>;
/** Exact World-owned construction metadata/callback needed; this declaration is not renderer qualification. */
export function createNewLandscapeStudyFinish(input:unknown):NewLandscapeRefusal|NewLandscapeStudyFinish;
