// The corrected Mimos / Chiba kitchen layout (Gene, 2026-10-10, team/scratch/multiworld-restoration-20261010/
// layout-handoff/USER-MARS-CORRECTION-20261010.md) as physics for mars-two, in the Mimos frame: N, E = metres along the
// Mimos CAD frame's axes from its origin. MARSFIX (2026-10-12): that frame's +N is TRUE EAST and +E TRUE SOUTH (Chiba's
// panels face +E; frame.mjs BEARING 90), and Gene's words are true compass (team/lanes/marsfix.md): north = −E, east = +N.
// The rooms are the retained CAD's own north–south bays (rack rows at N −5.35, −1.6, 2.1), as the corrected sim.mars.college
// source (mars-src-fix a5376c1, details-2026-true-compass.ts) draws them. Heights are metres above the camp ground.
//
// What is Gene's explicit correction (G) and what is a photo/CAD fit (F) is noted per item.

export const RAISED = 0.53;    // F: the CAD's raised wooden floor at native .53

/** Rooms per building entity: [id, label, N0, N1, E0, E1, y]. Labels carry the aliases Souls may use. */
export const ROOMS = {
  mimos: [
    // G: Mimos main is the western longitudinal section of the L; its northern sections have raised wooden flooring
    ['main', 'Mimos main (raised: coffee counter, MIMOS sign, study table)', -1.65, 2.05, -11.735, -4.73, RAISED],
    // G: its southern section is at ground level (F: the lounge before the sloping glazing; the room stops where the glass is ~1.4 m high)
    ['main-south', 'Mimos main south (ground level, the lounge by the glazing)', -1.65, 2.05, -4.73, 2.4, 0],
    // G: the short south-east arm is Mimos floor, flooring throughout (F: a mat on the ground), behind the sloping glazing
    ['floor', 'Mimos floor (glazed tea room, honey sofa under the posters)', 2.05, 5.92, -4.73, 2.4, 0],
  ],
  kitchen: [
    // G: the kitchen/diner is immediately WEST of Mimos main, two full longitudinal bays as long as main (F: the CAD bays)
    ['working-kitchen', 'Working kitchen (Chiba kitchen: counters, sinks, prep table)', -9.25, -5.35, -11.735, -0.5, RAISED],
    ['dining-hall', 'Dining hall (diner: blue wall, bus seats)', -5.35, -1.65, -11.735, -0.5, RAISED],
  ],
  showers: [
    // G: two wooden bays offset diagonally NORTH-EAST of main's north-east corner, touching at the corner; F: sizes, doors south
    ['shower-1', 'Shower bay 1 (south-west bay)', 2.05, 4.49, -14.175, -11.735, 0.07],
    ['shower-2', 'Shower bay 2 (north-east bay)', 4.49, 6.93, -16.615, -14.175, 0.07],
  ],
};

