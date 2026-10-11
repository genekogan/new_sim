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
    // G: the southern front is the sloping plexiglass across main south and the arm
    ['south-glazing', -1.99, -1.89, -4.73, 3.76, 0, 2.6],
    // G: the raised floor's ending is a real boundary: a step riser, open only at the stair
    ['riser-w', 0.04, 0.14, -4.73, -3.45, 0, RAISED + 0.05], ['riser-e', 0.04, 0.14, -2.2, 0, 0, RAISED + 0.05],
    // the raised floor's body: nobody stands under it (its top is the floor on level 1); open where the stairs come up
    ['under-main-w', 0.14, 5.88, -4.68, -3.4, 0, RAISED - 0.01], ['under-main-e', 0.14, 5.88, -2.2, -0.05, 0, RAISED - 0.01], ['under-main-mid', 0.65, 5.25, -3.4, -2.2, 0, RAISED - 0.01],
  ],
  kitchen: [
    // the diner's east wall: the photographed blue wall, full length (bus seats against it)
    ['blue-wall', -1.85, 5.92, -4.78, -4.68, 0, 2.9],
    // the kitchen's west wall (perimeter counter follows it)
    ['west-wall', -1.99, 6.03, -11.84, -11.745, 0, 2.9],
    // north: the far end of both bays (diner window, kitchen sink wall)
    ['north-wall', 5.93, 6.03, -11.84, -4.73, 0, 2.9],
    // F: the late partial partition between the bays (V3), the rest of the rack line is open
    ['bay-partition', 1.04, 4.04, -7.66, -7.58, RAISED, 2.88],
    // south: the serving hatch (window, sill 1.37 m) and the red front door, the blue entry door to the diner
    ['south-hatch', -1.99, -1.89, -11.84, -8.25, 0, 1.37], ['south-hatch-head', -1.99, -1.89, -11.84, -8.25, 2.63, 2.9],
    ['south-mid', -1.99, -1.89, -7.62, -6.1, 0, 2.9], ['south-e', -1.99, -1.89, -5.14, -4.73, 0, 2.9],
    // under the raised floor: its south edge between the doors is closed to the ground
    ['south-red-sill', -1.99, -1.89, -8.25, -7.62, 0, RAISED - 0.05], ['south-blue-sill', -1.99, -1.89, -6.1, -5.14, 0, RAISED - 0.05],
    // the raised floors' body (open where the diner steps come up through the blue door)
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

/** Stairs: [id, from [N, E, y], to [N, E, y], width]. */
export const STAIRS = {
  mimos: [
    // F: V3's three ordinary risers (0.177 m) from main south up to the raised main
    ['main-step', [-1.15, -2.83, 0], [0.55, -2.83, RAISED], 0.9],
    // F: V3's visible rear stair from the camp ground up to the rear alcove door
    ['rear-stair', [7.3, -2.75, 0], [5.5, -2.75, RAISED], 0.9],
  ],
  kitchen: [
    // F: steps from the ground up to the blue entry door and the red front door (the Chiba hall floor south of them)
    ['diner-step', [-3.55, -5.62, 0], [-1.45, -5.62, RAISED], 0.94],
  ],
};
