/** House fixtures the existing interiors lack (World furnished kitchens, beds, sofas, shelves and the piano already):
 * round rugs on the house 3 and 4 living-room floors (floor top 0.10 m), clear of the activity-spots furniture boxes.
 * A hearth was tried on house 3's east wall but the (unlisted) piano stands there; walls with free space for a
 * fireplace, bath or WC need World's interior plan (open item). */
export type Fixture = { id: string; model: string; at: [number, number]; y: number; yaw: number; scale?: number };
export const FIXTURES: readonly Fixture[] = [
  { id: 'house3-rug', model: 'int-carpet-round', at: [33.6, 33.45], y: 0.10, yaw: 0, scale: 0.68 },
  { id: 'house4-rug', model: 'int-carpet-round', at: [53.4, 33.4], y: 0.10, yaw: 0, scale: 0.68 },
];