/** Walls: [id, N0, N1, E0, E1, y0, y1]. Thickness 0.1 m unless the range says otherwise. Gaps are the doors. */
export const WALLS = {
  mimos: [
    // main's north wall (F: authored plywood; Gene: "outside the north wall of Mimos main was simply outdoors")
    ['north', -1.65, 2.05, -11.85, -11.745, 0, 3.2],
    // main's west wall: the CAD wall 0018 / the diner's blue wall, then the strip south of the diner to the glazing's west end
    ['west', -1.70, -1.60, -11.735, 0.0, 0, 3.0],
    // the glazing's west end (CAD frames 0650/0656) with the front door (F) at E 0.6…1.55
    ['west-end-n', -1.88, -1.75, 0.0, 0.6, 0, 2.6], ['west-end-s', -1.88, -1.75, 1.55, 3.66, 0, 2.0],
    // G: main's east side north of Mimos floor is the closed wooden bay divider against the outdoor quadrant
    ['east-divider', 2.03, 2.08, -11.735, -4.73, 0, 2.9],
    // G: the poster wall: Mimos floor's north wall (the CAD enclosure 0640's north face)
    ['poster-wall', 2.05, 5.92, -4.78, -4.70, 0, 2.9],
    // Mimos floor's east wall (0640 east face) and the glazing's east end (CAD 0641–0660)
    ['east', 5.92, 6.0, -4.73, 0, 0, 3.0], ['east-end', 5.80, 5.92, 0, 3.66, 0, 2.6],
    // G: the southern front is the sloping plexiglass: a body is stopped where the glass is ~1.4 m above the floor (E 2.4)
    ['south-glazing', -1.85, 5.92, 2.4, 2.5, 0, 1.6],
    // G: the raised floor's ending is a real boundary: a step riser, open only where the three risers come up (N .95…2.0)
    ['riser', -1.65, 0.95, -4.78, -4.68, 0, RAISED + 0.05],
    // the raised floor's body: nobody stands under it (its top is the floor on level 1)
    ['under-main', -1.60, 2.0, -11.70, -4.78, 0, RAISED - 0.01],
  ],
  kitchen: [
    // the kitchen's west wall (CAD 0547; Chiba's north-east corner in its south) and the north wall of both bays (CAD 1785/1834/0004)
    ['west-wall', -9.35, -9.25, -11.735, -0.5, 0, 2.9],
    ['north-wall', -9.25, -1.65, -11.85, -11.745, 0, 2.9],
    // the diner's east wall: the photographed blue wall on CAD 0018, full length (bus seats against it)
    ['blue-wall', -1.70, -1.60, -11.735, -0.5, 0, 2.9],
    // F: the partial partition on the bay line between kitchen and diner (the rest of the rack line is open)
    ['bay-partition', -5.40, -5.30, -7.93, -4.93, RAISED, 2.88],
    // G: the kitchen's south edge with the food-service window (sill 1.37 m, head 2.63 m), the red door east of it. Below the
    // window the inside counter return (N −8.9…−6.2) and the exterior serving shelf close it; the strip west of the counter is
    // too narrow for a body
    ['south-hatch-head', -9.25, -6.18, -0.49, -0.39, 2.63, 2.9],
    ['south-mid', -6.08, -5.95, -0.49, -0.39, 0, 2.9], ['south-e', -5.60, -5.35, -0.49, -0.39, 0, 2.9],
    // the diner's south edge with the blue entry door
    ['diner-south-w', -5.35, -3.25, -0.49, -0.39, 0, 2.9], ['diner-south-e', -2.30, -1.65, -0.49, -0.39, 0, 2.9],
    // the raised floors' body
    ['under-kitchen', -9.20, -5.40, -11.70, -0.60, 0, RAISED - 0.01], ['under-diner', -5.30, -1.70, -11.70, -0.60, 0, RAISED - 0.01],
  ],
  showers: [
    // bay 1: west, north and east walls; the door in its south wall (between the piers)
    ['s1-west', 2.05, 2.10, -14.175, -11.735, 0, 2.27], ['s1-east', 4.44, 4.49, -14.175, -11.735, 0, 2.27], ['s1-north', 2.05, 4.49, -14.175, -14.125, 0, 2.27],
    ['s1-door-w', 2.05, 2.85, -11.785, -11.735, 0, 2.27], ['s1-door-e', 3.69, 4.49, -11.785, -11.735, 0, 2.27],
    ['s2-west', 4.49, 4.54, -16.615, -14.175, 0, 2.27], ['s2-east', 6.88, 6.93, -16.615, -14.175, 0, 2.27], ['s2-north', 4.49, 6.93, -16.615, -16.565, 0, 2.27],
    ['s2-door-w', 4.49, 5.29, -14.225, -14.175, 0, 2.27], ['s2-door-e', 6.13, 6.93, -14.225, -14.175, 0, 2.27],
  ],
};

/** Doors (portals): [id, N, E, normalN, normalE, width, y0, y1] (normal outwards). `entrance` is what nav calls the front door. */
export const DOORS = {
  mimos: [
    // F: the door at the glazing's west end, from the yard south of the diner into main's ground section
    ['entrance-front', -1.8, 1.075, -1, 0, 0.95, 0, 2.3],
  ],
  kitchen: [
    ['entrance-diner', -2.775, -0.44, 0, 1, 0.94, RAISED, 2.61],     // F: the blue entry door, steps down to the yard
    ['kitchen-red-door', -5.775, -0.44, 0, 1, 0.35, RAISED, 2.61],   // F: the red front door onto the west stair's approach porch
    ['serving-hatch', -7.715, -0.44, 0, 1, 3.07, 1.37, 2.63],        // G: the food-service window on the south edge
  ],
  showers: [
    ['entrance-1', 3.27, -11.735, 0, 1, 0.84, 0.07, 2.11],
    ['entrance-2', 5.71, -14.175, 0, 1, 0.84, 0.07, 2.11],
  ],
};

