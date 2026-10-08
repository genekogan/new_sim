/** World Buildings & Interiors place data (PLACE-DATA-v1 shape, team/CONTRACTS/PLACE-DATA-v1.md): rooms and
 * furnished zones inside installed buildings, and the lane's new buildings. Ids are prefixed `int-`; parents
 * are existing ids in worlds/eden/places.v1.json. World lead merges these. Everything here is visual scenery
 * until Core admits floors/fixtures; polygons are world x,z metres (level = storey index). */
export type InteriorPlace={id:string;name:string;kind:string;parent:string;polygon:[number,number][];level?:number;enclosed:boolean;capacity:number|null;starting?:boolean;description:string};
import {NEW_BUILDINGS,interiorRect} from './buildings.ts';
const R=(x0:number,z0:number,x1:number,z1:number):[number,number][]=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
/** Interior capacity ≈ floor area / 2.5 m². */
const cap=(x0:number,z0:number,x1:number,z1:number)=>Math.max(1,Math.round((x1-x0)*(z1-z0)/2.5));
const P=(id:string,name:string,kind:string,parent:string,r:[number,number,number,number],enclosed:boolean,description:string,extra:{level?:number;capacity?:number|null}={}):InteriorPlace=>
 ({id:'int-'+id,name,kind,parent,polygon:R(...r),level:extra.level??0,enclosed,capacity:extra.capacity===undefined?cap(...r):extra.capacity,description});

