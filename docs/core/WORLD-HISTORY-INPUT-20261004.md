# Minimal input for World recorded-scene proof

October 4 Eastern. Branch `core/camp-scene-fixture`, parent3ab5daa.
Responds to World C-068/e18559c; no World source adoption or mounted proof.

## Actual serialized producer

`apps/server/test/fixtures/recorded-scene/camp-transition.v1.json` contains the
actual native engine's proving-ground0–7 take, camp7–27 take and both captured
public render bases. It was generated while HEAD was exact3ab5daa, before this
leaf-module extraction. The generator uses ordinary native create/spawn/step,
`adoptCamp()` and `takeScene()`; no synthetic from/to/start/duration/scene identity
edits. The sample actor is an engine fixture, not a real invited owner or Soul
allocation proof. No model, renderer, HTTP route, account or paid call is used.

The compact JSON is99,110 bytes, SHA-256
`9ba57b19d49b523018a6b4c704e1634741a59f00556cc72f5c1aefa724497673`.
`camp-source.v1.json` pins producer commit/bytes/hash. `camp-scene.ts` is the
reproducible generator, requiring the native engine. World needs only the
serialized data, not its engine imports or Core controller/storage branch.

Fixture top-level worldId is `core-camp-transition-fixture`; both captures use
that world. Capture envelopes match the public lookup shape. They are collected
directly from the actual engine, not falsely claimed as new HTTP/DB proof. The
take content IDs, full fields, final state and original tick intervals are kept.
Source fixture reproduces byte-equivalent parsed JSON after the type-only
extraction; existing native/hash/private storage checks remain separate evidence.

At tick7 the old endpoint contains pre-adoption state and the next origin
post-adoption state. Core does not impose a new viewer selection rule. World
e18559c's inclusive endpoint-before-transition convention can now be exercised
against these actual segments, then seek/gaps/epoch/unavailable/slow-assets in its
mounted fixture. Source asset paths remain mutable dependencies and complete
physical topology is not captured by a render base.

## Five-file dependency input

`codec-input.v1.json` pins exact source byte lengths/SHA-256 for:

- packages/engine-contract/package.json
- packages/engine-contract/src/hash.ts
- packages/engine-contract/src/scene-capture.ts
- packages/protocol/package.json
- packages/protocol/src/scene-capture.ts

The package exports now name `@sim/engine-contract/scene-capture` and
`@sim/protocol/scene-capture`. The public RenderScene type is colocated with its
capture leaf and re-exported by the existing engine contract, avoiding erased
type dependencies on a complete Engine. The protocol decoder moves to its own
leaf, importing the engine-contract leaf; its original main/public export stays.
Schema/hash/response behavior is unchanged from3ab5daa. No root manifest, lock,
dependency version or installation changes. The only runtime dependency for the
observed leaf path is existing zod4.6.5 plus the hash/capture leaves.

Core grants scoped adoption of these five exact files and the two public camp
JSON fixtures in World's existing worktree for its isolated consumer build/proof.
Use this commit and the manifest hashes; import the leaf subpath rather than the
complete protocol/engine-contract index. No Core engine.ts, storage, controller,
private-intent module or whole parent branch is needed. The generator and Core
test remain Core-owned. Retain exact source/provenance in World's proof receipt.

These are source/exports inputs for the existing workspace or isolated fixture
resolution. Package manifests still describe their full existing packages;
this is not a newly installable dependency-distribution bundle. Do not run a new
dependency install or change root/static wiring under this scoped permission;
PM keeps that lead. If import-resolution aliases are needed in an isolated
generated artifact, declare each mapping and retain original source hashes;
schema or hashing logic must not be rewritten.

## Proof

19/19 focused camp-input, backend scene storage/privacy, native capture and real
four-world contract checks PASS; server/native/web TypeScript PASS. The new two
checks validate serialized native reproduction/addresses/captures and execute
the exact five-file input in an isolated subprocess with only existing zod linked.
No engine, kernel, storage or root index module exists in that isolated tree;
both real fixture captures decode. Source manifest hashes are checked before
copy. This is runtime closure, not browser bundling or mounted viewer proof.

Run `node --test apps/server/src/camp-scene-fixture.test.ts` for the new checks.
Prior3ab5daa65+4 proof is retained without another broad/unchanged construction
run. Fake local/$0; diff/secrets/normal hooks retained. No failed physical receipt
is relabeled, and no live/main/push/deploy claim follows. World exacte18559c source
counterpart is reviewed separately; PM/App/World release gates remain held.
