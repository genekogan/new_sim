// The corrected Mimos / Chiba kitchen layout (Gene, 2026-10-10, team/scratch/multiworld-restoration-20261010/
// layout-handoff/USER-MARS-CORRECTION-20261010.md) as physics for mars-two, in the Mimos frame: N = metres north of the
// Mimos origin, E = metres east (handover MIMOS-ASSET-PLACE-REFERENCES.json `aliases.correctedSpaces` rectNE, which are
// the V3 asset's corrected rooms). Heights are metres above the camp ground.
//
// What is Gene's explicit correction (G) and what is a photo/V3 fit (F) is noted per item.

export const RAISED = 0.53;    // F: V3 fits the raised wooden floor at native .53

/** Rooms per building entity: [id, label, N0, N1, E0, E1, y]. Labels carry the aliases Souls may use. */
export const ROOMS = {
  mimos: [
    // G: the western longitudinal section is Mimos main; its northern sections have raised wooden flooring
    ['main', 'Mimos main (raised: study, coffee counter, MIMOS sign)', 0.09, 5.92, -4.73, 0, RAISED],
    // G: its southern section is at ground level
    ['main-south', 'Mimos main south (ground level)', -1.85, 0.09, -4.73, 0, 0],
    // G: the short southeastern arm is Mimos floor, with flooring throughout; F: V3 fits it at ground level (a mat floor)
    ['floor', 'Mimos floor (glazed tea room, honey sofa under the posters)', -1.85, 0.75, 0, 3.66, 0],
  ],
  kitchen: [
    // G: the kitchen/diner is immediately west of Mimos main, two full longitudinal bays with its north-south extent
    ['working-kitchen', 'Working kitchen (Chiba kitchen: counters, sinks, prep table)', -1.85, 5.92, -11.735, -7.615, RAISED],
    ['dining-hall', 'Dining hall (diner: blue wall, bus seats)', -1.85, 5.92, -7.615, -4.73, RAISED],
  ],
  showers: [
    // G: two wooden bays offset diagonally northeast of Mimos main's northeast corner, touching at the corner; F: sizes
    ['shower-1', 'Shower bay 1 (southwest bay)', 5.92, 8.36, 0, 2.44, 0.07],
    ['shower-2', 'Shower bay 2 (northeast bay)', 8.36, 10.8, 2.44, 4.88, 0.07],
  ],
};