/** A room's standing point (its slot origin, where "go into <room>" ends) when its centre is furniture: [N, E]. */
export const ROOM_AT = {
  mimos: { main: [1.45, -6.6], 'main-south': [1.5, -2.8], floor: [3.0, -2.6] },
  kitchen: { 'working-kitchen': [-8.15, -8.0], 'dining-hall': [-4.2, -6.1] },
};

/** Floor patches that are not rooms: [id, N0, N1, E0, E1, y]. */
export const TERRACES = {};

/** Where a Soul told "walk to <building>" goes when its doors are all up on the raised floor: a stand slot outside, at the
 *  foot of the steps up to the door (nav's front-door approach). [id, N, E, label]. */
export const ENTRANCES = {
  kitchen: ['entrance', -2.775, 1.0, 'Outside the blue diner door, at the foot of the diner steps'],
};

/** Stairs: [id, from [N, E, y], to [N, E, y], width]. */
export const STAIRS = {
  mimos: [
    // F: three ordinary risers (0.177 m) climbing NORTH from main's ground section onto the raised floor along its east side
    ['main-step', [1.475, -3.6, 0], [1.475, -5.0, RAISED], 1.0],
  ],
  kitchen: [
    // F: the steps from the yard up to the blue entry door
    ['diner-step', [-2.775, 0.75, 0], [-2.775, -0.9, RAISED], 0.94],
  ],
};

/** MARSLIVED: floors up in a rack building's decks, in mars-two coordinates (the rack grid is turned −0.21 rad):
 *  [id, centre [x, z], half [along the rack, across it], yaw, y]. Tool camp's library loft (the upstairs northeast bay,
 *  V3 wood_component-1931, where its cushions, low table and bookshelf are) and the east terrace that continues it
 *  (V3 "Tool library photographed continuing east terrace"); core/mars-tool-library-stair climbs to the terrace. */
export const LOFT_Y = 2.857;
export const LOFTS = {
  'tool-camp': [
    ['library-loft', [-13.07, -55.69], [1.83, 1.22], -0.21, LOFT_Y],
    ['library-terrace', [-9.50, -54.92], [1.83, 1.83], -0.21, LOFT_Y],
  ],
};
const U = [Math.cos(-0.21), -Math.sin(-0.21)], V = [Math.sin(-0.21), Math.cos(-0.21)];
/** The terrace's south edge, 1 m east of its centre line: the stair's head. The flight runs 4.2 m south from it. */
export const STAIR_RUN = 4.2;
const HEAD = [-9.50 + 1.0 * U[0] + 1.83 * V[0], -54.92 + 1.0 * U[1] + 1.83 * V[1]], RUN = STAIR_RUN;

/** MARSLIVED: authored fixtures the reference lacks, placed by the template (cat 'fixture'): [name, def name, building,
 *  p [x, y, z], yaw]. Their defs are written by build.mjs (FIXTURE_DEFS). */
export const FIXTURES = [
  // a timber flight from the ground up to the library terrace; a stairs/1 climbs towards its local −z (yaw −0.21 = north along the rack)
  ['tool-library-stair', 'tool-library-stair', 'tool-camp', [+(HEAD[0] + V[0] * RUN / 2).toFixed(3), 0, +(HEAD[1] + V[1] * RUN / 2).toFixed(3)], -0.21],
];

/** MARSLIVED: reference contents an authored wall replaces (rows whose centre is inside are not obstacles): [N0, N1, E0, E1]. */
export const REPLACED = { kitchen: [[-5.45, -5.25, -7.95, -4.9]] };   // the partition's line: the authored bay-partition wall
