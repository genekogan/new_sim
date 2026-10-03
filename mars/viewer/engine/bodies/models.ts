// The Little Martians floater models (worlds/littlemartians/characters/manifest.json is the source of
// truth for files, sizes, hashes, licence and lore; engine/test/floaters.test.ts keeps this table equal
// to it). Pure data: no loader, no DOM.

export type FloaterModel = {
  id: string;
  name: string;
  /** Path relative to worlds/littlemartians/characters/. */
  file: string;
  group: 'floater' | 'kin';
  /**
   * Facing offset (radians about +Y) applied to the loaded glTF scene so its face points along the
   * orientation group's +Z, as flock.html's ORIENT map does; the values are measured from six-axis
   * renders (manifest facing.source keeps the flock ORIENT value). The renderer then turns +Z to the
   * engine's yaw-0 direction, +X.
   */
  facingYaw: number;
  pronouns?: string;
};

export const FLOATER_MODELS: readonly FloaterModel[] = [
  { id: 'verdelis', name: 'Verdelis', file: 'verdelis.glb', group: 'floater', facingYaw: 0, pronouns: 'she/her' },
  { id: 'kalama', name: 'Kalama', file: 'kalama.glb', group: 'floater', facingYaw: Math.PI, pronouns: 'she/her' },
  { id: 'kweku', name: 'Kweku', file: 'kweku.glb', group: 'floater', facingYaw: Math.PI, pronouns: 'he/him (mostly)' },
  { id: 'mycos', name: 'Mycos', file: 'mycos.glb', group: 'floater', facingYaw: 0, pronouns: 'he/him' },
  { id: 'ada', name: 'Ada', file: 'ada.glb', group: 'floater', facingYaw: Math.PI, pronouns: 'she/her' },
  { id: 'shuijing', name: 'Shuijing', file: 'shuijing.glb', group: 'floater', facingYaw: Math.PI, pronouns: 'they/them' },
  { id: 'nyx', name: 'Nyx', file: 'nyx.glb', group: 'floater', facingYaw: 0 },
  { id: 'green-patterns-blue', name: 'Green Patterns Blue', file: 'kin/green-patterns-blue.glb', group: 'kin', facingYaw: 0 },
  { id: 'chebel', name: 'Chebel', file: 'kin/chebel.glb', group: 'kin', facingYaw: 0 },
  { id: 'colors-lemuet', name: 'Colors (Lemuet)', file: 'kin/colors-lemuet.glb', group: 'kin', facingYaw: 0 },
  { id: 'crystal-freeman', name: 'Crystal (Freeman)', file: 'kin/crystal-freeman.glb', group: 'kin', facingYaw: 0 },
  { id: 'dark-blue', name: 'Dark Blue', file: 'kin/dark-blue.glb', group: 'kin', facingYaw: 0 },
  { id: 'green-brains-out', name: 'Green, Brains Out', file: 'kin/green-brains-out.glb', group: 'kin', facingYaw: 0 },
];

export const floaterModel = (id: string | undefined): FloaterModel | undefined => (id === undefined ? undefined : FLOATER_MODELS.find((m) => m.id === id));
