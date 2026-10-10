/** World Regions place data (PLACE-DATA-v1 shape, team/CONTRACTS/PLACE-DATA-v1.md) for every district and
 * named building beyond the current Eden rectangle [-100,-65]..[105,85]. World lead merges these under its
 * root `eden` (widened to cover them). Everything here is visual scenery until Core admits native ground:
 * polygons are the authored footprints (x,z world metres), not walkable surfaces yet. */
export type RegionPlace={id:string;name:string;kind:string;parent:string|null;polygon:[number,number][];level?:number;enclosed:boolean;capacity:number|null;starting?:boolean;description:string};
const R=(x0:number,z0:number,x1:number,z1:number):[number,number][]=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
/** Interior capacity ≈ floor area / 2.5 m² (summed over floors). */
const cap=(x0:number,z0:number,x1:number,z1:number,floors=1)=>Math.max(1,Math.round((x1-x0)*(z1-z0)*floors/2.5));
type B=[id:string,name:string,kind:string,rect:[number,number,number,number],enclosed:boolean,capacity:number|null,description:string];
const district=(id:string,name:string,rect:[number,number,number,number],description:string,children:B[],extra:{starting?:boolean;kind?:string}={}):RegionPlace[]=>[
 {id:'region-'+id,name,kind:extra.kind??'outdoor',parent:'eden',polygon:R(...rect),level:0,enclosed:false,capacity:null,...(extra.starting?{starting:true}:{}),description},
 ...children.map(([cid,cname,kind,r,enclosed,capacity,d])=>({id:'region-'+id+'.'+cid,name:cname,kind,parent:'region-'+id,polygon:R(...r),level:0,enclosed,capacity,description:d}))];