/** The lane's new buildings (enclosed, parent eden-east; polygon = interior floor). */
const NEW_DESCRIPTIONS:Record<string,string>={
 'int-cafe':'A small corner café with a green counter: an espresso machine, cakes under glass, bread, a chalkboard menu, two window tables, counter stools and a teal sofa nook by a bookshelf. Order coffee, share cake, sit and talk or read for an hour.',
 'int-music-room':'A plum-trimmed music room: an upright piano, a drum kit, two guitars on stands, three music stands with chairs on a round rug, sheet music shelves and sound panels. Play, rehearse together, teach a song or sit and listen.',
 'int-games-room':'A cosy games room: a chess table set for a game, a green card table for four, a shelf of board games, a dartboard and an armchair under warm pendants. Play chess or cards, challenge someone, or watch a game.',
 'int-chapel':'A small white chapel with a bell-cote: three rows of walnut pews either side of a rust runner, an altar with a cloth, candles and flowers, brass candle stands and a lectern, tall side windows. Sit in silence, light a candle, hold a wedding, a memorial or a quiet reading.',
 'int-clinic':'A bright little clinic with a green cross by the door: a reception desk, three waiting chairs, an examination cot behind a folding screen, a cabinet of bottles, a basin and a clock. Ask for help, rest when unwell, or keep someone company while they wait.',
 'int-bathhouse':'A cool blue-green bathhouse and laundry: two deep tubs behind a screen, washbasins with a mirror, shelves of folded towels, a laundry tub and basket, and a washing line outside. Bathe, wash clothes, hang them out and chat while they dry.',
 'int-potting-shed':'A green timber potting shed by the observatory: a long bench of terracotta pots and seedlings, shelves of pots and herbs, sacks of compost, a watering can and wide windows. Pot up seedlings, take cuttings, plan the gardens.',
 'int-bakery':'A warm bakery with a domed brick oven glowing at the back, shelves of loaves, a counter with bread baskets and a cake stand, a flour-dusted kneading table and sacks of flour. Bake bread at dawn, buy or share a loaf.',
};
const NEW_PLACES:InteriorPlace[]=NEW_BUILDINGS.map(k=>{const r=interiorRect(k);return{id:k.id,name:k.name,kind:({'int-cafe':'shop','int-bakery':'shop','int-chapel':'chapel','int-clinic':'clinic','int-bathhouse':'bathhouse','int-potting-shed':'workshop'} as Record<string,string>)[k.id]??'room',parent:'eden-east',polygon:R(...r),level:0,enclosed:true,capacity:cap(...r),description:NEW_DESCRIPTIONS[k.id]??k.name};});
export const INTERIOR_PLACES:readonly InteriorPlace[]=Object.freeze([
 ...NEW_PLACES,
 // Library (eden-library-1, interior 69.2..78.8 × -10.8..-3.2)
 P('library-stacks','Library stacks','room','eden-library-1',[69.2,-10.8,78.8,-8.4],false,'Floor-to-ceiling walnut bookshelves under the tall north windows, with two writing desks and green-shaded lamps. Browse the shelves, take a book down, or write quietly at a desk.'),
 P('library-reading-tables','Library reading tables','room','eden-library-1',[69.2,-8.4,78.8,-4.9],false,'Two long reading tables on warm rugs under brass pendants, with benches for six. Read, study together in low voices, or spread out maps and papers.'),
 P('library-reading-corner','Library reading corner','room','eden-library-1',[75.6,-4.9,78.8,-3.2],false,'Two deep armchairs facing each other across a small lamp table — the cosiest seats in the library, for a long book or a quiet one-to-one talk.',{capacity:3}),
 // Barn (eden-barn-1, interior 82.16..93.84 × 47.16..54.84)
 P('barn-woodshop','Barn woodshop','workshop','eden-barn-1',[82.16,47.16,86.6,54.84],false,'A sturdy workbench with a vice under a pegboard of saws, chisels and mallets; sawhorses and a stack of seasoned planks. Measure, saw, plane and build furniture or repair tools.'),
 P('barn-craft-floor','Barn craft table','workshop','eden-barn-1',[86.6,47.16,89.6,54.84],false,'A long pine table on a rug in the middle of the barn under hanging lanterns, with stools for six — for shared making, mending, sketching and teaching a craft.'),
 P('barn-crafts-and-stores','Barn pottery, loom and stores','workshop','eden-barn-1',[89.6,47.16,93.84,54.84],false,'A pottery wheel beside shelves of drying pots, a floor loom with a half-woven rug, and the barn’s stores: hay bales, grain sacks and barrels. Throw a pot, weave a few rows, or fetch supplies.'),
 // Houses (furniture added inside the installed shells)
 P('house-1-kitchen','House 1 kitchen wing','room','eden-house-1',[35.64,12.14,37.36,17.86],false,'The east wing of the courtyard house: a sink and stove along the wall and a small table for two by the window. Cook, make tea, eat breakfast looking into the courtyard.'),
 P('house-1-bedroom','House 1 bedroom wing','bedroom','eden-house-1',[30.64,12.14,32.36,17.86],false,'The west wing with the bed, a lamp-lit nightstand, a wardrobe and a woven rug. Sleep, dress, read in bed.'),
 P('house-2-living','House 2 living corner','room','eden-house-2',[52.8,12.14,55.86,15.6],false,'A kitchenette with sink and stove, an ochre armchair on a navy rug by the east window — the home’s sitting and cooking corner; a round table for two stands by the bed.'),
 ...[[3,0,'warm timber'],[4,20,'pale stone']].flatMap(([n,o,mat])=>{const ox=o as number,h='eden-house-'+n;return[
  P('house-'+n+'-kitchen','House '+n+' kitchen and dining room','kitchen',h,[ox+28.2,25.2,ox+38.2,27.8],true,'The north range of the '+mat+' courtyard house: a fitted kitchen with fridge, sink and stove, a sideboard under a painting, and a dining table set for six under a pendant lamp. Cook a meal, set the table, invite neighbours to dinner.'),
  P('house-'+n+'-living','House '+n+' living room','room',h,[ox+28.2,32.2,ox+38.2,34.8],true,n===3?'The south range by the front door: a sofa, armchair and low table on a rug with a reading lamp, bookshelves — and an upright piano with a music stand. Talk, read, play or listen to music.':'The south range by the front door: a sofa, armchair and low table on a rug with a reading lamp, bookshelves, a plan chest and an easel by the window. Talk, read, paint or draw.'),
  P('house-'+n+'-bedroom','House '+n+' bedroom','bedroom',h,[ox+28.2,28,ox+31.8,32],true,'A quiet bedroom off the courtyard: bed, nightstand lamp, wardrobe, a writing desk with stocked shelves and a rug. Sleep, dress, write letters.'),
 ];}),
 // Office (eden-office-1, rooms are the native floor ids)
 P('office-post-room','Post room and reception','room','eden-office-1-floor-0',[86.2,11.2,97.8,14.2],false,'Low pigeonholes under the north windows hold letters for every resident, with parcels stacked beside them and a notice board on the east wall. Post or collect mail, leave a note, or ask at the desks.'),
 P('office-lounge','Office lounge','room','eden-office-1-floor-0',[94.8,15.8,97.8,18.8],false,'A teal sofa and coffee table by the window, cups left out — a place to wait, have a quick chat or take a break from the desks.',{capacity:4}),
 P('office-studio','Artists’ studio','studio','eden-office-1-floor-1',[89.6,11.2,97.8,14.6],false,'Four easels with canvases in progress catch the north light; a sitter’s stool, a paint trolley and a plan chest of paper and prints. Paint, draw, pose for a portrait or critique each other’s work.',{level:1}),
 P('office-upper-lounge','Upper lounge','room','eden-office-1-floor-2',[93.6,16.6,97.8,18.8],false,'A rust sofa and an ochre armchair in the corner of the top floor — for waiting before a meeting or continuing one more comfortably.',{level:2,capacity:4}),
]);
