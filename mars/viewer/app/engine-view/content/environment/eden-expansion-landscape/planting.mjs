import {edenExpansionLayout,expansionHeight,reserved,waterBedReserved} from './layout.mjs';
/** Deterministic authored expansion positions only; not inferred native flora. */
export function edenExpansionPlanting(){
 const layout=edenExpansionLayout(),plants=[],special={birch:[],fern:[],flowering:[],palm:[],bamboo:[],hedge:[],vine:[],stones:[],meadow:[]},omitted=[];
 let n=0;const hash=s=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};const yaw=i=>(i*.0137)%6.283185307;
 const accept=(id,x,z,r,kind,size)=>{n++;id=id.replace(/-\d+$/,'')+':'+x.toFixed(4)+':'+z.toFixed(4);const seed=hash(id);const y=expansionHeight(x,z);if(y===null||reserved(x,z,r)||waterBedReserved(x,z,r)){omitted.push(id);return null;}const p={id,p:[x,y,z],yaw:yaw(seed),size};if(kind)plants.push({...p,kind,seed:7800+(seed%1_000_000)});return p;};
 function forest(region,step,kind){const [x0,z0,x1,z1]=region;for(let z=z0;z<=z1;z+=step)for(let x=x0;x<=x1;x+=step){const i=hash(kind+':'+x+':'+z),jx=Math.sin(i*1.31)*.75,jz=Math.cos(i*1.73)*.75,p=accept('expansion-'+kind+'-'+n,x+jx,z+jz,3.2,kind,[4.5,6+(i%4)*.8,4.5]);if(p&&i%3===0){const f=accept('expansion-fern-'+n,x+jx+2.2,z+jz+.6,.7,null,[.9,.9,.9]);if(f)special.fern.push(f);}}}
 forest([-13,-58,23,-34],6,'canopy-tree');
 forest([-58,34,-36,66],6,'canopy-tree');
 forest([-68,65,-26,79],7,'canopy-tree');
 forest([-23,35,23,77],5,'canopy-tree');
 forest([-60,-58,-36,-35],6,'conifer');
 forest([-95,-56,-69,-40],7,'conifer');
 forest([-27,-62,-19,-42],6,'conifer');
 forest([37,-59,94,-34],9,'canopy-tree');
 // Birch allees and orchard: pale trunks transition forest to cultivated gardens.
 for(const [x0,z0,x1,z1,step] of [[-9,-57,19,-36,7],[36,53,72,72,7]])for(let z=z0;z<=z1;z+=step)for(let x=x0;x<=x1;x+=step){const p=accept('expansion-birch-'+n,x+.35*Math.sin(hash('birch:'+x+':'+z)),z,1.9,null,[1,1,1]);if(p)special.birch.push(p);}
 for(let z=40;z<=62;z+=6)for(let x=-95;x<=-82;x+=6){const p=accept('expansion-tropical-'+n,x,z,2,null,[1,1,1]);if(p)special[(hash(p.id)%3===0)?'bamboo':'palm'].push(p);}
 // Continuous low edges along paths, not opaque planting on their reserve.
 for(const path of layout.paths)for(let k=1;k<path.points.length;k++){const a=path.points[k-1],b=path.points[k],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);for(let d=2;d<length;d+=3.5)for(const side of [-1,1]){const offset=path.width/2+1.3,x=a[0]+dx*d/length-dz/length*offset*side,z=a[1]+dz*d/length+dx/length*offset*side,p=accept('expansion-path-edge-'+n,x,z,.5,'shrub',[.65,.7,.65]);if(p&&hash(p.id)%4===0)special.fern.push({...p,id:p.id+'-fern',p:[x+.3,p.p[1],z+.15],size:[.6,.6,.6]});}}
 // Perennial beds/meadow patches link neighborhood and country; no farming/food truth.
 for(let z=39;z<=77;z+=5)for(let x=28;x<=94;x+=5){const p=accept('expansion-flower-'+n,x,z,.7,null,[.55,.55,.55]);if(p)special.flowering.push(p);}
 for(const [x,z] of [[-22,72],[-8,76],[17,70],[-5,37],[20,34],[-36,62],[-45,72],[-58,66],[-60,78],[-38,78],[-55,-44],[-39,-54],[55,46],[65,48],[43,47],[70,78],[-56,47],[-44,62],[-89,27],[-87,-36],[88,-26],[99,33]]){const p=accept('expansion-meadow-'+n,x,z,2.2,null,[1,1,1]);if(p)special.meadow.push(p);}
 for(const [x,z] of [[-54,69],[-44,69],[-50,-51],[-45,-44],[37,42],[48,43],[59,43],[74,62],[77,68],[58,74],[30,49],[96,40],[-90,19],[-88,-10],[-85,-31]]){const p=accept('expansion-stones-'+n,x,z,1.6,null,[1,1,1]);if(p)special.stones.push(p);}
 // Garden trellis ribbons outside paths and reserved pergola/buildings.
 for(const [x,z] of [[45,58],[51,54],[61,56],[64,76]]){const p=accept('expansion-vine-'+n,x,z,1.7,null,[1,1,1]);if(p){p.yaw=0;special.vine.push(p);}}
 for(const [x,z] of [[34,44],[46,46],[56,67],[72,44],[79,64],[87,36]]){const p=accept('expansion-hedge-'+n,x,z,3.3,null,[1,1,1]);if(p){p.yaw=0;special.hedge.push(p);}}
 // Denser connected south-country texture, keeping clearing/paths/rural plots truly open.
 for(let z=33;z<=79;z+=2.25)for(let x=-24;x<=24;x+=2.25){const h=hash('south-country:'+x+':'+z),jx=.3*Math.sin(h),jz=.3*Math.cos(h);accept('south-country-grass-'+n,x+jx,z+jz,.3,'grass',[.48,.28+(h%4)*.045,.48]);if(h%5===0)accept('south-country-bush-'+n,x+jx+.6,z+jz,.5,'shrub',[.75,.72,.75]);}
 for(const [cx,cz]of[[-13,53],[-10,68],[7,40],[7,69]])for(let i=0;i<8;i++){const a=i*Math.PI/4,x=cx+Math.cos(a)*1.1,z=cz+Math.sin(a)*1.1,p=accept('south-country-garden-'+n,x,z,.45,null,[.42,.42,.42]);if(p)special.flowering.push(p);}
 for(const [x,z]of[[-20,51],[-17,77],[3,74],[19,52],[20,60]]){const p=accept('south-country-meadow-'+n,x,z,2.2,null,[1,1,1]);if(p)special.meadow.push(p);}
 for(const [x,z]of[[-10,45],[-12,63],[8,71],[17,59]]){const p=accept('south-country-stones-'+n,x,z,1.6,null,[1,1,1]);if(p)special.stones.push(p);}
 // Shade-to-meadow edge groups remain tied to the SAME woodland trees and trail network.
 const shadeTrees=plants.filter(p=>p.kind==='canopy-tree').filter(p=>hash(p.id)%3===0);
 for(const tree of shadeTrees){const a=(hash(tree.id)%628)/100,x=tree.p[0]+Math.cos(a)*1.9,z=tree.p[2]+Math.sin(a)*1.9,p=accept('shade-fern-'+hash(tree.id),x,z,.5,null,[.65,.65,.65]);if(p)special.fern.push(p);
  for(let i=0;i<4;i++){const b=a+i*.45,xx=tree.p[0]+Math.cos(b)*2.5,zz=tree.p[2]+Math.sin(b)*2.5;accept('shade-grass-'+hash(tree.id+':'+i),xx,zz,.25,'grass',[.45,.28,.45]);}}
 // New low grass under trees/meadow outskirts, original family in sparse irregular bands.
 for(let z=-61;z<80;z+=4.5)for(let x=-97;x<101;x+=4.5){if((Math.round((x+97)/4.5)+Math.round((z+61)/4.5))%4!==0)continue;accept('expansion-grass-'+n,x+.4*Math.sin(hash('grass:'+x+':'+z)),z+.4*Math.cos(hash('grass:'+x+':'+z)),.35,'grass',[.5,.4+(hash('grass-height:'+x+':'+z)%3)*.07,.5]);}
 return{plants,special,omitted,scope:'authored new visual-only placements; sampled cosmetic expansion height; no native plant identities'};
}
