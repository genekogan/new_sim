import * as T from 'three';
import {Kit,layers,assignStableIds,type IdEntry,type KitHooks} from './kit';
import {createBrahman2020Scene} from '../studio-2020/scene';
export {trailerClearance} from './historical-helpers';
import {make2021} from './year-2021';
import {make2022} from './year-2022';
import {make2023} from './year-2023';
import {make2024} from './year-2024';
import {make2025} from './year-2025';
export const YEARS=[2020,2021,2022,2023,2024,2025,2026] as const;
export const historyNotes:Record<number,string>={
 2020:'Portal, Forest and the public installations, with the separate trailer circle. March drone views and ground photographs; not a surveyed plan.',
 2021:'Two parallel rack wings with a bare-ground corridor, draped aluminet and stepped platforms inside the wings. Dense midseason c6730/c6735/c6727 footage replaces the invented front staircase. This seasonal composite includes later MARS letters; hidden rooms and exact terrace heights remain fitted.',
 2022:'Four separately fitted houses around an asymmetric courtyard: Ba Sing Se, Cahuilla, Chatsubo and Huaqiangbei. Native aerial c273 constrains roof centers and unequal roof depths; broad rack-supported stairs and seven travel trailers replace generic templates. Dimensions and hidden interiors remain approximate.',
 2023:'Dense March drone footage supports seven Chiba bays, internal stepped access, 20 solar modules and parallel Rotapolis with one tall and one low bay. Five travel trailers are individually placed. Exact interbuilding spacing and hidden room boundaries remain under photographic calibration.',
 2024:'Six-bay main Chiba roof plus a lower west terrace; the auditorium and north entrance sit half a bay west of the main-roof center. Open rack-supported seating, north access and Freeside roof/tents follow labeled sources. South access linkage and fine interior geometry remain provisional.',
 2025:'Chiba and Tool Camp face a common courtyard, Freeside sits west, and Bodywork closes the eastern side. A roof-plane fit of the January panorama constrains placement and orientation. Staggered stairs, roof artwork, facades and a dated 21-vehicle census use labeled sources; measurements and hidden details remain approximate.',
 2026:'Existing modular reconstruction and drone alignment, supplemented by kitchen, café and classroom photographs. Some dimensions and hidden interiors remain provisional.'};
// 2020 comes from studio-2020/scene; ids use the same stable scheme as Kit (HISTORY_IDS.md).
function tag2020(root:T.Group){root.updateMatrixWorld(true);const entries:IdEntry[]=[];root.children.forEach((g,i)=>{const id=g.userData.id==='portal'?'chiba':String(g.userData.id||`site-${i}`);g.userData.assembly_id=id;g.traverse(o=>{if(o===g)return;if(o instanceof T.Mesh){const name=o.name.toLowerCase();o.userData={...o.userData,assembly_id:id,kind:name||'component',definition_id:name||'component',layer:/beam|upright|brac/.test(name)?layers.steel:/roof|ceiling/.test(name)?layers.roof:/wall|scrim|curtain|climbing sheet/.test(name)?layers.wall:/floor|deck|stair/.test(name)?layers.floor:layers.detail};entries.push({o,assembly:g,assemblyId:id,kind:name||'component'});if(/scrub/.test(name))o.userData.kind='site_context';}});});assignStableIds(entries);}
/** `hooks` exist for id-stability tests (deploy/history-ids.test.mjs); the app passes none. */
export function createHistoricalScene(year:number,hooks:KitHooks={}){
 if(year===2020){const {root}=createBrahman2020Scene(tag2020);tag2020(root);const k=new Kit(year,hooks);k.visitors(7);root.add(...k.root.children);return root;}
 const k=new Kit(year,hooks);({2021:make2021,2022:make2022,2023:make2023,2024:make2024,2025:make2025} as Record<number,(k:Kit)=>void>)[year](k);k.visitors(year===2021?12:year===2022?16:22);return k.finalize();
}
export function sceneManifest(root:T.Group,year:number){const instances:{id:string;assembly_id:string;layer:string;kind:string;definition_id:string}[]=[],assemblies:{id:string;name:string}[]=[],defs=new Set<string>();root.traverse(o=>{const u=o.userData;if(u.assembly_id&&!u.component_id&&!u.layer&&!assemblies.some(a=>a.id===u.assembly_id))assemblies.push({id:u.assembly_id,name:o.name.replaceAll('_',' ')});if(u.component_id){instances.push({id:u.component_id,assembly_id:u.assembly_id,layer:u.layer||layers.detail,kind:u.kind||'component',definition_id:u.definition_id||'component'});defs.add(u.definition_id||'component');}});return {instances,assemblies,definitions:[...defs],limitations:[historyNotes[year],'Rack bays set to nominal 12 ft. Photographic placement is approximate; this is not a measured inventory or survey.',year===2027?'Proposed design only; no occupied-campus inventory or drainage approval.':'Visitors and EUC riders are illustrative.']};}
