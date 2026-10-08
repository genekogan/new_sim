import {Builder} from './kit.ts';
import * as F from './furniture.ts';
const {C}=F;
const PI=Math.PI,E=-PI/2,W=PI/2,S=PI;// yaw so the piece's front faces: east wall→west (E), west wall→east (W), south wall→north (S)
/** Interiors for existing installed shells (furniture only, shells untouched). Each entry draws into its own
 * Builder so every room is its own small set of draws (frustum culling per building). Coordinates are world
 * metres measured from the installed shells (see .e2e dump): floors, walls, door and window openings. */
export type RoomDraw={id:string;draw(b:Builder):void};
// ---------------------------------------------------------------- library (interior 69.2..78.8 × -10.8..-3.2, floor 0.1, ceiling 3.2; door S x73.1–74.9)
const library:RoomDraw={id:'eden-library-1',draw(b){const y=.1;
 b.label='library north shelves';b.at(70.3,y,-10.8+.17,0,()=>F.bookshelf(b,2,2.3,.32,C.walnut,11));b.at(77.7,y,-10.8+.17,0,()=>F.bookshelf(b,2,2.3,.32,C.walnut,12));
 b.label='library under-window shelves';b.at(74,y,-10.8+.17,0,()=>F.bookshelf(b,4.7,.74,.32,C.walnut,13));
 b.label='library east shelves';b.at(78.8-.17,y,-7,E,()=>F.bookshelf(b,1.5,2.3,.32,C.walnut,14));b.at(78.8-.17,y,-5.2,E,()=>F.bookshelf(b,1.8,.74,.32,C.walnut,15));b.at(78.8-.17,y,-8.8,E,()=>F.bookshelf(b,1.8,.74,.32,C.walnut,16));
 b.label='library west shelves';b.at(69.2+.17,y,-6.9,W,()=>F.bookshelf(b,1.35,2.3,.32,C.walnut,17));b.at(69.2+.17,y,-5.2,W,()=>F.bookshelf(b,1.8,.74,.32,C.walnut,18));
 b.label='library rugs';b.at(71.5,y,-6.3,0,()=>F.rug(b,3,2.2,C.rust,C.ochre,C.cream));b.at(76.5,y,-6.3,0,()=>F.rug(b,3,2.2,C.navy,C.cream,C.ochre));
 b.label='library reading corner';b.at(76.25,y,-3.85,S,()=>F.armchair(b,C.sage));b.at(77.95,y,-3.85,S,()=>F.armchair(b,C.rose));b.at(77.1,y,-3.7,0,()=>{F.roundTable(b,.24,.55);b.at(0,.55,0,0,()=>F.tableLamp(b));});
 b.label='library globe';b.at(70.5,y,-3.8,0,()=>F.globe(b));b.label='library floor lamp';b.at(69.6,y,-3.6,0,()=>F.floorLamp(b));b.label='library plant';b.at(71.6,y,-3.6,0,()=>F.tallPlant(b));
 b.label='library desk lamps';b.at(70.25,y+.75,-9.15,0,()=>F.tableLamp(b));b.at(75.25,y+.75,-9.15,0,()=>F.tableLamp(b));
 b.label='library books on tables';for(const x of[71.2,76.2]){b.box(x,y+.35,-6.6,.22,.05,.3,C.navy);b.box(x+.02,y+.4,-6.62,.2,.04,.27,C.rust);b.box(x+.5,y+.35,-6.5,.3,.012,.22,C.cream);}
 b.label='library pendants';for(const [x,z] of[[71.5,-6.6],[76.5,-6.6],[71.3,-9],[76.3,-9],[74,-5]])b.at(x,y,z,0,()=>F.pendant(b,3.1,.85));
 b.label='library desk cabinets';b.at(71.5,y,-9,0,()=>F.stockDeskCabinet(b,21));b.at(76.5,y,-9,0,()=>F.stockDeskCabinet(b,23));
 b.label='library clock';b.at(74,y,-3.2,S,()=>F.clock(b,2.62));
}};
// ---------------------------------------------------------------- barn workshop (interior 82.16..93.84 × 47.16..54.84, floor .1, tie beams 3.15; door S x86.8–89.2)
const barn:RoomDraw={id:'eden-barn-1',draw(b){const y=.1;
 b.label='barn workbench';b.at(82.16+.42,y,49.6,W,()=>F.workbench(b,2.2,.8,3));b.label='barn tool wall';b.at(82.16,y,49.6,W,()=>F.toolWall(b,2.4,1.15,.95,5));
 b.label='barn sawhorses';b.at(85.2,y,49.2,0,()=>F.sawhorse(b));b.at(85.2,y,50.6,0,()=>F.sawhorse(b));
 b.label='barn lumber';for(let i=0;i<6;i++)b.box(84.4,y+i*.07,47.5+(i%2)*.02,2.6,.06,.22+(i%3)*.04,i%2?C.pine:C.ash);for(let i=0;i<4;i++)b.box(84.4,y+.42+i*.05,47.85,2.2,.045,.15,C.oak);
 b.label='barn hay';for(let i=0;i<4;i++)for(let j=0;j<2;j++)b.at(90.6+(j?1.2:0),y+((i/2|0)?.45:0),47.5+(i%2)*.55,0,()=>F.hayBale(b,1.1));
 b.at(92.9,y,47.75,0,()=>F.hayBale(b,1.1));b.at(92.9,y,48.3,0,()=>F.hayBale(b,1.1));b.at(92.9,y+.45,48,0,()=>F.hayBale(b,1.1));
 b.label='barn sacks';for(const [x,z] of[[93.4,49.4],[93.35,49.95],[92.9,49.65]])b.at(x,y,z,0,()=>F.sack(b));
 b.label='barn barrels';for(const [x,z] of[[93.3,53.1],[92.6,53.3],[93.3,53.85]])b.at(x,y,z,0,()=>F.barrel(b,.3,.85));
 b.label='barn pottery';b.at(90,y,51.9,PI/6,()=>F.potteryWheel(b));b.at(91.2,y,53.6,0,()=>F.shelving(b,1.4,1.4,.4,3,C.pine,(x,yy,j)=>{b.cyl(x,yy,0,.06+(j%2)*.02,.05,.14+(j%3)*.05,j%2?C.terracotta:'#c9a27a','furn',8);},.24));
 b.label='barn loom';b.at(93.84-.5,y,51.6,E,()=>F.loom(b));
 b.label='barn craft table';b.at(88,y,50.2,0,()=>F.table(b,2.4,.9,.78,C.pine,C.oak));for(const x of[-.8,0,.8])for(const s of[-1,1])b.at(88+x,y,50.2+s*.72,s>0?PI:0,()=>F.stool(b,.62));
 b.at(87.5,y+.78,50.1,0,()=>{b.box(0,0,0,.4,.03,.3,C.cream);b.box(.6,0,.05,.25,.08,.2,C.rust);b.cyl(-.6,0,0,.08,.08,.12,C.terracotta,'furn',8);});
 b.label='barn lanterns';for(const [x,z] of[[88,48.6],[88,51.8],[85,51.4],[91,49.8]])b.at(x,y,z,0,()=>F.pendant(b,3.05,.8,C.lampWarm,.16));
 b.label='barn floor boards';b.at(0,y,0,0,()=>F.floorBoards(b,82.16,47.16,93.84,54.84,'#9a7350','#8a6545',.3));
 b.label='barn rug';b.at(88,y,50.2,0,()=>F.rug(b,3.4,2.2,'#7c5a3a',C.ochre));
}};
// ---------------------------------------------------------------- office (interior 86.2..97.8 × 11.2..18.8; floors .1/3.1/6.1; ceiling +2.9; stair well x87.2–89 z13.5–16.5; door S x91–93 on floor 0)
const office:RoomDraw={id:'eden-office-1',draw(b){
 for(const [lv,y] of[[0,.1],[1,3.1],[2,6.1]] as const){
  b.label='office pendants '+lv;for(const [x,z] of[[91.5,13],[94.6,13],[91.5,16.6],[94.6,16.6]])if(!(lv===2&&z<14))b.at(x,y,z,0,()=>F.pendant(b,2.9,.7,C.lampHot,.22));
  b.label='office desk chairs '+lv;for(const x of[91.15,94.25])b.at(x,y,15.95,S,()=>F.chair(b,C.iron,C.slate));
  b.label='office desk lamps '+lv;b.at(90.7,y+.85,15.2,0,()=>F.tableLamp(b,C.lampHot));b.at(93.8,y+.85,15.2,0,()=>F.tableLamp(b,C.lampHot));
  b.label='office desk cabinets '+lv;b.at(92,y,15.1,0,()=>F.stockDeskCabinet(b,31+lv*2));b.at(95.1,y,15.1,0,()=>F.stockDeskCabinet(b,32+lv*2));
  b.label='office floor '+lv;b.at(0,y,0,0,()=>{if(lv===0)F.floorBoards(b,86.2,11.2,97.8,18.8,'#c9a77c','#bb9a70');else{F.floorBoards(b,86.2,11.2,97.8,13.5,'#c9a77c','#bb9a70');F.floorBoards(b,86.2,16.5,97.8,18.8,'#c9a77c','#bb9a70');F.floorBoards(b,86.2,13.5,87.2,16.5,'#c9a77c','#bb9a70');F.floorBoards(b,89,13.5,97.8,16.5,'#c9a77c','#bb9a70');}});
  b.label='office plants '+lv;if(lv<2)b.at(97.4,y,11.6,0,()=>F.tallPlant(b,C.slate));if(lv<2)b.at(97.4,y,18.4,0,()=>F.plant(b,1.1,C.slate));
 }
 const y0=.1;// ground floor: reception & post room
 b.label='office post pigeonholes';b.at(92,y0,11.2+.18,0,()=>F.pigeonholes(b,3.2,.72,2));
 b.label='office parcels';b.at(95,y0,11.55,0,()=>F.parcels(b,4));b.at(95.6,y0,11.6,0,()=>F.parcels(b,7));
 b.label='office lounge';b.at(96.2,y0,17.6,S,()=>F.sofa(b,1.9,C.teal));b.at(96.2,y0,16.4,0,()=>F.table(b,1,.55,.42,C.ash,C.ash));b.at(96.1,y0,16.4,0,()=>{b.at(0,.42,0,0,()=>{F.cup(b);b.at(.25,0,.05,0,()=>F.cup(b,C.ochre));});});
 b.label='office lounge rug';b.at(96.1,y0,16.9,0,()=>F.rug(b,2.6,2,C.sage,C.cream));
 b.label='office notice board';b.at(97.8,y0,12,E,()=>F.chalkboard(b,.9,.7,2.1));
 const y1=3.1;// first floor: artists' studio
 b.label='studio easels';for(const [x,r] of[[90.6,1],[92.4,2],[94.2,3],[96,4]] as const)b.at(x,y1,12.4,S,()=>F.easel(b,C.cream,r));
 b.label='studio plan chest';b.at(97.8-.32,y1,15,E,()=>F.cabinet(b,2.4,.78,.6,C.ash));
 b.label='studio sitter stool';b.at(93.2,y1,13.8,0,()=>F.stool(b,.7,C.pine,C.rust));
 b.label='studio paint trolley';b.at(95.8,y1,13.6,0,()=>{F.table(b,.6,.45,.8,C.pine,C.iron);for(let i=0;i<5;i++)b.cyl(-.2+i*.1,.8,0,.03,.03,.1,[C.rust,C.teal,C.ochre,C.plum,C.white][i],'furn',6);});
 b.label='studio drop cloth';b.at(93.2,y1,12.9,0,()=>F.rug(b,6,1.9,'#d9d2c2','#cfc6b2'));
 const y2=6.1;// second floor: meeting room extras
 b.label='meeting rug';b.at(94,y2,12.9,0,()=>F.roundRug(b,1.7,C.navy,C.cream));
 b.label='meeting lounge';b.at(96.6,y2,17.7,S,()=>F.sofa(b,1.8,C.rust));b.at(94.6,y2,17.9,S,()=>F.armchair(b,C.ochre));
}};

