/** Shapes inspected by the existing immutable publication guards. Types add no
 * authority: every imported/public value still passes the original runtime checks. */
import type {Entity} from '../../engine/world/types.ts';
import type {SpatialScene} from '../../engine/spatial/types.ts';
export type SocialPlacement={id:string;def:string;position:number[];yaw:number;regionId?:string};
export type SocialPath={id:string;pointsXZ:number[][];width:number;terminalRegion?:string};
export type SocialRegion={id:string;polygon:number[][];focalXZ?:number[]};
export type SocialLayout={version:string;fixtures:SocialPlacement[];paths:SocialPath[];regions:SocialRegion[];preservation:string};
export type SocialPublication={worldId?:string;contract:string;ref:{hash:string;rulesVersion:string};body:{clock:{origin:number;dayTicks:number}|null;scene:SpatialScene&{social:{version:string;layoutHash:string;layout:SocialLayout};commons:{layout:{id:string;def:string;p:number[];yaw:number}[]};provisions?:unknown;kitchen?:unknown};shore:{physicalBase:unknown;terrain:{originXZ:number[];heightMetres:number[][]}}}};
export type RendererWorld={entities:Record<string,Entity>};
export type ProtectedBounds={id:string;min:number[];max:number[]};
export type LowPlant={id:string;kind:string;p:number[];size:number[];yaw:number;seed?:number;pocket?:string};
