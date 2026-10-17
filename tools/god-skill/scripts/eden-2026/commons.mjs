// Public life in Eden, using the existing library and original place coordinates.
import { readFileSync } from 'node:fs';
const P = JSON.parse(readFileSync(new URL('../../../../worlds/eden/places.v1.json', import.meta.url))).places;
const center = id => { const p=P.find(p=>p.id===id); if(!p) throw Error(id); const xs=p.polygon.map(q=>q[0]),zs=p.polygon.map(q=>q[1]); return [(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...zs)+Math.max(...zs))/2]; };
const ops=[];
const put=(def,name,p,extra={})=>ops.push({op:'place',def:`core/${def}@1`,name,p,...extra});
const at=(def,id,extra={})=>put(def,id.replaceAll('.','-'),center(id),extra);
const rect=(x,z,w,d)=>[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]];

// Old Eden's launch balloon was candy-striped (red gores, white seams wide as stripes, a yellow band at its widest):
// the core balloon's own shapes plus six white gores along the envelope and the band.
const CORE_BALLOON=JSON.parse(readFileSync(new URL('../../../../packages/world-compiler/src/core-kit/transport.json',import.meta.url))).find(d=>d.name==='core-balloon');
const ENVELOPE=CORE_BALLOON.make.args.shapes[0],gore=a=>({kind:'sweep',at:[0,0,0],path:ENVELOPE.profile.map(([r,y])=>[+(Math.cos(a)*(r+.06)).toFixed(3),+(ENVELOPE.at[1]+y).toFixed(3),+(Math.sin(a)*(r+.06)).toFixed(3)]),r:.42,tint:'stripe',collide:false});
const STRIPED_BALLOON={kind:'gen',gen:'kit/2',args:{...CORE_BALLOON.make.args,shapes:[...CORE_BALLOON.make.args.shapes,...[0,1,2,3,4,5].map(i=>gore(i*Math.PI/3)),{kind:'cyl',at:[0,ENVELOPE.at[1]+3.6,0],r:3.06,h:.55,segments:24,color:'#f0c040',collide:false}]}};
// Library has beds but no low roll-out sleeping mat. Keep all thirty original
// commons berths as editable bed slots rather than visually scaling a bed.
export const COMMONS_DEFS=[{op:'define',def:{schema:'def/1',name:'eden-sleeping-mat',version:1,description:'A commons sleeping mat and pillow.',tags:['bed','mat','sleep','eden'],form:'point',make:{kind:'gen',gen:'kit/2',args:{shapes:[{kind:'box',at:[0,.035,0],size:[.82,.07,2],tint:'mat',round:.02},{kind:'box',at:[0,.1,-.78],size:[.58,.1,.3],tint:'pillow',round:.03}]}},params:{mat:{type:'color',default:'#607c78'},pillow:{type:'color',default:'#eee4d0'}},palette:{mat:'#607c78',pillow:'#eee4d0'},size:{box:[.82,.15,2]},components:{bed:{height:.08}},slots:[{id:'mat',kind:'bed',p:[0,.08,0],yaw:0,height:.08,accepts:{tags:['body']},capacity:1}]}},
  {op:'define',def:{schema:'def/1',name:'eden-launch-balloon',version:1,extends:'core/balloon@1',description:'The library balloon moored at Eden launch height; the route needs a separate native ride binding.',tags:['balloon','carrier','eden'],form:'point',make:STRIPED_BALLOON,size:{box:[6.14,9.55,6],scale:[1,1.5]},components:{hover:{height:.15,bob:.06,period:9}}}},
];
for(const p of P.filter(p=>/^commons-mat-\d+$/.test(p.id))) ops.push({op:'place',def:'eden-sleeping-mat@1',name:p.id,p:center(p.id),r:Math.PI/2,params:{mat:['#607c78','#a48b69','#677d94'][Number(p.id.split('-').at(-1))%3]}});
// Open commons: a raised talk deck, working kitchen, reading and drawing tables.
ops.push({op:'place',def:'core/deck@1',name:'commons-deck',shape:{area:rect(9,-1.8,3,2)},params:{height:.24,rails:false,material:'wood'}});
put('pavilion','commons-pavilion',[9,-5],{params:{w:6,d:4,roof:'hip',wall:'#eee4cf',trim:'#6c735b',roofColor:'#686b55'}});
put('podium','commons-podium',[9,.24,-2]);
for(let i=0;i<5;i++)put('long-table',`commons-kitchen-table-${i+1}`,[-24+i*4.8,4]);
for(let i=0;i<3;i++)put('pot',`commons-cooking-pot-${i+1}`,[0,0,0],{in:{parent:`commons-kitchen-table-${i+1}`,slot:'top'}});
put('book','commons-reading-book',[0,0,0],{in:{parent:'commons-kitchen-table-4',slot:'top'}});
put('book-stack','commons-drawing-notes',[0,0,0],{in:{parent:'commons-kitchen-table-5',slot:'top'}});
put('campfire','social-eden-fire',[24,-7]);
for(const [i,x,z,r] of [[0,24,-10,0],[1,24,-4,Math.PI],[2,20.5,-7,Math.PI/2],[3,27.5,-7,-Math.PI/2]])put('bench',`social-eden-fire-bench-${i}`,[x,z],{r});
put('long-table','social-eden-dining-table',[23,6]);
for(let i=0;i<3;i++)for(const [j,z,r] of [[0,4.6,0],[1,7.4,Math.PI]])put('chair',`social-eden-dining-chair-${i}-${j}`,[21.9+i*1.1,z],{r});
put('notice-board','commons-notices',[10,-24]);
ops.push({op:'place',def:'eden-launch-balloon@1',name:'eden-balloon',p:[-20,-9],s:1.3,params:{env:'#cf3b30',stripe:'#f4efe6'}});
for(const [def,id] of [['fountain','region-old-town.fountain'],['tiered-fountain','region-campus.fountain'],['campfire','region-campsite.fire-circle']])if(P.some(p=>p.id===id))at(def,id);
put('fountain','campus-quad-fountain',[-12,-97]);
put('chess-table','commons-chess-table',[14,14]);
put('bench','commons-chess-west',[12.5,14],{r:Math.PI/2});
put('bench','commons-chess-east',[15.5,14],{r:-Math.PI/2});
for(let i=0;i<4;i++)put('market-stall',`market-stall-${i+1}`,[66+i*3,29],{params:{awning:['#b8523e','#c6a85a','#527e69','#6c7e9b'][i]}});
for(const [i,x,z,r] of [[0,93,23,0],[1,93,27,0],[2,98,32,0],[3,99,18,0]])put('parasol-table',`cafe-terrace-${i+1}`,[x,z],{r});
for(const [i,x,z] of [[0,-25,112],[1,15,105],[2,8,126],[3,-25,100],[4,-14,129],[5,-39,-15],[6,-39,16],[7,-121,34],[8,24,-71],[9,94,89]])put('bench',`promenade-bench-${i+1}`,[x,z]);
for(let i=0;i<9;i++)for(const x of [101,109])put('lamp-post',`east-lamp-${x}-${i}`,[x,-34+i*18]);
for(let i=0;i<8;i++)put('lamp-post',`north-avenue-lamp-${i}`,[-96+i*28,-73]);
put('stage','festival-stage',[265,34]);
put('balloon','festival-balloon',[290,65],{params:{env:'#678b9a',stripe:'#eee2b0'}});
ops.push({op:'place',def:'core/football-pitch@1',name:'sports-football',shape:{area:rect(61,112,50,30)},params:{fence:false}});
for(let i=0;i<2;i++)ops.push({op:'place',def:'core/tennis-court@1',name:`sports-tennis-${i+1}`,shape:{area:rect(99.5,103.5+i*19,12,18)}});
put('picnic-table','park-picnic-west',[-30,123]);
put('picnic-table','park-picnic-east',[22,122]);
put('drinking-fountain','park-drinking-water',[19,99]);
put('swings','park-swings',[14,99]);
put('slide','park-slide',[20,99.5]);
put('climbing-frame','park-climbing-frame',[24,105]);
put('see-saw','park-see-saw',[15,106]);
put('sandpit','park-sandpit',[12,107]);
put('market-stall','park-ice-cream-kiosk',[-6,95.5],{params:{awning:'#e6a0b8'}});
put('notice-board','harbour-notices',[12,135]);
// Courts are filled by the composer after the building footprint is known.
export const COMMONS_BATCHES=Array.from({length:Math.ceil(ops.length/12)},(_,i)=>({label:`public-life-${i+1}`,ops:ops.slice(i*12,(i+1)*12)}));
