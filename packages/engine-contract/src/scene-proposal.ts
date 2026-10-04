/** W-002 draft input/output for local proposal qualification, never an approved
 * live scene or a controller support/contact/admission claim. Metres, +Y up. */
export type SceneProposalRefV1 = {
  worldId:string; proposalId:string; revision:string;
  sourcePins:{ path:string; commit:string; sha256:string }[];
};
export type TerrainPatchV1 = {
  id:string; originXZ:[number,number]; spacingMetres:number;
  columns:number; rows:number; heightMetres:number[][];
  diagonal:'min-min/max-max';
};
export type VegetationPlacementV1 = {
  id:string; kind:'canopy-tree'|'conifer'|'shrub'|'grass'|'reeds'|'vine';
  p:[number,number,number]; size:[number,number,number]; yaw?:number; seed?:number;
};
export type CandidateRootV1 = {
  id:string; status:'terrain-aligned'; terrainId:string;
  p:[number,number,number]; normal:[number,number,number];
} | {
  id:string; status:'requires-support'; code:'outside-terrain'|'root-height-mismatch'; deltaY?:number;
};
export type ScenePlacementCandidateV1 = {
  contract:'scene-placement-candidate/1'; stage:'proposal-checked';
  ref:SceneProposalRefV1; terrain:TerrainPatchV1;
  placements:VegetationPlacementV1[]; roots:CandidateRootV1[];
  /** Neither a resolved root nor the visual crown is an admitted obstacle. */
  unresolved:['obstruction-policy','canonical-installation'];
};
