// PURE calculation for an already-validated exact connected profile. No profile/bank inspection import.
import * as THREE from 'three';
export const EDEN_SHORE_GROUND_COLOURS=Object.freeze({deepBed:'#586e72',wetFringe:'#887f69',shoreSand:'#b9ad85',dryShoulder:'#91ad70',deepBelowDatum:.6,fringeBelowDatum:.08,sandAboveDatum:.22,shoulderAboveDatum:1.1});
export function buildEdenShoreVertexColours(terrain,water,enabled=false){
 if(enabled!==true)return null;
 const colors=[],zones=[],c=EDEN_SHORE_GROUND_COLOURS,deep=new THREE.Color(c.deepBed),fringe=new THREE.Color(c.wetFringe),sand=new THREE.Color(c.shoreSand),dry=new THREE.Color(c.dryShoulder),datum=water.datumY;
 const mix=(a,b,t)=>a.clone().lerp(b,Math.max(0,Math.min(1,t))),wet=water.wetBoundsXZ;
 for(let z=0;z<terrain.rows;z++)for(let x=0;x<terrain.columns;x++){
  const wx=terrain.originXZ[0]+x*terrain.spacingMetres,wz=terrain.originXZ[1]+z*terrain.spacingMetres,h=terrain.heightMetres[z][x],rel=h-datum,withinWet=wx>=wet[0]&&wx<=wet[2]&&wz>=wet[1]&&wz<=wet[3];let col,zone;
  if(withinWet&&rel<=-c.deepBelowDatum){col=deep.clone();zone='deep-bed';}
  else if(withinWet&&rel<-c.fringeBelowDatum){col=mix(deep,fringe,(rel+c.deepBelowDatum)/(c.deepBelowDatum-c.fringeBelowDatum));zone='wet-fringe';}
  else if(rel<c.sandAboveDatum){col=mix(fringe,sand,(rel+c.fringeBelowDatum)/(c.sandAboveDatum+c.fringeBelowDatum));zone='shore-band';}
  else{col=mix(sand,dry,(rel-c.sandAboveDatum)/(c.shoulderAboveDatum-c.sandAboveDatum));zone='dry-shoulder';}
  colors.push(...col.toArray());zones.push(zone);
 }
 const colours=new Float32Array(colors);return{colours,zones,vertices:terrain.rows*terrain.columns,colorAttributeBytes:colours.byteLength,coordinateDomainXZ:[-62,-12,-28,12],nativeDatumY:datum,recipe:{...c},extraDraws:0,extraGeometry:0,extraMaterials:0,textures:0,scope:'exact source vertex-height colour depiction only; no wetness/weather/native support contour or metadata adoption'};
}
