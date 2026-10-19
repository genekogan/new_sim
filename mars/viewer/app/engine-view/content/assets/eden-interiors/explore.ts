// Camera views of this content, as plain data: a separate module so a viewer can list them without loading the builders
// (P1 phones: the old Eden builders are their own lazy chunk, apps/web/src/old-eden.ts).
export const INTERIOR_EXPLORE:readonly {id:string;label:string;camera:[number,number,number];target:[number,number,number]}[]=Object.freeze([
 {id:'int-library',label:'Library reading room',camera:[78.4,2.5,-3.5],target:[71,.6,-9.5]},
 {id:'int-barn-workshop',label:'Barn workshop and crafts',camera:[83,2.6,54.5],target:[91.5,.6,48]},
 {id:'int-office-post-room',label:'Post room and reception',camera:[92,1.6,18.5],target:[93,.9,12]},
 {id:'int-office-studio',label:'Artists’ studio (office, first floor)',camera:[97.5,4.7,18.5],target:[91,3.6,12]},
 {id:'int-office-upper-lounge',label:'Upper lounge (office, second floor)',camera:[92.2,7.7,13],target:[96.4,6.7,17.9]},
 {id:'int-house-3-kitchen',label:'House 3 kitchen and dining room',camera:[34,1.6,27.6],target:[29,.9,26]},
 {id:'int-house-3-living',label:'House 3 living room with piano',camera:[33.6,1.6,34.6],target:[37.5,.9,33]},
 {id:'int-house-2',label:'House 2 home interior',camera:[52,1.7,12.4],target:[53,.7,16]},
 {id:'int-cafe',label:'Corner café',camera:[99.2,1.7,22],target:[103.5,1,27]},
 {id:'int-music-room',label:'Music room',camera:[98.9,1.7,56.6],target:[103,1,60]},
 {id:'int-games-room',label:'Games room',camera:[87.8,1.7,-18],target:[85.5,.9,-20.8]},
 {id:'int-bakery',label:'Bakery',camera:[79,1.7,-14],target:[76.2,1,-16.6]},
 {id:'int-new-buildings',label:'Café and office street',camera:[92,6,30],target:[101.5,1.5,25]},
 {id:'int-yurt',label:'Inside the yurt',camera:[66.14,1.6,-16.52],target:[67.93,.6,-19.66]},
 {id:'int-a-frame',label:'Inside the A-frame cabin',camera:[77.47,1.6,-23.2],target:[75.92,.7,-26.88]},
 {id:'int-observatory',label:'Inside the observatory',camera:[36.5,1.6,80.4],target:[36.5,1.4,83.2]},
 {id:'int-windmill',label:'Inside the windmill',camera:[86.76,1.6,28.99],target:[88.85,.7,26.9]},
 {id:'int-tower-house',label:'Inside the tower house',camera:[70.3,1.6,20.9],target:[68.3,.9,19.6]},
 {id:'int-tower-house-top',label:'Tower house bedroom',camera:[69.9,6.85,19.2],target:[68.6,5.5,20.9]},
 {id:'int-chapel',label:'Chapel',camera:[84.5,1.7,80.6],target:[88.7,.9,82.3]},
 {id:'int-clinic',label:'Clinic',camera:[63.9,1.7,-6.4],target:[64.1,.9,-10.5]},
 {id:'int-bathhouse',label:'Bathhouse and laundry',camera:[83.5,1.7,-8.4],target:[83.5,.9,-12.5]},
 {id:'int-potting-shed',label:'Potting shed',camera:[43.4,1.7,80.9],target:[44.2,.9,84.3]},
 // Seafront hotels (hotel-core.ts; z 121, door on the sea side at z 126): hotel 1's lobby from inside the door, hotel 2's
 // lobby towards its stair core (east), and hotel 2's Room 101 on the first floor (y 3.12) from the balcony door to the desk.
 {id:'int-hotel-1-lobby',label:'Seafront hotel 1 lobby',camera:[123.5,1.7,124.8],target:[117,.8,120.5]},
 {id:'int-hotel-2-stair',label:'Seafront hotel 2 lobby and stair',camera:[137.5,1.7,124.6],target:[141.3,1.8,120.6]},
 {id:'int-hotel-2-room-101',label:'Room 101, seafront hotel 2',camera:[133.1,4.7,124.6],target:[134.1,3.9,119.2]},
]);
