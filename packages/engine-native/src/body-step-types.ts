/** Shared prospective normal-stair admission. No runtime/renderer writes. */
export type V3 = [number,number,number];
export type ObbXZ = {c:[number,number];half:[number,number];yaw:number};
export type MobilitySolid = {id:string;obb:ObbXZ;y0:number;y1:number};
export type MobilitySupport = {id:string;obb:ObbXZ;y:number;sourceIds:string[]};
export type HumanoidStairInput = {
 profileId:string;body:{family:string;model?:string;modelUrl?:string;avatar?:unknown};
 link:{id:string;kind:string;from:V3;to:V3;path:V3[];width:number;heading:number;treadSourceIDs:string[]};
 treads:MobilitySupport[];landings:{from:MobilitySupport;to:MobilitySupport};solids:MobilitySolid[];
 /** Actual native small-item base/grasp pose, not a client-selected approximation. */
 carried?:{id:string;size:V3;offset:V3;small:boolean};
};
export type MobilityDiagnostic = {code:string;message:string;subjects:string[];at?:V3};
export type HumanoidStairQualification = {ok:true;profileId:'human-stairs/1';samples:number;footSamples:number;sourceIds:string[];limits:string[]}|{ok:false;diagnostic:MobilityDiagnostic};