/** Walls: [id, N0, N1, E0, E1, y0, y1]. Thickness 0.1 m unless the range says otherwise. Gaps are the doors. */
export const WALLS = {
  mimos: [
    // north wall of main, with the rear alcove door (F: photo c49422, V3 pale door at E −3.6…−2.9)
    ['north-w', 5.93, 6.03, -4.73, -3.2, 0, 3.0], ['north-e', 5.93, 6.03, -2.3, 0, 0, 3.0],
    // G: main's east side north of the arm is the closed wooden bay divider (outside it is the outdoor gap)
    ['east-divider', 0.75, 5.92, -0.05, 0.05, 0, 3.0],
    // G: the poster wall encloses the arm against the outdoor gap to its north (not the passage to main)
    ['poster-wall', 0.75, 0.85, 0, 3.66, 0, 2.9],
    // the arm's east end: the sloping plexiglass's timber frame (V3 chiba wood 1445–1450)
    ['arm-east', -1.99, 0.75, 3.66, 3.76, 0, 2.6],
    // G: the southern front is the sloping plexiglass (V3: its timber-framed panels over the arm, wood 0648–0650, and the
    // panel at E −0.83…0.41, wood 0656); main south's front west of it is open in V3 — Mimos's ground-level way in from
    // the Chiba hall (the handover's "Mimos front: … actual openings")
    ['south-glazing', -1.99, -1.89, -0.83, 3.76, 0, 2.6],
    // MARSLIVED: main south's front, glass either side of its door (drawn by core/mars-mimos-front-glazing)
    ['front-glazing-w', -1.99, -1.89, -4.73, -3.28, 0, 2.6], ['front-glazing-e', -1.99, -1.89, -2.28, -0.83, 0, 2.6],
    // G: the raised floor's ending is a real boundary: a step riser, open only where the internal stair's landing joins it
    ['riser-w', 0.04, 0.14, -4.73, -2.47, 0, RAISED + 0.05], ['riser-e', 0.04, 0.14, -1.81, 0, 0, RAISED + 0.05],
    // F (handover floorAndAccessReference, V3 "mimos-main-raised-entry"): the three risers climb EAST along main south to a
    // raised landing (N −0.65…0.09, E −2.47…−1.81; its floor reaches over the riser tops for the planner's turn) that joins the raised floor; its south and east faces are risers too
    ['landing-s', -0.75, -0.65, -2.47, -1.71, 0, RAISED + 0.05], ['landing-e', -0.65, 0.04, -1.81, -1.71, 0, RAISED + 0.05],
    ['under-landing', -0.65, 0.04, -2.42, -1.81, 0, RAISED - 0.01],
    // the raised floor's body: nobody stands under it (its top is the floor on level 1); open where the rear stair comes up
    // MARSLIVED: nobody walks under a flight (a Soul crossing the foot of the diner steps at ground level deadlocked with
    // one climbing them; the rear stair likewise. The risers inside are left as they were: a block there sent Souls round
    // by the rear stair). `stairs:<link id>` blocks are trimmed at the foot by the engine bridge, as a
    // generated building's are; taller than 0.5 m so the bridge keeps them.
    ['stairs:rear-stair', 6.03, 7.3, -3.2, -2.3, 0, RAISED - 0.02],
    ['under-main-w', 0.14, 5.88, -4.68, -3.4, 0, RAISED - 0.01], ['under-main-e', 0.14, 5.88, -2.2, -0.05, 0, RAISED - 0.01], ['under-main-mid', 0.14, 5.25, -3.4, -2.2, 0, RAISED - 0.01],
  ],
  kitchen: [
    // the diner's east wall: the photographed blue wall, full length (bus seats against it)
    ['blue-wall', -1.85, 5.92, -4.78, -4.68, 0, 2.9],
    // the kitchen's west wall (perimeter counter follows it)
    ['west-wall', -1.99, 6.03, -11.84, -11.745, 0, 2.9],
    // north: the far end of both bays (diner window, kitchen sink wall)
    ['north-wall', 5.93, 6.03, -11.84, -4.73, 0, 2.9],
    // F: the late partial partition between the bays (V3), the rest of the rack line is open
    // MARSLIVED: 0.11 m west of V3's line (E −7.66…−7.58): with Chiba's rack upright in the diner aisle (V3 rack_member-0340,
    // E −6.89) it left 0.67 m, under a body's planning width, and the diner's north booths (#23–25) were sealed off
    ['bay-partition', 1.04, 3.93, -7.77, -7.69, RAISED, 2.88],   // (and 0.11 m shorter: fridge #18 stands at its north end)
    // MARSLIVED: that rack upright, 0.12 m east of V3 (its row is REPLACED below), so the aisle between it and the partition
    // is 0.89 m: a body plans 0.34 m either side of its centre (0.28 m radius + margin), the 0.67 m V3 gap sealed it
    ['rack-upright', 2.03, 2.11, -6.80, -6.74, 0, 2.2],
    // south: the serving hatch (window, sill 1.37 m) and the red front door, the blue entry door to the diner
    ['south-hatch', -1.99, -1.89, -11.84, -8.25, 0, 1.37], ['south-hatch-head', -1.99, -1.89, -11.84, -8.25, 2.63, 2.9],
    ['south-mid', -1.99, -1.89, -7.62, -6.1, 0, 2.9], ['south-e', -1.99, -1.89, -5.14, -4.73, 0, 2.9],
    // under the raised floor: its south edge between the doors is closed to the ground
    ['south-red-sill', -1.99, -1.89, -8.25, -7.62, 0, RAISED - 0.05], ['south-blue-sill', -1.99, -1.89, -6.1, -5.14, 0, RAISED - 0.05],
    // the raised floors' body (open where the diner steps come up through the blue door)
    // MARSLIVED: under the diner steps (see Mimos's flights)
    ['stairs:diner-step', -3.55, -1.99, -6.09, -5.15, 0, RAISED - 0.02],
    ['under-kitchen', -1.84, 5.92, -11.73, -7.62, 0, RAISED - 0.01], ['under-diner', -1.35, 5.92, -7.6, -4.75, 0, RAISED - 0.01],
    ['under-diner-sw', -1.84, -1.35, -7.6, -6.15, 0, RAISED - 0.01], ['under-diner-se', -1.84, -1.35, -5.1, -4.75, 0, RAISED - 0.01],
  ],
  showers: [
    ['s1-west', 5.92, 8.36, -0.03, 0.05, 0, 2.27], ['s1-north', 8.31, 8.36, 0, 2.44, 0, 2.27], ['s1-east', 5.92, 8.36, 2.39, 2.47, 0, 2.27],
    ['s1-door-w', 5.92, 5.97, 0, 0.8, 0, 2.27], ['s1-door-e', 5.92, 5.97, 1.64, 2.44, 0, 2.27],
    ['s2-south', 8.36, 8.41, 2.44, 4.88, 0, 2.27], ['s2-north', 10.75, 10.8, 2.44, 4.88, 0, 2.27], ['s2-east', 8.36, 10.8, 4.83, 4.88, 0, 2.27],
    ['s2-door-s', 8.36, 9.16, 2.41, 2.49, 0, 2.27], ['s2-door-n', 10.0, 10.8, 2.41, 2.49, 0, 2.27],
  ],
};

