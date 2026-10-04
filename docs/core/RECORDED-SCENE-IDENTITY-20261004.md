# Recorded render-base identity

October 4 Eastern. Branch `core/recorded-scene-identity`, parent `7c1e11d`.
Local additive producer/checkpoint for W-002. World/App/PM counterparts and
coordinated release remain open. No terrain, support, water, boat, new body,
scene-proposal installation or private intention activation is implemented here.

The observable improvement is historical geometry lookup: a new recorded take
names the public render base it used, and that exact base survives database
reopen and verified take pruning. The old camp-adoption path discarded an
unfinished recording when it replaced the runtime. It now seals that partial
segment before changing campus, then begins the camp segment at the same tick.

## Exact producer and wire

`RenderSceneRefV1` in `@sim/engine-contract` is strictly:

```ts
{ contract:'render-scene-ref/1', rulesVersion:string, hash:string }
```

The SHA-256 address covers stable JSON of
`{contract:'render-scene-capture/1',rulesVersion,body}`. `body` is the existing
engine `renderScene()` projection: base scene, optional clock/grass ground,
decorative buildings and kin. Existing Little Martians `kin.hover` is preserved.
This is the published render base. It does not capture the complete derived
physical scene, construction traversal contributors, obstacle edits, body/action
rule epochs or content bytes for referenced asset paths. Actor/object changes
remain in the take. Asset availability and physical compatibility are separate.

The capture helper supplies a detached JSON body, rejects unknown top-level
claims/non-finite numbers/missing scene and limits the body to 1 MiB. Existing
inner geometry remains engine-specific. This is not a sanitizer for arbitrary
private data: only trusted engines' already-public render output is supplied.
The strict capture parser recomputes the address; the protocol's
`decodeSceneCapturePublication` also validates the public world envelope.

Native and observation-only Toy takes add optional `renderSceneRef` inside
`mars-take/4`. The recorder receives it before hashing, so the take ID continues
to address every other take field. New IDs consequently differ from otherwise
identical old takes; old stored takes/IDs are not rewritten. Old takes without a
reference remain unbound. Consumers must not infer their geometry from current
`/v1/scene`. Existing pure sample/field/lifecycle decoders retain their behavior.

Normal recording remains twenty ticks per segment and twelve hot chunks.
Supported camp/clock/compaction boundaries may seal a shorter segment. No empty
segment is emitted; replaced zero-tick recorders still detach their observer.
A no-op clock setting preserves physical clock refresh without a new segment.
At a same-tick transition the old segment ends with pre-transition state and the
next starts with post-transition state; World must qualify boundary selection.

`Engine.takeScene(hash)` is an optional detached lookup for current/hot captured
bases. Native keeps the current base plus bases referenced by twelve hot chunks,
at most thirteen. The authored base is immutable within one engine instance;
supported campus/config/clock boundaries invalidate the capture cache. Arbitrary
runtime source hot-patching is not a qualified mutation mechanism.

Migration 11 adds `render_scene_captures(world_id,hash,body)`. Hub stores the
capture and its first referring take in one `BEGIN IMMEDIATE` transaction,
before broadcast. References require a matching registered capture; new take
content addresses/rules/intervals are validated. A different scene at an already
retained take endpoint is refused, preserving the original. Existing same-base
duplicate endpoint handling remains insert-or-ignore; this does not solve all
recovery-era duplicate recording/epoch semantics.

Captures are deduplicated per world/hash and retained separately from take
pruning. The DB verifier caches at most sixteen captured bodies plus their exact
encoded rows. Every read compares stored bytes; changed rows are reverified and
tampering is rejected. Returned objects are detached. Hub supplies full capture
data only when its reference is not yet registered, avoiding repeated scenery
hashing on every one-second take. There is no new pruning promise for geometry;
long-term retention/export/GC and whole-device performance remain gates.

Public selected-world routes:

- `/v1/scene` retains all existing fields and adds current `renderSceneRef`.
  This is an observation of current code; it is not historical installation or
  a promise that the current base has already been archived. It uses no-store.
- `/v1/scenes/:hash` returns
  `{worldId,contract:'render-scene-capture/1',ref,body}` from the selected world's
  registered captures. Invalid/unknown/foreign-world hashes return the same404,
  and normal 200/404 replies use no-store. Generic exceptional 500 cache behavior
  is not established by these fixtures. It has no mutation or model operation.
- HTTP hot/durable takes, anonymous WS and compressed archive chunks carry the
  optional reference through their existing take body. No extra scene blob is
  duplicated in each take or socket message. Clients use the lookup explicitly.

This identifies recorded public presentation, not a process WS epoch, proposal
revision, trusted terrain installation or canonical physical-rule version.
Snapshot format, engine/kernel state hashes, rules version and log kinds remain
unchanged. Genesis replay with changed physical source is still an open gate.

## Evidence and limits

Final focused run: **65/65** across scene storage/native capture, actual four-world
W/G producers, Toy800-step checkpoint parity, archive, native/portable hash parity,
replay regressions and inherited private admission/controller producers. Separate
native finite construction/compaction checks and server/native TypeScript results
are recorded in the handoff. No broad MarsDJ rerun or historical failure relabeling.

Actual native evidence includes current detached captures, take/content/final-state
hashes and sampling, snapshot continuation, camp0–7(old)/7–27(new), clock splits,
zero-tick observer lifetime and bounded hot capture retention. The native/Toy
world and snapshot reads remain observational; no new physical controller runs.

Actual SQLite evidence includes a separate connection observing neither object
before commit and both afterward, write-trigger rollback, missing/mismatched/
tampered references, immutable old history and three serialized worker exits23:
before take write and before commit leave neither; after commit leaves both.
These are real `worker_threads` exits, not an OS process kill or a sustained soak.
An actual native0–20 chunk survives local memory-store archive compression,
verification/pruning and DB reopen. The1,806,000 pruning watermark is synthetic;
it is not an executed twenty-four-hour world or live R2 qualification.

Real Hub/anonymous WS on4955 plus Hono requests prove emitted references,
registered public lookup/current identity, unchanged old response after a clock
change, uniform invalid/unknown/other-world404, no-store and private owner/journal
marker exclusion. All sockets/server/fixture DBs close; fake local minds, paid$0.
This is backend/codec evidence. No World renderer adoption, screenshot or browser
history scene switching, actual socket process restart, source asset immutability,
GPU/phone/capacity qualification or complete W-002 is claimed.

First run was **7/9 FAIL**: strict kin capture rejected the existing public
Little Martians `hover` field in both actual producer checks. Source reads exposed
the undocumented existing field; exact type/codec support corrected it, then9/9
passed. Review also caught draft post-hash metadata attachment and a zero-tick
observer replacement leak; both were corrected before the final65-check run.
Content addresses are generated by the recorder and the zero-tick regression now
checks actual observer count. No golden/hash/timing assertion was relaxed.

Run the commands in the merge handoff. Next: World exact consumer/boundary
counterpart; accepted support/topology/water installation and canonical rule/log
checkpoint, with App retained history/feedback following the shared seam. Main,
push and deployment remain PM-owned and held for Gene's explicit handover.
