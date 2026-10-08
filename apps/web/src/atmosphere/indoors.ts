import {NEW_BUILDINGS,worldRect,FLOOR} from '../../../../mars/viewer/app/engine-view/content/assets/eden-interiors/buildings.ts';
/** Enclosed buildings (indoors) as xz rectangles + the height below which a camera is inside.
 * Snapshot of World W1 place data (worlds/eden/places.v1.json, enclosed buildings; the classroom "venue"
 * polygon includes its open forecourt, so it is left out; tops
 * estimated from their storey count). Used only to keep camera-local rain/leaves/motes out of
 * interiors; the periodic scan adds any other elevated roofs/ceilings it finds. */
export const INDOOR_RECTS:readonly (readonly [string,number,number,number,number,number])[]=[
 ['eden-house-1',30.5,12,37.5,18,3.3],
 ['eden-house-2',48,5.52,56,18,3.3],
 ['eden-house-3',28,25,39.96,35,6.6],
 ['eden-house-4',48,25,59.96,35,6.6],
 ['eden-library-1',68.8,-11.2,79.2,-2.8,3.3],
 ['eden-office-1',86,11,98,19,9.9],
 ['eden-barn-1',81.8,46.8,94.2,55.2,5.5],
 ['eden-observatory',34.5,80,38.5,84,5.0],
 ['eden-windmill',85.9,25.65,90.1,29.85,7.0],
 ['eden-greenhouse',63.8,32.5,74.2,37.5,3.3],
 ['eden-a-frame',74,-28.5,79,-22.5,3.3],
 ['eden-yurt',64.5,-21.5,70.5,-15.5,3.3],
 ['eden-tower-house',67.3,18.3,70.7,21.7,9.0],
];
/** The Buildings & Interiors lane's new buildings (café, music room, games room, bakery, chapel, clinic,
 * bathhouse, potting shed): footprint and ceiling from their plans. */
for(const k of NEW_BUILDINGS){const [x0,z0,x1,z1]=worldRect(k,-k.w/2,-k.d/2,k.w/2,k.d/2);(INDOOR_RECTS as (readonly [string,number,number,number,number,number])[]).push([k.id,x0,z0,x1,z1,FLOOR+k.h+.12]);}
/** Is a world point inside one of the known enclosed buildings? */
export function insideBuilding(x:number,y:number,z:number){for(const r of INDOOR_RECTS)if(x>r[1]&&x<r[3]&&z>r[2]&&z<r[4]&&y<r[5])return true;return false;}
