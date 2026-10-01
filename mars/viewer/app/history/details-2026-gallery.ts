import * as T from 'three';
import {Kit,layers} from './kit';
/** Six side minibays on both gallery levels, matched to retained rack axes.
 * Emissive bulbs share material; no individual lights/shadow passes. */
export function add2026GalleryLife(root:T.Group){
 const host=root.getObjectByName('Chiba');if(!host||host.getObjectByName('Chiba · six minibay perimeter lights'))return;
 const k=new Kit(2026),g=k.assembly('chiba-gallery-life','Chiba · six minibay perimeter lights',[-8.47875,0,8.925],-Math.atan2(.4265,.9045),'Gene six minibays; c1045/1078/1081/1196/1123/1050/75: perimeter festoons on lower and upper side galleries; spacing fitted to rack bays');
 const material=new T.MeshStandardMaterial({color:'#fff0ca',emissive:'#e4c080',emissiveIntensity:.55});
 for(const level of [2.94,5.76])for(const u0 of [0,3.9,7.8])for(const v0 of [0,7.8]){
  const corners=[[u0+.12,v0+.12],[u0+3.78,v0+.12],[u0+3.78,v0+3.78],[u0+.12,v0+3.78]];
  for(let edge=0;edge<4;edge++){const a=corners[edge],b=corners[(edge+1)%4];k.rod(g,'gallery minibay festoon perimeter cable',[a[0],level,-a[1]],[b[0],level,-b[1]],.004,'#363a33',layers.detail);
   for(const t of [.16,.5,.84]){const bulb=new T.Mesh(new T.SphereGeometry(.037,8,6),material);bulb.position.set(a[0]+(b[0]-a[0])*t,level-.055,-a[1]-(b[1]-a[1])*t);k.tag(g,bulb,'gallery minibay warm globe',layers.detail);bulb.userData.walkNoCollision=true;}
  }
 }
 // Upper northwest classroom (Gene firsthand). c31073 supports portable
 // teaching table/display forms but its folder date is2025; no date assertion.
 const floor=3.115,tableY=floor+.73;
 k.box(g,'Chiba upper northwest classroom table',[1.80,.045,.76],[1.95,tableY,-1.95],'#c9c4b2',layers.detail);
 for(const x of [1.22,2.68])for(const z of [-2.22,-1.68])k.box(g,'Chiba classroom folding table leg',[.028,.71,.028],[x,floor+.355,z],'#50574f',layers.detail);
 k.box(g,'Chiba classroom portable projector',[.28,.105,.23],[2.38,tableY+.078,-1.90],'#e0ddd3',layers.detail);
 const lens=new T.Mesh(new T.CylinderGeometry(.036,.036,.022,12),k.mat('#293b42'));lens.rotation.x=Math.PI/2;lens.position.set(2.38,tableY+.082,-2.026);k.tag(g,lens,'Chiba classroom projector lens',layers.detail);
 for(const x of [1.35,1.83]){k.box(g,'Chiba classroom laptop base',[.30,.018,.22],[x,tableY+.031,-1.96],'#3c4649',layers.detail);const m=k.box(g,'Chiba classroom laptop screen',[.30,.19,.015],[x,tableY+.13,-2.062],'#3c4649',layers.detail);m.rotation.x=-.15;}
 // Marzipan's occupied upper-west corner: desk, open book bank and crates
 // observed c19/c75, next to the northwestern solar-facing gallery end.
 k.box(g,'Marzipan upper west desk',[1.70,.055,.78],[10.65,floor+.75,-10.64],'#b9a281',layers.detail);
 for(const x of [9.94,11.36])for(const z of [-10.92,-10.36])k.box(g,'Marzipan desk timber legs',[.05,.72,.05],[x,floor+.36,z],'#9e8668',layers.detail);
 k.box(g,'Marzipan desk laptop base',[.32,.015,.25],[10.42,floor+.791,-10.52],'#2e3b42',layers.detail);k.box(g,'Marzipan desk laptop back',[.32,.22,.015],[10.42,floor+.898,-10.64],'#303e42',layers.detail);
 for(let i=0;i<7;i++)k.box(g,'Marzipan desk book stack',[.31,.03,.22],[11.13,floor+.798+i*.031,-10.69],['#a68a6d','#5b6862','#d4c5a0'][i%3],layers.detail);
 k.box(g,'Marzipan desk storage crate',[.56,.34,.40],[10.16,floor+.17,-10.54],'#a99577',layers.detail);
 g.userData.classroomEvidence='Gene firsthand confirms2026 upperNW table/projector. c31073 visually supports teaching table but lives in2025 source folder; exact furniture positions fitted.';
 g.userData.coverage='six side minibay perimeters at each occupied gallery level; retained CAD rack registration, not surveyed bulb census';k.finalize();for(const o of g.children)if((o.userData.kind||'').startsWith('Chiba class')||(o.userData.kind||'').startsWith('Chiba upper northwest')||(o.userData.kind||'').startsWith('Marzipan'))o.position.y-=.027345;g.userData.furnitureFloor='actual gallery0767/0768/0795 top3.087655m; same-role IDs retained';host.add(g);return g;
}