/** Doors (portals): [id, N, E, normalN, normalE, width, y0, y1]. `entrance` is what nav calls the front door. */
export const DOORS = {
  mimos: [
    // MARSLIVED (Gene, PM brief 37): main south's front is glazed with a door (V3 has no glazing there; it was open)
    ['entrance-front', -1.94, -2.78, -1, 0, 1.0, 0, 2.6],
    ['entrance-rear', 5.98, -2.75, 1, 0, 0.9, RAISED, 2.6],          // F: the rear alcove door (photo c49422, V3 pale door)
  ],
  kitchen: [
    ['entrance-diner', -1.85, -5.62, -1, 0, 0.94, RAISED, 2.61],      // F: the blue entry door (V3 kitchen-details)
    ['kitchen-red-door', -1.85, -7.94, -1, 0, 0.6, RAISED, 2.61],     // F: the red front door
    ['serving-hatch', -1.85, -9.95, -1, 0, 3.4, 1.37, 2.63],          // G: the food-service window on the south edge
  ],
  showers: [
    ['entrance-1', 5.92, 1.22, -1, 0, 0.84, 0.07, 2.11],
    ['entrance-2', 9.58, 2.44, 0, -1, 0.84, 0.07, 2.11],
  ],
};

/** A room's standing point (its slot origin, where "go into <room>" ends) when its centre is furniture: [N, E].
 *  Mimos floor's middle is the tea table, the clothing rack and the stools; its point is just inside the pass-through
 *  from main south. (Furniture in a room is placed relative to this point.) */
export const ROOM_AT = { mimos: { floor: [-1.1, 0.25] } };

/** Floor patches that are not rooms: [id, N0, N1, E0, E1, y]. */
export const TERRACES = {
  // F: the raised landing at the top of Mimos's internal stair (handover "mimos-source-visible-internal-landing-top")
  mimos: [['main-landing', -0.75, 0.3, -2.6, -1.71, RAISED]],
};

/** Where a Soul told "walk to <building>" goes when its doors are all up on the raised floor: a stand slot outside, at the
 *  foot of the steps up to the door (nav's front-door approach). [id, N, E, label]. */
export const ENTRANCES = {
  mimos: ['rear-door', 7.75, -2.75, 'Outside the rear alcove door, at the foot of the rear stair'],
  kitchen: ['entrance', -3.95, -5.62, 'Outside the blue diner door, at the foot of the diner steps'],
};

/** Stairs: [id, from [N, E, y], to [N, E, y], width]. */
export const STAIRS = {
  mimos: [
    // F: V3's three ordinary risers (0.177 m), climbing east along main south (treads at E −3.05, −2.83, −2.60, N −0.42)
    // onto the raised landing, which opens north onto the raised main (0.9 m wide for the planner: V3's treads are 0.7)
    ['main-step', [-0.42, -3.46, 0], [-0.32, -2.45, RAISED], 0.9],
    // F: V3's visible rear stair from the camp ground up to the rear alcove door
    ['rear-stair', [7.3, -2.75, 0], [5.5, -2.75, RAISED], 0.9],
  ],
  kitchen: [
    // F: steps from the ground up to the blue entry door and the red front door (the Chiba hall floor south of them)
    ['diner-step', [-3.55, -5.62, 0], [-1.2, -5.62, RAISED], 0.94],
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
  // Mimos main south's glazed front with its door (centre of the door, on the front wall's line N −1.94)
  ['mimos-front-glazing', 'mimos-front-glazing', 'mimos', [-2.78 + 48, 0, 1.94], 0],
];

/** MARSLIVED: reference contents an authored wall replaces (rows whose centre is inside are not obstacles): [N0, N1, E0, E1]. */
export const REPLACED = { kitchen: [[1.0, 4.1, -7.75, -7.55], [2.0, 2.15, -6.95, -6.83]] };
