import type { AssetDef } from './catalog.ts';
const dims={confidence:'hypothetical' as const,note:'Eden boat fixture/1: native base-centred boxes derived from World shore proposal; no hydrostatic mass model'};
export const SHORE_ASSETS:AssetDef[]=[
  {id:'eden-shore-boat',label:'Two-seat calm-water boat',category:'vehicle',size:[3,.8,1.3],massKg:0,obstacle:true,dims},
  {id:'eden-shore-dock',label:'Stopped-boat dock deck',category:'fixture',size:[6,.2,2],massKg:0,obstacle:true,dims},
];
