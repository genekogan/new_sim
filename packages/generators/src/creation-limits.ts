/** Shared authoring safety rules. Metres, bytes and counts; never model-call budgets. */
export const CREATION_LIMITS = Object.freeze({
  /** Minimum clear width for a resident passing through an entrance. */
  bodyWidthM: 0.75,
  /** Standing headroom checked against obstacles in an entrance approach. */
  bodyHeightM: 2,
  /** Keep this short corridor outside an exterior opening passable. */
  sealApproachDepthM: 1.5,
  /** Broad-phase entrance queries include a small contact/numeric margin. */
  sealQueryMarginM: 0.05,
  /** Maximum yaw boxes replacing one pitched/rolled primitive. */
  kitColliderSlices: 8,
  /** Target vertical over-coverage for a sliced tilted primitive, before the slice cap. */
  kitColliderSliceRiseM: 0.25,
  /** Existing entity ceiling; all expansion/clone paths share admission now. */
  worldEntities: 50_000,
  /** Retained definition hashes, including historical versions needed by undo. */
  worldDefs: 10_000,
  /** Sum of baked triangles for placed instances (including expanded children). */
  worldTris: 50_000_000,
  /** Spatial-hash cell side used by collision lookup and density admission. */
  regionSizeM: 16,
  /** Maximum solid entities touching one spatial-hash cell. */
  regionSolidEntities: 1024,
  /** Uploaded assets retained by a world; shared core assets do not count. */
  worldAssets: 10_000,
  /** Total uploaded asset bytes attributed to a world (content hashes count once). */
  worldAssetBytes: 2_000_000_000,
  /** Authoring journal ceiling; refuse growth, never discard accepted history. */
  journalBytes: 512 * 1024 * 1024,
  /** Maximum retained authoring journal records. Engine-only pose patches do not create records. */
  journalEntries: 1_000_000,
  /** Reserved above the authoring ceiling for finite engine retirement/removal work. */
  journalCleanupBytes: 64 * 1024 * 1024,
  /** Cleanup must reduce existing entities; new births cannot replenish this reserve. */
  journalCleanupEntries: 50_000,
  /** Bound recursive JSON work before schema parsing or content hashing. */
  inputDepth: 32,
  /** Maximum visited JSON values in one compiler request. */
  inputNodes: 100_000,
  /** Finite numeric envelope; geometry and individual fields impose tighter limits. */
  numericMagnitude: 1_000_000_000_000,
  /** Wire and local compiler batch size, before decoding/normalisation. */
  jsonBodyBytes: 2 * 1024 * 1024,
  /** A definition's serialised input, independent of mesh bytes. */
  defBytes: 256 * 1024,
  /** Maximum explicit operations in one public or trusted batch. */
  batchOps: 256,
  /** Bound expansion work (prefabs, repeats and clone subtrees) within one batch. */
  batchEntityChanges: 4096,
  /** Definition/default-bake and mesh triangle admission default; instances also count toward worldTris. */
  defTris: 80_000,
  /** Maximum uploaded mesh bytes by default. */
  assetBytes: 3_000_000,
  /** Maximum dimension of an embedded or standalone texture. */
  texturePx: 2048,
  /** Images have a tighter byte ceiling than meshes. */
  imageBytes: 2_000_000,
  /** Uploaded physics sidecar JSON maximum. */
  footprintBytes: 1_000_000,
  /** Allow multipart field headers and boundary framing above the file limits. */
  multipartOverheadBytes: 64 * 1024,
  /** Authored definition bounds defaults (width, height, depth). */
  defSizeMaxM: Object.freeze([400, 120, 400] as const),
  /** Smallest dimension of a definition's declared bounds. */
  defSizeMinM: 0.05,
  /** Maximum authored world side length, including expansions. */
  worldExtentM: 16_000,
  /** JSON parameter/state object serialisation limit. */
  fieldJSONBytes: 8192,
  /** Authored entries in a kit definition (before program expansion). */
  kitShapes: 96,
  /** Maximum primitives after kit program expansion. */
  kitExpandedShapes: 512,
  /** Existing aggregate-box optimisation applies only to upright kits. */
  uprightKitMergeThreshold: 12,
  /** Maximum depth and total parts in a declared prefab. */
  prefabDepth: 4,
  prefabParts: 256,
  /** Maximum repeats of an authored prefab part. */
  partRepeats: 64,
  /** Retained idempotency receipts per world. */
  requestReceipts: 1000,
  /** Largest accepted response persisted for a clientRef. */
  requestOutcomeBytes: 256 * 1024,
  /** Thumbnail pixel dimension and byte ceilings. */
  thumbnailPx: 512,
  thumbnailBytes: 400_000,
  /** Per-token sliding window and expensive endpoint allowances. */
  rateWindowMs: 60_000,
  verifyPerMinute: 6,
  assetUploadsPerMinute: 12,
  thumbnailUploadsPerMinute: 30,
  previewsPerMinute: 30,
  dryrunsPerMinute: 60,
  /** Mutation and terrain authoring request allowances per token. */
  actsPerMinute: 120,
  landEditsPerMinute: 30,
  /** Shared clock/weather edits and deliberate lightning strikes, per token. */
  envEditsPerMinute: 30,
  strikesPerMinute: 30,
  /** Public geometry queries keep public access: anonymous callers use the IP limiter. */
  queriesPerMinute: 120,
  /** A god CLI issues one or two queries per command (B1 peaked at 42 commands a minute); per token. */
  godQueriesPerMinute: 600,
});