export const REGION_PLACES:readonly RegionPlace[]=Object.freeze([
 ...district('canal-quarter','Canal quarter',[106,-42,172,58],'A narrow canal runs north–south between stone quays lined with tall, brightly painted row houses with stepped and pointed gables. Lamps, benches and young trees line both quays; small boats are moored along the walls, and two low arched bridges carry the cross streets over the water.',[
  ['canal','The canal','water',[133.2,-35,139.8,55],false,null,'Green-blue water between stone quay walls, too deep to wade; moored rowing and cabin boats bob along both sides.'],
  ['bridge-south','South canal bridge','bridge',[131,.3,142,3.7],false,null,'A low stone arch over the canal — a natural place to stop, lean on the parapet and watch the boats.'],
  ['bridge-north','North canal bridge','bridge',[131,27.3,142,30.7],false,null,'The northern arched bridge, with a view down the whole length of the canal to the old town.'],
  ['west-quay','West quay','street',[126.2,-33,131.8,57],false,null,'A wide paved quay with benches facing the water, lamps and bicycles leaned against the house fronts.'],
  ['east-quay','East quay','street',[141.2,-33,146.8,57],false,null,'The sunnier quay: benches, bollards and café-style clutter along the water.'],
  ['west-row','West canal houses','residential-row',[116.3,-30,125.5,53],false,null,'Three-to-five-storey canal houses, each a private home with its front door on the quay, flower boxes and here and there a balcony or roof garden.'],
  ['east-row','East canal houses','residential-row',[147.5,-30,157.5,53],false,null,'A matching row of tall, narrow homes facing west over the water.'],
  ['allotments','Canal allotments','garden',[111.6,-36,115.7,56],false,null,'Fenced vegetable beds behind the west row, tended by the canal-house residents.'],
 ]),
 ...district('old-town','Old town plaza and market street',[106,58,172,112],'A cobbled plaza with a stone fountain, framed by two long arcades, a domed hall and a bell tower. South of it a market street of striped stalls faces a row of shops with awnings and painted signs.',[
  ['plaza','Old town plaza','square',[119,62,159,84],false,null,'Cobbles, a tiered fountain, benches, tree tubs and café tables under umbrellas — the place to meet and be seen.'],
  ['north-arcade','North arcade','arcade',[120,55.3,158,60.8],false,null,'A shaded colonnade along the plaza with doors and shop windows behind the columns; dry in the rain.'],
  ['south-arcade','South arcade','arcade',[120,85.2,158,90.7],false,null,'The southern colonnade, opening onto the plaza on one side and the market street on the other.'],
  ['domed-hall','Domed hall','venue',[159.5,67.5,172.5,78.5],true,cap(159.5,67.5,172.5,78.5),'A white hall with a green copper dome and a columned portico facing the plaza — for concerts, assemblies and lectures.'],
  ['bell-tower','Bell tower','building',[111.8,70.8,116.2,75.2],true,6,'A slender ochre tower with a slate spire at the west end of the plaza.'],
  ['market-street','Market street','street',[111.6,91,170,100],false,null,'Thirteen striped market stalls piled with produce and crafts; vendors call out and shoppers browse.'],
  ['shops','Market-street shops','building',[110,101.5,168,109.5],true,cap(110,101.5,168,109.5,1),'A row of two- and three-storey shops with awnings, flower boxes and colourful signs.'],
 ],{starting:true}),
 ...district('hillside-village','Hillside village',[166,-72,262,26],'Whitewashed and ochre houses on level lots climb the eastern hill along a winding lane with cypresses, low stone walls and lamps. Each house has a garden behind — fruit trees, laundry lines, a bench by the door.',[
  ['lookout-temple','Lookout temple','pavilion',[217.6,-30.4,234.4,-13.6],false,null,'A round colonnaded temple on a walled terrace at the summit, with benches facing outward — the best view of all Eden, the canal town and the sea.'],
  ['vegetable-terraces','Hillside vegetable terraces','garden',[192,-66,236,-60],false,null,'Small terraced beds on the hill’s southern shoulder.'],
 ]),
 ...district('east-suburb','East suburb',[172,28,250,118],'Leafy streets of detached houses with lawns, picket fences, garages and mailboxes; behind them pools, trampolines, swing sets and sheds. Street trees and lamps line the sidewalks.',[
 ]),
 ...district('south-avenue','South avenue',[-96,88,106.5,93],'A broad tree-lined avenue running along the south of Eden, joining the park, sports ground, farm and the canal town.',[],{kind:'street'}),
 ...district('park','Park with pond',[-42,95,32,134],'A green park round an oval pond with reeds, a ring path and benches; a white gazebo stands on the lawn, flower beds glow, and there is an ice-cream kiosk by the avenue.',[
  ['pond','Park pond','water',[-19,103.5,7,120.5],false,null,'A shallow oval pond edged with stone, reeds and a small wooden jetty.'],
  ['gazebo','Park gazebo','pavilion',[-31.6,106.4,-24.4,113.6],false,null,'An octagonal white gazebo with a green roof — shelter from rain, or a tiny bandstand.'],
  ['playground','Playground','playground',[11,97,27,109],false,null,'A fenced sandpit playground with swings, a slide, a climbing frame and a see-saw.'],
 ],{starting:true}),
 ...district('sports-ground','Sports ground',[19.5,86,106,134],'A football pitch with crisp white lines, goals and a covered grandstand, two tennis courts and a clubhouse with a veranda.',[
  ['pitch','Football pitch','field',[36,97,86,127],false,null,'A striped grass pitch, 50 by 30 metres, with full markings and goals.'],
  ['tennis-courts','Tennis courts','field',[93.5,94,105.5,133],false,null,'Two fenced hard courts, one blue and one clay-red.'],
  ['clubhouse','Clubhouse','building',[19.5,112,25.5,122],true,cap(19.5,112,25.5,122),'A small white clubhouse with a green roof and a veranda over the pitch.'],
 ]),
 ...district('farm-hamlet','Farm hamlet',[-104,92,-44,136],'Crop fields in green and gold rows divided by hedges, a red barn, a farmhouse with a veranda, three silos, hay bales, a tractor and a white windmill.',[
  ['fields','Crop fields','garden',[-102,94,-62,112],false,null,'Rows of vegetables and grain, tended by hand.'],
  ['barn','Red barn','building',[-76,119.5,-64,128.5],true,cap(-76,119.5,-64,128.5),'A big red timber barn with wide doors, smelling of hay.'],
  ['farmhouse','Farmhouse','building',[-57.5,123,-50.5,131],true,cap(-57.5,123,-50.5,131,2),'A two-storey farmhouse with shutters, flower boxes and a porch.'],
  ['windmill','Windmill','building',[-96.4,101.6,-91.6,106.4],true,7,'A white tower windmill with four sails, facing the town.'],
 ]),
 ...district('harbour','Harbour, boardwalk and beach',[-104,127,130,192],'A long timber boardwalk runs along the sea with benches and lamps; two piers reach out to moored boats, a striped lighthouse stands on the breakwater, and to the west a sandy beach with bathing huts and umbrellas.',[
  ['boardwalk','Boardwalk','boardwalk',[-40,136.5,100,141.5],false,null,'Sun-bleached planks above the waterline; benches face the sea.'],
  ['west-pier','West pier','pier',[8.4,141.5,11.6,167.5],false,null,'A timber pier with boats moored on both sides.'],
  ['east-pier','East pier','pier',[60.4,141.5,63.6,175.5],false,null,'The longer pier, reaching into deeper water.'],
  ['lighthouse','Lighthouse','building',[93.9,185.9,98.1,190.1],true,5,'A red-and-white striped lighthouse at the end of the breakwater.'],
  ['fish-market','Fish market','building',[13.5,129,27.5,135],true,cap(13.5,129,27.5,135),'A blue timber shed where the day’s catch is sold.'],
  ['beach','Beach','beach',[-100,134,-44,146],false,null,'Pale sand, colourful bathing huts, umbrellas and towels at the water’s edge.'],
 ],{starting:true}),
 ...district('seaside-resort','Seaside resort',[106,112,206,192],'Pastel hotels with balconies line a seafront promenade; a ferris wheel and a carousel turn on the beach, a café terrace spreads umbrellas, and sailboats crowd the marina.',[
  ['hotels','Seafront hotels','building',[114,116,170,126],true,cap(114,116,170,126,5),'Four- to six-storey hotels with balconies on every floor and rooftop gardens.'],
  ['ferris-wheel','Ferris wheel','attraction',[178,120,190,128],false,null,'A big white wheel with sixteen coloured gondolas over the beach.'],
  ['carousel','Carousel','attraction',[158,121,170,133],false,null,'A painted carousel of horses under a red-and-white striped roof.'],
  ['marina','Marina','water',[117,138,155,167],false,null,'Three pontoons of sailboats with bright sails.'],
 ]),
 ...district('north-avenue','North avenue',[-100,-72,109,-67],'A tree-lined avenue along the north of Eden linking the artists’ village, the campus, the vineyard and the canal town.',[],{kind:'street'}),
 ...district('vineyard','Vineyard and orchard terraces',[20,-160,112,-72],'Terraces climb north in steps held by low stone walls: vine rows to the west, fruit trees to the east, and a cypress lane leading up to an ochre villa with a tower and a wine cellar.',[
  ['vines','Vine terraces','garden',[24,-150,68,-73],false,null,'Long rows of vines on posts, one terrace above the next.'],
  ['orchard','Orchard terraces','garden',[72,-150,108,-73],false,null,'Fruit trees in rows, some heavy with fruit.'],
  ['villa','Hill villa','building',[63,-157,79,-147],true,cap(63,-157,79,-147,2),'A two-storey ochre villa with green shutters and a veranda overlooking the terraces.'],
  ['villa-tower','Villa tower','building',[80.2,-152.4,85,-147.6],true,7,'A round tower beside the villa with a view over the vineyard.'],
  ['wine-cellar','Wine cellar','building',[54.5,-153.5,61.5,-144.5],true,cap(54.5,-153.5,61.5,-144.5),'A stone cellar with barrels stacked outside.'],
 ]),
 ...district('campus','Campus and library annex',[-44,-128,18,-72],'A green quad with crossing paths and a fountain, a domed library annex behind a columned portico, two arcaded lecture halls, a clock tower and a gate onto the avenue.',[
  ['quad','Campus quad','square',[-29,-109,5,-85],false,null,'A lawn crossed by paths, benches under trees, students’ bikes at the rack.'],
  ['library-annex','Library annex','building',[-24,-126.5,0,-115.5],true,cap(-24,-126.5,0,-115.5),'A tall reading hall under a grey dome, with long windows and a portico of five columns.'],
  ['east-hall','East lecture hall','building',[8,-109,18,-85],true,cap(8,-109,18,-85,2),'Brick lecture rooms behind an arcade facing the quad.'],
  ['west-hall','West lecture hall','building',[-42,-109,-32,-85],true,cap(-42,-109,-32,-85,2),'The twin lecture hall across the quad.'],
  ['clock-tower','Clock tower','building',[-3,-80,1,-76],true,5,'A brick tower with a clock face by the south gate.'],
 ]),
 ...district('artists-village','Artists’ village',[-104,-136,-46,-72],'Colourful studios and A-frames ring a village green with a towering sculpture of painted spheres under strings of lights; easels stand by the doors, craft stalls and picnic tables invite lingering, and a long mural wall runs along the avenue.',[
  ['green','Village green','square',[-83,-107,-65,-89],false,null,'A round green with picnic tables, string lights and the painted-sphere sculpture.'],
  ['warehouse-studio','Warehouse studio','building',[-102,-124,-82,-112],true,cap(-102,-124,-82,-112),'A brick warehouse with a sawtooth roof of north lights — a shared studio and gallery.'],
  ['mural-wall','Mural wall','landmark',[-102,-73.2,-50,-72.4],false,null,'A long wall painted in blocks of colour, always half-finished.'],
 ],{starting:true}),
 ...district('west-lake','West lake shore',[-204,-74,-102,60],'A wide calm lake ringed by a shore path, reeds and boathouses on stilts; cabins and A-frames sit among the pines on the north shore beside a lakeside inn with a deck.',[
  ['lake','West lake','water',[-194,-42,-102,46],false,null,'Deep calm water with a swimming platform and diving board far out.'],
  ['inn','Lake inn','building',[-148,-56.5,-132,-47.5],true,cap(-148,-56.5,-132,-47.5,2),'A two-storey timber inn with a waterside deck of umbrella tables.'],
 ]),
 ...district('campsite','Forest campsite',[-176,-136,-106,-74],'Tents in a pine clearing around a stone fire circle with log benches; log cabins and a two-storey lodge with a stone chimney stand at the edges.',[
  ['fire-circle','Fire circle','square',[-145,-105,-135,-95],false,null,'A ring of stones and log benches — for stories and songs after dark.'],
  ['lodge','Lodge','building',[-129,-88,-115,-76],true,cap(-129,-88,-115,-76,2),'A timber lodge with a balcony, veranda and a big stone chimney.'],
 ]),
 ...district('railway-station','Railway station',[114,-60,170,-36],'A brick station with a long canopied platform, a red train standing ready, and the line running east to a tunnel in the hills.',[
  ['platform','Platform','platform',[122,-47.4,162,-43.8],false,null,'A raised platform with benches, lamps and a yellow safety line.'],
  ['station-building','Station building','building',[133,-43.5,151,-37.5],true,cap(133,-43.5,151,-37.5,2),'The two-storey brick station hall with a clock above the platform.'],
  ['train','Parked train','vehicle',[116,-50.4,170,-47.6],true,160,'A green locomotive and four red carriages waiting at the platform.'],
 ]),
 ...district('makers-yard','Makers’ yard',[114,-124,176,-62],'Workshop sheds with big doors, a stack of shipping containers, a water tower on legs, greenhouses and raised beds — where things get built and grown.',[
  ['workshop-1','Workshop one','building',[115.5,-78.5,128.5,-69.5],true,cap(115.5,-78.5,128.5,-69.5),'A tall timber workshop with a roller door.'],
  ['workshop-2','Workshop two','building',[131.5,-78.5,144.5,-69.5],true,cap(131.5,-78.5,144.5,-69.5),'The middle workshop.'],
  ['workshop-3','Workshop three','building',[147.5,-78.5,160.5,-69.5],true,cap(147.5,-78.5,160.5,-69.5),'The end workshop, next to the containers.'],
  ['greenhouses','Greenhouses','building',[144.5,-105,169.5,-91],true,cap(144.5,-105,169.5,-91),'Three glasshouses full of seedlings and vegetables.'],
 ]),
 ...district('abbey','Abbey on the knoll',[-200,56,-140,140],'A stone church with a bell tower on a gentle knoll, a cloister round a quiet court, a walled kitchen garden and a field of lavender below.',[
  ['church','Abbey church','venue',[-176,93,-145,107],true,cap(-176,93,-145,107),'A tall stone nave with aisles, an apse and a bell tower facing east toward Eden.'],
  ['cloister','Cloister','building',[-171,109.5,-153,125.5],true,80,'Two storeys of rooms round an arcaded court with a fountain and a cypress.'],
  ['kitchen-garden','Kitchen garden','garden',[-180,82,-156,92],false,null,'A walled garden of vegetable beds.'],
  ['lavender','Lavender field','garden',[-197,57,-166,97],false,null,'Rows of purple lavender humming with bees.'],
 ]),
 ...district('courtyard-quarter','Courtyard-house quarter',[-150,52,-104,88],'Four Mediterranean courtyard houses along a lamp-lit lane, each a ring of rooms round an open court with a fountain and a fruit tree.',[
  ['house-1','Courtyard house one','building',[-124,53.5,-108,66.5],true,50,'An ochre courtyard house; its gate opens onto the lane.'],
  ['house-2','Courtyard house two','building',[-143,53.5,-129,66.5],true,45,'A smaller courtyard house with an arcade round its court.'],
  ['house-3','Courtyard house three','building',[-124,73.5,-108,86.5],true,50,'A two-storey courtyard house facing the lane.'],
  ['house-4','Courtyard house four','building',[-147,73.5,-129,86.5],true,55,'The largest courtyard house, beside the path to the abbey.'],
 ]),
 ...district('botanic-garden','Botanic garden',[-104,-170,-40,-136],'A Japanese garden beyond a red torii: a koi pond crossed by an arched red bridge, a five-storey pagoda, a tea house with a veranda, a raked-gravel court with three rocks, maples and cherry trees — and a Victorian palm house of glass.',[
  ['koi-pond','Koi pond','water',[-80,-158,-60,-146],false,null,'Still water with orange and white koi, stepping stones and reeds.'],
  ['red-bridge','Red bridge','bridge',[-79,-153,-67,-151],false,null,'A lacquered red arched footbridge over the koi pond.'],
  ['pagoda','Pagoda','building',[-90.5,-160.5,-85.5,-155.5],true,8,'A five-storey cream and red pagoda with dark flared roofs and a golden finial.'],
  ['tea-house','Tea house','building',[-59,-157,-53,-149],true,cap(-59,-157,-53,-149),'A low timber tea house with a veranda over the pond and a stone lantern by the step.'],
  ['zen-court','Raked-gravel court','garden',[-55,-165.5,-45,-158.5],false,null,'White gravel raked in lines around three dark rocks, behind a bamboo screen.'],
  ['palm-house','Palm house','building',[-102,-149.5,-86,-140.5],true,cap(-102,-149.5,-86,-140.5),'A glass barrel-vaulted glasshouse with a small dome, warm and humid, full of palms.'],
 ]),
 ...district('observatory','Observatory',[78,-200,106,-176],'A white domed observatory on the plateau above the vineyard, with a small study house and a beacon mast — the night sky feels very close here.',[
  ['dome','Observatory dome','building',[87.5,-192.5,96.5,-183.5],true,cap(87.5,-192.5,96.5,-183.5),'A round white building under a silver dome with an open slit.'],
 ]),
 ...district('west-river','West river',[-272,-236,-206,192],'A clear river winds down from the north-western hills between reeds, boulders and alders, past an old stone watermill with a turning wheel and under a humpbacked stone bridge, to a fishing hamlet of stilt houses at its mouth.',[
  ['river','The river','water',[-250,-200,-224,180],false,null,'A shallow, quick river about seven metres wide — good for paddling and fishing, too strong for swimming far.'],
  ['watermill','Watermill','building',[-229.5,-111.5,-222.5,-102.5],true,cap(-229.5,-111.5,-222.5,-102.5,2),'A two-storey stone mill with a big timber wheel on the bank.'],
  ['stone-bridge','Stone bridge','bridge',[-248,-61,-229,-55],false,null,'A humpbacked bridge carrying the west country road over the river.'],
  ['fishing-hamlet','Fishing hamlet','outdoor',[-224,114,-204,148],false,null,'Five bright stilt houses with decks over the sand, drying nets, rowing boats pulled up on the beach and a small blue-roofed chapel.'],
 ]),
 ...district('cliff-village','Whitewashed cliff village',[252,84,306,140],'White cube houses with blue doors, shutters and the odd blue dome step down a sunny slope to a small harbour; bougainvillea spills over terrace walls, two round windmills turn above, and a blue-domed chapel rings its bell.',[
  ['chapel','Blue-domed chapel','venue',[276,99.5,282,108.5],true,cap(276,99.5,282,108.5),'A tiny white chapel with a blue dome on a drum and a bell gable over the door.'],
  ['harbour-quay','Cliff harbour quay','street',[262,127,300,133.5],false,null,'A sunny quay with café tables under umbrellas, fishing boats tied up below.'],
  ['windmill-east','East windmill','building',[293.8,89.8,298.2,94.2],true,6,'A round white windmill with a thatched cap and six cloth sails.'],
  ['windmill-west','West windmill','building',[259.8,87.8,264.2,92.2],true,6,'Its twin at the western end of the village.'],
 ]),
 ...district('east-crossroads','East crossroads',[264,-36,302,16],'Where the east country road meets a lane among the hills: a red-and-white petrol station with two pumps, a stone pub with a hanging sign and a beer garden, a bus shelter, a big yellow billboard, cottages and telegraph poles.',[
  ['petrol-station','Petrol station shop','building',[270.5,-13.5,277.5,-8.5],true,cap(270.5,-13.5,277.5,-8.5),'A small white shop with a red roof edge beside the pumps.'],
  ['pub','The pub','building',[288,-20,296,-8],true,cap(288,-20,296,-8,2),'A two-storey stone pub with green shutters, flower boxes and a beer garden of umbrella tables behind.'],
  ['beer-garden','Beer garden','garden',[289,-29,296,-22],false,null,'Four picnic tables under green and white umbrellas.'],
 ]),
 ...district('golf-course','Golf course',[178,-186,260,-110],'Five rolling fairways with striped mowing, sand bunkers, flags on the greens and a small water hazard, among pines in the north-eastern meadows; a white clubhouse with a green roof and a row of golf carts by the car park.',[
  ['clubhouse','Golf clubhouse','building',[182.5,-120,189.5,-108],true,cap(182.5,-120,189.5,-108),'A white clubhouse with a green hip roof, a veranda and an awning over the terrace.'],
  ['water-hazard','Water hazard','water',[215,-143,229,-135],false,null,'A small pond in the middle of the course — where golf balls go to rest.'],
 ]),
 ...district('festival-meadow','Festival meadow',[251,24,302,82],'A sloping meadow east of the suburb given over to the fair: a red-and-white striped big top, a yellow helter-skelter, an arc of striped food and game stalls, a little stage, bunting on poles, and two hot-air balloons straining at their tethers.',[
  ['big-top','Big top','venue',[266,41,288,63],true,150,'A striped circus tent with a flag on its peak; inside, a sawdust ring and benches.'],
  ['helter-skelter','Helter-skelter','attraction',[258,38,262,42],false,null,'A yellow tower with a red-and-white spiral slide.'],
  ['stage','Fair stage','venue',[290,34,298,42],false,null,'A small timber stage with a blue backdrop and striped pelmet.'],
 ]),
 ...district('alpine','Alpine chalets and cable car',[-60,-330,40,-176],'North of the campus the land climbs into the mountains: wooden chalets with balconies and stacked firewood sit among pines, and a red and a yellow gondola ride the cable car up to a chalet restaurant with a sun terrace near the snowline.',[
  ['valley-station','Cable car valley station','building',[-7.5,-199,-0.5,-193],true,cap(-7.5,-199,-0.5,-193),'A timber station at the foot of the cable car.'],
  ['mountain-restaurant','Mountain restaurant','building',[0,-306,12,-298],true,cap(0,-306,12,-298,2),'A two-storey chalet restaurant with flower boxes, a balcony and a sun terrace with umbrellas.'],
  ['mountain-station','Cable car mountain station','building',[2,-315.5,10,-308.5],true,cap(2,-315.5,10,-308.5),'The top station, looking back over all of Eden to the sea.'],
 ]),
 ...district('castle-ruin','Castle ruin',[-181,-201,-149,-169],'A broken curtain wall, crumbling round towers and a tall keep on a crag in the north-western hills, among pines.',[]),
 {id:'region-southern-sea',name:'Southern sea',kind:'water',parent:'eden',polygon:R(-430,192,430,430),level:0,enclosed:false,capacity:null,description:'Open sea to the south as far as the eye can see.'},
 {id:'region-eastern-hills',name:'Eastern hills',kind:'outdoor',parent:'eden',polygon:R(304,-160,430,80),level:0,enclosed:false,capacity:null,description:'Rolling wooded hills with farmsteads, country roads and wind turbines on the ridges.'},
 {id:'region-northern-mountains',name:'Northern mountains',kind:'outdoor',parent:'eden',polygon:R(-430,-400,430,-331),level:0,enclosed:false,capacity:null,description:'Forested slopes rising to bare, pale peaks.'},
]);
