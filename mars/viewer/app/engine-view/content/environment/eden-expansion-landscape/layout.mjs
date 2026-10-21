// ONE connected Eden expansion. Coordinates are authoring proposals, not native admission.
const data={
 version:'eden-expansion-landscape/1',bounds:[-100,-65,105,85],
 preserved:[{id:'original-native-commons',bounds:[-30,-30,30,30]},{id:'original-native-shore',bounds:[-62,-12,-28,12]}],
 places:[
 {id:'classroom',bounds:[34,-19,50,2],entrance:[42,2],presenter:[42,-15],nativeRequired:'stage/20seats/approach/sitting/presentation'},
 ...[[[34,15],[30.5,12,37.5,18]],[[52,15],[48,5.52,56,18]],[[34,30],[28,25,39.96,35]],[[54,30],[48,25,59.96,35]]].map(([p,bounds],i)=>({id:'house-'+(i+1),bounds,entrance:[p[0],bounds[1]],nativeRequired:'actual family whole bounds; native floors/entry/stairs pending'})),
 {id:'library',bounds:[66,-13,82,-1],entrance:[74,-1],nativeRequired:'reading seats/interior'},
 {id:'office-craft',bounds:[84,7,100,23],entrance:[84,15],nativeRequired:'worktables/entry'},
 {id:'covered-market',bounds:[63,23,77,35],entrance:[63,29],nativeRequired:'market/food claims'},
 {id:'farm-barn',bounds:[80,43,96,59],entrance:[80,51],nativeRequired:'barn/food production'},
 {id:'garden-pergola',bounds:[38,35,49,40],entrance:[43,35],nativeRequired:'Assets optional pergola/benches'},
 {id:'greenhouse',bounds:[63,65,75,74],entrance:[69,65],nativeRequired:'Assets greenhouse/floor'},
 {id:'west-footbridge',bounds:[-81,-24,-67,-20],entrance:[-81,-22],nativeRequired:'Core floor/support across proposed river; Assets bridge'},
 {id:'prospective-rural-cottage-west',bounds:[-17,41,-7,51],entrance:[-12,43],nativeRequired:'Assets selected cottage root-12,Y,46/front-Z; native housing/access pending'},
 {id:'prospective-rural-cottage-east',bounds:[7,38,17,51],entrance:[12,39],nativeRequired:'Assets selected timber/verandah root12,Y,46; native housing/access pending'},
 {id:'south-monument-courtyard',bounds:[-6,53,6,65],entrance:[0,53],nativeRequired:'Assets monument0,Y,59/courtyard; native activity/support pending'},
 ...[[35,3],[49,3],[71,-.7],[77,-.7],[32.7,10.8],[35.3,10.8],[-2,52.7],[2,52.7]].map(([x,z],i)=>({id:'compact-entrance-lantern-'+i,bounds:[x-.15,z-.15,x+.15,z+.15],entrance:[x,z],nativeRequired:'exact .3x.3 footprint/1.6m appearance; no allocated light/physics admission'})),
 {id:'library-forecourt-sculpture',bounds:[77.75,-1.25,80.25,1.25],entrance:[79,1.25],nativeRequired:'static fountain/sculpture at79,Y,0; no native fluid/swim claim'},
 {id:'farmhouse',bounds:[85,34,95,42],entrance:[90,35.5],nativeRequired:'Assets actualfamily86.5..93.5/35.5..41.5/root90,0,38.5; sampledvisibleground0/nativepending'},
 {id:'craft-courtyard',bounds:[84,-18,100,-4],entrance:[92,-4],nativeRequired:'Assets craft root92,0,-11; native work/support pending'},
 {id:'performance-court',bounds:[84,-36,100,-20],entrance:[92,-22.6],nativeRequired:'Assets stage root92,0,-30/front+Z; native performance/support pending'},
 {id:'forecourt-reading',bounds:[71,2,77,8],entrance:[74,8],nativeRequired:'Assets fixture cluster74,5; native reading/seats pending'},
 {id:'garden-chess',bounds:[53,60,59,66],entrance:[56,60],nativeRequired:'Assets fixture cluster56,63; native chess/seats pending'},
 {id:'garden-dining',bounds:[66,36,74,42],entrance:[70,36],nativeRequired:'Assets fixture cluster70,39; native dining/foods pending'},
 {id:'garden-fire',bounds:[44,61,50,67],entrance:[47,61],nativeRequired:'Assets fixture cluster47,64; native heat/seats pending, exact prefab envelopes may expand'},
 {id:'west-lake-dock',bounds:[-98,.2,-90,1.8],entrance:[-98,1],nativeRequired:'visual dock reserve; exact bank Y-1.7878570872910566/water-2, Core admission pending'},
 {id:'garden-monument',bounds:[68.5,64.25,71.5,65.75],entrance:[70,63.5],nativeRequired:'actual original monument footprint; decorative until admission'},
 {id:'farm-carts',bounds:[82,57,92,65],entrance:[82,61],nativeRequired:'conservative parking reserve for carts85/88,61; exact supplied prefab bounds pending'},
 {id:'parked-car',bounds:[92,23,100,33],entrance:[92,28],nativeRequired:'conservative parking reserve for car96,28; exact supplied prefab bounds pending'},
 {id:'rail-wagon',bounds:[91,59,101,69],entrance:[91,64],nativeRequired:'conservative parking reserve for wagon96,64; no functioning rail/native travel claim'},
 {id:'rock-arch-stop',bounds:[97,65,104,71],entrance:[97,68],nativeRequired:'ornamental rock arch/no physical passage grant'},
 {id:'north-lookout',bounds:[-1,-62,8,-57],entrance:[3,-57],nativeRequired:'lookout/platform support'}
 ],
 regions:[
 {id:'south-country-walk',bounds:[-25,32,25,80],style:'dense meadow/woodland ring around a true open central clearing, small gardens and two reserved rural plots'},
 {id:'southern-forest-edge',bounds:[-72,62,-24,82],style:'mixed understory woodland edge connected to southern loop'},
 {id:'northern-river-forest',bounds:[-62,-60,-33,-33],style:'conifer/canopy edge linking alpine ridge and northern river approach'},
 {id:'north-woodland',bounds:[-15,-60,25,-32],style:'dense mixed canopy/birch with open loop'},
 {id:'west-lake-river',bounds:[-95,-45,-63,65],style:'lake/river/stone/wetland/shore entry'},
 {id:'orchard-gardens',bounds:[28,40,78,75],style:'cultivated beds/meadow/fruit-colour orchard, no edible production'},
 {id:'outlook-grove-accent',bounds:[-.5,-57,11,-48],style:'reserved original alpine grove beside northern lookout approach'},
 {id:'alpine-outlook',bounds:[-30,-64,-17,-39],style:'conifer/rock ridge transition'},
 {id:'tropical-water-grove',bounds:[-97,35,-76,63],style:'small palm/bamboo pocket'},
 {id:'volcanic-periphery',bounds:[90,74,100,84],style:'small basalt geological accent; no volcanic activity'},
 {id:'quiet-west-forest',bounds:[-61,31,-34,67],style:'forest stops / meadow edge'}
 ],
 paths:[
 {id:'east-spine',width:3,points:[[18,5],[28,5],[36,4],[64,4],[78,15],[79,29],[79,51],[76,59],[60,60]]},
 {id:'classroom-approach',width:3,points:[[42,4],[42,2]]},
 {id:'library-approach',width:2.5,points:[[74,4],[74,-1]]},
 {id:'housing-court',width:2.5,points:[[36,4],[44,4],[44,24],[62,24],[62,38],[28,38]]},
 {id:'farm-orchard-loop',width:3,points:[[34,36],[32,40],[32,73],[59,78],[79,73],[79,51],[76,40],[54,40],[49,37]]},
 {id:'orchard-aisle',width:2,points:[[54,51],[40,55],[40,65]]},
 {id:'farmhouse-approach',width:2.5,points:[[79,38],[90,34],[90,35.5]]},
 {id:'craft-approach',width:2.5,points:[[74,4],[92,4],[92,-4]]},
 {id:'performance-approach',width:2.5,points:[[92,4],[102,4],[102,-22.6],[92,-22.6]]},
 {id:'chess-approach',width:2,points:[[54,51],[56,60]]},
 {id:'dining-approach',width:2,points:[[64,38],[70,38]]},
 {id:'fire-approach',width:2,points:[[40,65],[43,65],[47,67]]},
 {id:'rock-arch-approach',width:2,points:[[79,73],[86,68],[97,68]]},
 {id:'north-forest-loop',width:3,points:[[9,5],[9,-24],[24,-28],[29,-34],[22,-43],[6,-51],[-10,-43],[-20,-32],[-30,-24],[-37,-18]]},
 {id:'north-lookout-approach',width:2,points:[[6,-51],[3,-57]]},
 {id:'western-nature-loop',width:3,points:[[-29,0],[-28,18],[-38,24],[-57,27],[-68,28],[-90,24],[-92,42],[-80,57],[-56,57],[-38,44],[-38,24]]},
 {id:'river-north-approach',width:2.5,points:[[-37,-18],[-64,-22],[-67,-22]]},
 {id:'commons-south-country',width:3,points:[[9,28],[9,34],[0,34],[0,53],[0,56]]},
 {id:'south-country-loop',width:2.5,points:[[0,53],[-6,53],[-20,55],[-20,68],[-13,77],[0,79],[21,74],[22,56],[6,53],[0,53]]},
 {id:'south-country-west-link',width:2.5,points:[[-20,60],[-25,64],[-30,68]]},
 {id:'south-country-east-link',width:2.5,points:[[21,74],[26,79],[32,73]]},
 {id:'south-cottage-west-approach',width:2,points:[[0,34],[-12,34],[-12,41]]},
 {id:'south-cottage-east-approach',width:2,points:[[9,34],[12,34],[12,38]]},
 {id:'southern-forest-loop',width:2.5,points:[[-80,57],[-68,68],[-51,73],[-30,68],[-38,44]]},
 {id:'southern-clearing-approach',width:2,points:[[-51,73],[-49,66]]},
 {id:'northern-clearing-approach',width:2,points:[[-43,-39],[-47,-48]]},
 {id:'forest-reading-approach',width:2,points:[[25,-40],[16,-36]]},
 {id:'birch-stop-approach',width:2,points:[[-5,-45.5],[-8,-53]]},
 {id:'lake-dock-approach',width:2,dryBankAppearance:true,points:[[-90,24],[-98,18],[-98,1]]},
 {id:'lake-stop-approach',width:2,points:[[-90,24],[-92,16]]},
 {id:'meadow-stop-approach',width:2,points:[[-44,48.333333],[-51,45]]},
 {id:'garden-stop-approach',width:2,points:[[54,48],[58,48]]},
 {id:'river-west-approach',width:2.5,points:[[-81,-22],[-90,-25],[-91,-40],[-71,-46],[-43,-39],[-30,-24]]}
 ],
 stops:[{id:'south-country-central-clearing',p:[0,56],radius:8},{id:'southern-shade-clearing',p:[-49,66],radius:3},{id:'northern-conifer-clearing',p:[-47,-48],radius:3},{id:'forest-reading',p:[16,-36],radius:2},{id:'birch-rest',p:[-8,-53],radius:2},{id:'west-lake-stop',p:[-92,16],radius:2},{id:'west-meadow-stop',p:[-51,45],radius:2.5},{id:'garden-stop',p:[58,48],radius:2.5}],
 water:[{id:'expansion-lake',kind:'calmlake',p:[-81,-2,1],yaw:0,wetEllipse:[14,10],outerBounds:[-99.9,-12.5,-62.1,14.5]},
 {id:'expansion-river',kind:'riverreach',p:[-74,-2,-18],yaw:Math.PI/2,wetBounds:[-77,-33,-71,-3],outerBounds:[-78.05,-38.25,-69.95,2.25]},
 {id:'shore-connection',kind:'connection',p:[-65,-2,0],yaw:0,wetBounds:[-68,-2,-62,2],outerBounds:[-68,-2,-62,2]}],
 scope:'visual-only new terrain/floor/water/path/planting until exact Core admission; original histories/contacts unchanged'
};
export function edenExpansionLayout(){return structuredClone(data);}
export function inside(x,z,b,margin=0){return x>=b[0]-margin&&x<=b[2]+margin&&z>=b[1]-margin&&z<=b[3]+margin;}
export function pathDistance(x,z,points){let out=Infinity;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],u=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));out=Math.min(out,Math.hypot(x-a[0]-u*dx,z-a[1]-u*dz));}return out;}
// Per-path [minX,minZ,maxX,maxZ]: a point farther than the threshold outside a path's box cannot be within it, so
// reserved() skips the segment walk there (same answers; the 1e-6 slack covers rounding in the projected point).
const PATH_BOXES=data.paths.map(p=>p.points.reduce((b,q)=>[Math.min(b[0],q[0]),Math.min(b[1],q[1]),Math.max(b[2],q[0]),Math.max(b[3],q[1])],[Infinity,Infinity,-Infinity,-Infinity]));
function nearPath(x,z,p,b,t){const m=t+1e-6;if(x<b[0]-m||x>b[2]+m||z<b[1]-m||z>b[3]+m)return false;return pathDistance(x,z,p.points)<=t;}
export function inNative(x,z,margin=0){return data.preserved.some(p=>inside(x,z,p.bounds,margin));}
export function reserved(x,z,r=0){return inNative(x,z,r)||data.regions.some(p=>['volcanic-periphery','outlook-grove-accent'].includes(p.id)&&inside(x,z,p.bounds,r))||data.places.some(p=>inside(x,z,p.bounds,r+.6))||data.paths.some((p,i)=>nearPath(x,z,p,PATH_BOXES[i],p.width/2+r+.35))||data.stops.some(p=>Math.hypot(x-p.p[0],z-p.p[1])<=p.radius+r);}
export function inWater(x,z){return data.water.some(w=>w.wetEllipse?((x-w.p[0])/w.wetEllipse[0])**2+((z-w.p[2])/w.wetEllipse[1])**2<=1:inside(x,z,w.wetBounds));}
export function waterBedReserved(x,z,margin=0){return data.water.some(w=>inside(x,z,w.outerBounds,margin));}
/** Cosmetic new expansion ground only. Never sample it as native support. */
export function expansionHeight(x,z){
 if(!Number.isFinite(x)||!Number.isFinite(z)||!inside(x,z,data.bounds)||data.preserved.some(p=>x>p.bounds[0]&&x<p.bounds[2]&&z>p.bounds[1]&&z<p.bounds[3]))return null;
 // New cosmetic floor lies beneath ORIGINAL water-family beds; never native support.
 let y=0;
 for(const w of data.water){if(w.kind==='calmlake'){const r=Math.hypot((x-w.p[0])/14,(z-w.p[2])/10);if(r<=1.35)y=Math.min(y,-2.9);else if(r<1.75)y=Math.min(y,-1.72*(1-(r-1.35)/.4));continue;}const b=w.outerBounds,d=Math.hypot(Math.max(b[0]-x,0,x-b[2]),Math.max(b[1]-z,0,z-b[3]));if(d===0)y=Math.min(y,-2.9);else if(d<4)y=Math.min(y,(-2+(w.kind==='riverreach'?.25:.28))*(1-d/4));}
 // Low northern/alpine shoulder, away from venue/canonical contacts.
 if(x<-17&&z<-38)y=1.8*Math.max(0,1-Math.hypot((x+23)/10,(z+52)/18));
 // Match original shore's outer edge as visual-only transition; native inside remains untouched.
 const b=data.preserved[1].bounds,cx=Math.max(b[0],Math.min(b[2],x)),cz=Math.max(b[1],Math.min(b[3],z)),d=Math.hypot(x-cx,z-cz);
 if(d<4){const isolatedX=cx+46,raw=isolatedX<=-5?-1.5:isolatedX<0?-.3*(-isolatedX):isolatedX>=16?2:.13*isolatedX,edge=raw-2;y=edge*(1-d/4)+y*d/4;}
 return y;
}