// ---------------------------------------------------------------- house 1 (ring around a courtyard; interior ring 30.64..37.36 × 12.14..17.86, floor .12; door N x33.4–34.6)
const house1:RoomDraw={id:'eden-house-1',draw(b){const y=.12;
 b.label='h1 kitchen';b.at(37.36-.31,y,13.05,E,()=>F.sink(b,1.2));b.at(37.36-.31,y,16.75,E,()=>F.stove(b));
 b.label='h1 table';b.at(36.3,y,15,0,()=>F.table(b,.7,.7,.74,C.pine,C.pine));b.at(36.3,y,14.38,0,()=>F.chair(b,C.pine,C.rust));b.at(36.3,y,15.62,S,()=>F.chair(b,C.pine,C.rust));b.at(36.25,y+.74,15,0,()=>{F.plate(b,C.bread);b.at(.18,0,.12,0,()=>F.cup(b,C.teal));});
 b.label='h1 nightstand';b.at(30.92,y,13.32,0,()=>{F.cabinet(b,.45,.5,.4,C.oak);b.at(0,.5,0,0,()=>F.tableLamp(b));});
 b.label='h1 wardrobe';b.at(30.64+.31,y,17.2,W,()=>F.wardrobe(b,1.1,C.pine));
 b.label='h1 rug';b.at(31.5,y,16.15,0,()=>F.rug(b,1.2,.8,C.ochre,C.rust));
 b.label='h1 courtyard cushions';for(const z of[14.25,15.75])b.at(34,y-.04,z,0,()=>b.box(0,0,0,.55,.12,.45,z<15?C.teal:C.rose,'cloth'));
 b.label='h1 courtyard plants';b.at(32.85,y-.04,13.85,0,()=>F.plant(b,.9));b.at(35.15,y-.04,13.85,0,()=>F.plant(b,.9));b.at(35.18,y-.04,16.18,0,()=>F.plant(b,.9));
 b.label='h1 picture';b.at(32.8,y,12.14,0,()=>F.picture(b,.7,.5,1.75,41));
 b.label='h1 pendant';b.at(36.5,y,15,0,()=>F.pendant(b,2.4,.55,C.lampWarm,.16));
}};
// ---------------------------------------------------------------- house 2 (one room 48.14..55.86 × 12.14..17.86, floor .12; door N x51.4–52.6)
const house2:RoomDraw={id:'eden-house-2',draw(b){const y=.12;
 b.label='h2 kitchenette';b.at(55.86-.31,y,12.85,E,()=>F.sink(b,1.2));b.at(55.86-.31,y,13.85,E,()=>F.stove(b));
 b.label='h2 dining';b.at(51.6,y,14.6,0,()=>F.roundTable(b,.42,.74,C.ash,C.walnut));b.at(50.95,y,14.6,W,()=>F.chair(b,C.walnut,C.sage));b.at(52.25,y,14.6,E,()=>F.chair(b,C.walnut,C.sage));b.at(51.6,y+.74,14.6,0,()=>{F.cup(b);b.at(.15,0,.1,0,()=>F.plate(b,C.bread));});
 b.label='h2 armchair';b.at(54.3,y,13.5,0,()=>F.armchair(b,C.ochre));
 b.label='h2 rug';b.at(54.3,y,14.6,0,()=>F.rug(b,1.8,1.5,C.navy,C.cream,C.rust));
 b.label='h2 nightstand';b.at(48.95,y,13.35,0,()=>{F.cabinet(b,.45,.5,.4,C.walnut);b.at(0,.5,0,0,()=>F.tableLamp(b));});
 b.label='h2 wardrobe';b.at(48.14+.31,y,17.2,W,()=>F.wardrobe(b,1.1,C.walnut));
 b.label='h2 desk cabinet';b.at(53.5,y,16.4,0,()=>F.stockDeskCabinet(b,51));
 b.label='h2 plant';b.at(55.45,y,17.45,0,()=>F.tallPlant(b,C.cream));
 b.label='h2 picture';b.at(49.6,y,17.86,S,()=>F.picture(b,.9,.6,1.8,43));
 b.label='h2 pendant';b.at(51.6,y,14.6,0,()=>F.pendant(b,2.3,.55,C.lampWarm,.18));
}};
// ---------------------------------------------------------------- houses 3 & 4 (courtyard houses: north range ox+28.2..38.2 × 25.2..27.8 ceiling 2.88; south range × 32.2..34.8 ceiling 2.8; west range ox+28.2..31.8 × 28..32; floor .1; courtyard gaps x ox+33.1..34.9; front door S)
function courtyardHouse(id:string,ox:number,v:0|1):RoomDraw{return{id,draw(b){const y=.1,X=(x:number)=>x+ox;
 const wood=v?C.ash:C.oak,fab=v?C.teal:C.rust;
 // north range: kitchen + dining
 b.label='kitchen '+id;b.at(X(28.6),y,25.2+.33,0,()=>F.fridge(b));b.at(X(29.55),y,25.2+.31,0,()=>F.sink(b,1.2));b.at(X(30.55),y,25.2+.31,0,()=>F.stove(b));b.at(X(31.55),y,25.2+.31,0,()=>{F.counter(b,1.2,.62,.92,C.ash,v?C.sage:C.paint);b.at(-.3,.92,0,0,()=>{b.cyl(0,0,0,.09,.09,.22,C.terracotta,'furn',8);b.cyl(.25,0,0,.06,.06,.16,C.cream,'furn',8);});b.at(.25,.92,0,0,()=>F.loaf(b,0,0,0,()=>.5));});
 b.label='kitchen shelf '+id;b.at(X(30.1),y,25.2+.1,0,()=>{b.box(0,1.5,0,2.2,.03,.2,wood);for(let i=0;i<8;i++)b.cyl(-.95+i*.27,1.53,0,.05,.05,.1+(i%3)*.04,[C.cream,C.terracotta,C.sage,C.ochre][i%4],'furn',8);});
 b.label='sideboard '+id;b.at(X(33.9),y,25.2+.23,0,()=>{F.cabinet(b,1.6,.85,.45,wood);b.at(-.45,.85,0,0,()=>F.tableLamp(b));b.at(.35,.85,0,0,()=>F.plant(b,.6,C.cream));});b.at(X(33.9),y,25.2,0,()=>F.picture(b,1,.6,2.05,61+v));
 b.label='dining '+id;b.at(X(36.7),y,26.4,0,()=>{F.table(b,1.4,.8,.76,wood,wood);for(const sx of[-.35,.35]){b.at(sx,0,-.62,0,()=>F.chair(b,wood,fab));b.at(sx,0,.62,S,()=>F.chair(b,wood,fab));}b.at(-.95,0,0,W,()=>F.chair(b,wood,fab));b.at(.95,0,0,E,()=>F.chair(b,wood,fab));
  b.at(0,.76,0,0,()=>{for(const sx of[-.35,.35])for(const sz of[-.22,.22])b.at(sx,0,sz,0,()=>F.plate(b,(sx>0)!==(sz>0)?C.leaf2:null));b.cyl(0,0,0,.07,.05,.14,C.cream,'furn',8);b.ball(0,.2,0,.12,.1,.12,v?C.rose:C.ochre);});});
 b.label='dining rug '+id;b.at(X(36.7),y,26.4,0,()=>F.rug(b,2.5,2.2,v?C.sage:C.rust,C.cream));
 b.label='north pendants '+id;b.at(X(36.7),y,26.4,0,()=>F.pendant(b,2.78,.75,C.lampWarm,.22));b.at(X(30.5),y,26.6,0,()=>F.pendant(b,2.78,.6,C.lampHot,.16));
 // south range: living room (west), music & books (east)
 b.label='sofa '+id;b.at(X(28.2+.43),y,33.5,W,()=>F.sofa(b,1.9,v?C.navy:C.sage));
 b.label='armchair '+id;b.at(X(31.35),y,33.5,E,()=>F.armchair(b,v?C.rose:C.ochre));
 b.label='living rug '+id;b.at(X(30),y,33.5,0,()=>F.rug(b,2.6,1.9,v?C.plum:C.navy,C.cream,C.ochre));
 b.label='living lamp '+id;b.at(X(31.45),y,32.55,0,()=>F.floorLamp(b));
 b.label='living table things '+id;b.at(X(30),y+.35,33.5,0,()=>{b.box(-.2,0,0,.25,.04,.32,C.navy);F.cup(b,C.ochre);b.at(.3,0,.1,0,()=>F.candle(b,.12));});
 if(v===0){b.label='piano '+id;b.at(X(36.9),y,32.2+.3,0,()=>F.piano(b));b.label='music stand '+id;b.at(X(35.85),y,33.7,PI/5,()=>F.musicStand(b));}
 else{b.label='easel '+id;b.at(X(36.9),y,33,PI*.85,()=>F.easel(b,C.cream,7));b.label='plan chest '+id;b.at(X(36.9),y,32.2+.3,0,()=>F.cabinet(b,1.6,.8,.55,C.ash));}
 b.label='south shelves '+id;b.at(X(37.6),y,34.8-.17,S,()=>F.bookshelf(b,1.1,2,.32,wood,71+v));b.at(X(36.4),y,34.8-.17,S,()=>F.bookshelf(b,1.1,1.1,.32,wood,73+v));
 b.label='south pendant '+id;b.at(X(30),y,33.5,0,()=>F.pendant(b,2.7,.6,C.lampWarm,.2));
 b.label='south plant '+id;b.at(X(32.1),y,34.4,0,()=>F.tallPlant(b,v?C.slate:C.terracotta));
 // west range: bedroom extras
 b.label='bedroom wardrobe '+id;b.at(X(31.8-.31),y,28.9,E,()=>F.wardrobe(b,1.1,wood));
 b.label='bedroom nightstand '+id;b.at(X(28.75),y,28.75,0,()=>{F.cabinet(b,.45,.5,.4,wood);b.at(0,.5,0,0,()=>F.tableLamp(b));});
 b.label='bedroom rug '+id;b.at(X(30),y,29.6,0,()=>F.rug(b,1.6,2.4,v?C.teal:C.ochre,C.cream));
 b.label='bedroom desk '+id;b.at(X(30),y,30.9+.0,0,()=>{});b.at(X(29.15),y,30.6,S,()=>F.chair(b,wood,fab));b.at(X(29.1),y+.85,31.2,0,()=>F.tableLamp(b));
 b.label='bedroom desk cabinet '+id;b.at(X(30),y,31.2,0,()=>F.stockDeskCabinet(b,81+v));
}};}
// ---------------------------------------------------------------- yurt (artist row; round, r 3, floor .08, door gap at local +Z; opened in WN6)
const yurt:RoomDraw={id:'eden-yurt',draw(b){b.at(67.5,.08,-18.5,-.6,()=>{
 b.label='yurt stove';b.at(.2,0,-.5,0,()=>{b.cyl(0,0,0,.32,.36,.55,C.iron,'furn',10);b.cyl(0,.55,0,.34,.34,.04,C.black,'furn',10);b.cyl(0,.59,0,.07,.07,3.05,C.iron,'furn',6);b.box(0,.15,.33,.22,.18,.02,'#ff9a4a','glow');});
 b.label='yurt rug';b.at(0,0,.2,0,()=>F.roundRug(b,1.7,C.rust,C.ochre));
 b.label='yurt bed';b.at(-1.8,0,.2,PI/2,()=>F.bed(b,1.2,1.9,C.plum,C.oak));
 b.label='yurt low table';b.at(1.25,0,.55,0,()=>{F.roundTable(b,.42,.38,C.oak,C.walnut);b.at(0,.38,0,0,()=>{F.cup(b,C.teal);b.at(.15,0,.08,0,()=>F.cup(b,C.cream));F.candle(b,.14);});});
 b.label='yurt cushions';for(const [x,z,c] of[[1.95,.25,C.teal],[1.15,1.35,C.ochre],[.55,.15,C.sage]] as const)b.ball(x,.09,z,.3,.1,.3,c,'cloth');
 b.label='yurt chest';b.at(1.1,0,-2.25,-.4,()=>{b.box(0,0,0,.9,.45,.45,C.walnut);b.box(0,.45,0,.92,.05,.47,C.brass);});
 b.label='yurt shelf';b.at(-.6,0,-2.4,.25,()=>F.bookshelf(b,1,.9,.3,C.pine,61));
 b.label='yurt plant';b.at(1.75,0,1.75,0,()=>F.plant(b,.9,C.terracotta,C.leaf2));
 b.label='yurt lantern';b.at(.9,0,-1.1,0,()=>F.floorLamp(b));
});}};
// ---------------------------------------------------------------- A-frame cabin (artist row; floor top .245, roof Λ: inner half-width ≈ 2.3-.48y; door local +Z; opened in WN6)
const aFrame:RoomDraw={id:'eden-a-frame',draw(b){b.at(76.5,.245,-25.5,.4,()=>{
 b.label='a-frame bed';b.at(0,0,-1.75,0,()=>F.bed(b,1.4,2,C.teal,C.pine));
 b.label='a-frame rug';b.at(0,0,.4,0,()=>F.rug(b,1.8,2.2,C.ochre,C.cream,C.rust));
 b.label='a-frame stove';b.at(1.35,0,-.1,-PI/2,()=>{b.box(0,0,0,.45,.6,.45,C.iron);b.box(0,.18,.23,.25,.18,.01,'#ff9a4a','glow');b.label='a-frame stovepipe (exits through the roof)';b.cyl(0,.6,0,.06,.06,2.5,C.iron,'furn',6);});
 b.label='a-frame armchair';b.at(.95,0,1.25,-2.4,()=>F.armchair(b,C.rust));
 b.label='a-frame table';b.at(-1.15,0,1.1,0,()=>{F.table(b,.7,.7,.74,C.pine,C.oak);b.at(0,.74,0,0,()=>{F.cup(b,C.ochre);b.at(-.18,0,.1,0,()=>F.candle(b,.16));});b.at(.0,0,-.62,0,()=>F.chair(b,C.oak,C.teal));});
 b.label='a-frame shelf';b.at(-1.65,0,-.35,PI/2,()=>F.bookshelf(b,1,.8,.28,C.oak,71));
 b.label='a-frame lamp';b.at(0,0,.3,0,()=>F.pendant(b,4.55,2.2,C.lampWarm,.2));
});}};
// ---------------------------------------------------------------- observatory (landmarks; round, r 2, floor .08, door gap at -Z; opened in WN8)
const observatory:RoomDraw={id:'eden-observatory',draw(b){b.at(36.5,.08,82,0,()=>{
 b.label='observatory rug';b.at(0,0,-.1,0,()=>F.roundRug(b,1.25,C.navy,C.ochre));
 b.label='observatory telescope';b.at(0,0,-.25,0,()=>F.telescope(b));
 b.label='observatory desk';b.at(0,0,1.42,PI,()=>{F.desk(b,1,.48,C.walnut);b.at(-.2,.75,0,0,()=>{b.box(0,0,0,.5,.008,.34,'#1f2c4a');for(let i=0;i<9;i++)b.box(-.2+((i*37)%10)*.045,.009,-.13+((i*53)%7)*.04,.015,.002,.015,C.cream);});b.at(.3,.75,-.05,0,()=>F.tableLamp(b));});
 b.label='observatory chair';b.at(0,0,.9,0,()=>F.chair(b,C.walnut,C.navy));
 b.label='observatory globe';b.at(-1.25,0,.35,0,()=>F.globe(b));
 b.label='observatory shelf';b.at(1.2,0,-.55,-PI/2-.45,()=>F.bookshelf(b,.8,1.6,.28,C.walnut,111));
});}};
// ---------------------------------------------------------------- windmill (village features; tapered round tower, r 2.1 at the floor, door gap at +Z; opened in WN8)
const windmill:RoomDraw={id:'eden-windmill',draw(b){b.at(88,.08,27.75,-PI/4,()=>{
 b.label='windmill millstones';b.at(0,0,-.45,0,()=>{b.cyl(0,0,0,.78,.82,.35,C.oak,'furn',12);b.cyl(0,.35,0,.66,.66,.12,'#a9a196','furn',14);b.cyl(0,.47,0,.66,.66,.12,'#b8b0a4','furn',14);b.cyl(0,.59,0,.1,.1,.04,C.iron,'furn',8);
  b.cyl(0,.75,0,.48,.14,.5,C.pine,'furn',8);for(const sx of[-1,1])b.box(sx*.5,.35,0,.06,.95,.06,C.oak);});
 b.label='windmill sacks';for(const [x,z] of[[1.05,.6],[-1.3,.45]] as const)b.at(x,0,z,0,()=>F.sack(b,'#e2d2b0'));
 b.label='windmill ladder';b.at(-1.05,0,-.95,PI/4+PI/2,()=>{for(const sx of[-1,1])b.tilt(sx*.22,1.25,.25,.05,2.6,.05,-.2,0,C.oak);for(let i=0;i<8;i++)b.tilt(0,.25+i*.3,.05+i*.06,.44,.04,.04,-.2,0,C.oak);});
 b.label='windmill barrel';b.at(.75,0,-1.45,0,()=>F.barrel(b,.28,.7));
 b.label='windmill lantern';b.at(0,0,.6,0,()=>F.pendant(b,3,1.2,C.lampWarm,.15));
});}};
// ---------------------------------------------------------------- tower house (artist row; 3.4 m square, inner 3.12, three storeys, door at local +Z; opened in WN11)
// Floors (top surfaces): ground .08, first 2.66, second 5.26; ceilings 2.54, 5.14 and the roof underside at 7.8.
// Stairs: ground → first along the left wall (x -1.2), first → second along the right wall (x +1.2); both climb from the front toward the back.
const towerHouse:RoomDraw={id:'eden-tower-house',draw(b){b.at(69,0,20,PI/2,()=>{
 const flight=(x:number,y0:number,y1:number)=>{const n=9,rise=(y1-y0)/n,run=2.4,a=-Math.atan2(run,y1-y0),L=Math.hypot(run,y1-y0);
  for(let k=0;k<n;k++)b.box(x,y0+rise*(k+1)-.05,.95-(k+.5)*run/n,.56,.05,run/n+.01,C.oak);
  for(const sx of[-1,1])b.tilt(x+sx*.3,(y0+y1)/2-.12,-.25,.04,L,.2,a,0,C.walnut);};
 const rail=(y:number,x0:number,z0:number,x1:number,z1:number)=>{b.box((x0+x1)/2,y+.88,(z0+z1)/2,Math.abs(x1-x0)+.04,.04,Math.abs(z1-z0)+.04,C.walnut);const n=Math.max(2,Math.ceil(Math.hypot(x1-x0,z1-z0)/.6));for(let i=0;i<=n;i++)b.box(x0+(x1-x0)*i/n,y,z0+(z1-z0)*i/n,.04,.88,.04,C.walnut);};
 b.label='tower stairs ground';flight(-1.2,.08,2.66);
 b.label='tower stairs first';flight(1.2,2.66,5.26);
 b.label='tower rail first';rail(2.66,-.82,-.9,-.82,.38);rail(2.66,-1.54,.38,-.86,.38);
 b.label='tower rail second';rail(5.26,.82,-.9,.82,.38);rail(5.26,.86,.38,1.54,.38);
 // ground: a small kitchen and a table for two
 b.at(0,.08,0,0,()=>{
  b.label='tower stove';b.at(1.05,0,-1.25,0,()=>F.stove(b));
  b.label='tower sink';b.at(-.05,0,-1.24,0,()=>F.sink(b,.9));
  b.label='tower table';b.at(.7,0,.45,0,()=>{F.roundTable(b,.35);b.at(0,.76,0,0,()=>{F.cup(b);b.at(.15,0,.08,0,()=>F.plate(b,C.bread));});});
  b.label='tower chair west';b.at(.08,0,.45,W,()=>F.chair(b,C.oak,C.rust));
  b.label='tower chair east';b.at(1.32,0,.45,E,()=>F.chair(b,C.oak,C.rust));
  b.label='tower pendant ground';b.at(.6,0,0,0,()=>F.pendant(b,2.46,.75,C.lampWarm,.18));
 });
 // first floor: a reading room
 b.at(0,2.66,0,0,()=>{
  b.label='tower rug';b.at(0,0,-.1,0,()=>F.rug(b,1.3,1.6,C.teal,C.ochre));
  b.label='tower shelf';b.at(0,0,-1.4,0,()=>F.bookshelf(b,1.4,1.9,.28,C.walnut,131));
  b.label='tower armchair';b.at(0,0,.9,PI,()=>F.armchair(b,C.ochre));
  b.label='tower floor lamp';b.at(-1.2,0,1.2,0,()=>F.floorLamp(b));
  b.label='tower plant';b.at(1.2,0,1.25,0,()=>F.plant(b,.9));
  b.label='tower pendant first';b.at(0,0,0,0,()=>F.pendant(b,2.48,.6,C.lampWarm,.16));
 });
 // second floor: a bedroom under the roof
 b.at(0,5.26,0,0,()=>{
  b.label='tower bed';b.at(-1.05,0,-.45,0,()=>F.bed(b,.95,2,C.plum,C.oak));
  b.label='tower bedside';b.at(-.3,0,-1.3,0,()=>{F.cabinet(b,.4,.5,.36,C.paint);b.at(0,.5,0,0,()=>F.tableLamp(b));});
  b.label='tower chest';b.at(-1.05,0,1.0,0,()=>F.cabinet(b,.8,.5,.4,C.oak));
  b.label='tower desk';b.at(.1,0,1.3,PI,()=>F.desk(b,.9,.5,C.walnut));
  b.label='tower desk chair';b.at(.1,0,.72,0,()=>F.chair(b,C.walnut,C.navy));
  b.label='tower pendant second';b.at(0,0,0,0,()=>F.pendant(b,2.54,.8,C.lampWarm,.18));
 });
});}};
export const EXISTING_ROOMS:readonly RoomDraw[]=[library,barn,office,house1,house2,courtyardHouse('eden-house-3',0,0),courtyardHouse('eden-house-4',20,1),yurt,aFrame,observatory,windmill,towerHouse];
