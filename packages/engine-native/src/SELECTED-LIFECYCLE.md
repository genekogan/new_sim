# Selected native lifecycle transition

How an existing native world adopts safe crew removal (`+crew-removal/1`) without changing its history.

`selectedNativeCrewRemovalFactoryV1(selectedConfig)` (`selected-crew-removal.ts`) wraps the world's exact native config
and its `safeCrewRemoval:true` counterpart. It keeps the original genesis and admits only those two exact rules
versions; snapshot base and scene are checked before the active phase is decoded. Default factories are unchanged.

## Adopting

1. Install this reader before opening the world's history.
2. At a naturally quiet, resumable native boundary, call `host.adoptCrewRemovalPolicyV1('operator:…')` and drive the
   sequencer. The accepted event and header update are atomic. Bodies, identities, map, clock and the original prefix
   do not change. Nothing forces quiet, cancels a body, fabricates a snapshot or alters day configuration. A not-quiet
   refusal is a readiness result, not permission to force anything; a running waiting programme must finish first.
3. Enable `souls.enableLifecycle()` explicitly after boot.

A restart whose engine already has `+crew-removal/1` reuses the accepted fact; never append another transition. An
ordinary legacy startup without the flag installs neither the reader nor the lifecycle producer. Auth and provider
configuration stay separate. Qualify acceptance on a copy of the world's data before doing it on the real world.

After acceptance the world needs this dual reader plus the crew-removal transition contract and safe-removal runtime;
the original legacy factory refuses the new header. Rolling back to older code requires the preserved pre-acceptance
data, never a relabelled header or a discarded accepted event.

## Launcher

Native `openWorldServer` (`tools/core/multiworld/world-server.mjs`) installs the dual reader before boot and the
lifecycle producer before listening only with explicit `nativeLifecycleV1:true`; otherwise it keeps the old factory and
behaviour. `checkOnly` never accepts a policy.

If the world is still doing accepted work, the operator can pass `prepareNativeLifecycle({host,souls,drive})` to wait
for its quiet boundary. No listener starts during that callback, and the launcher implements no timeout, forced quiet or
cancellation, so the caller must bound the wait. The policy is then installed exactly once; a cold restart with the flag
reuses the recorded fact.

`installSelectedNativeLifecycleV1(host,souls,drive,author)` (`selected-lifecycle-bootstrap.ts`) performs the same guarded
acceptance and idempotent lifecycle enablement as an internal helper, not over HTTP. With the flag enabled, the returned
runtime context also exposes `bootstrapNativeLifecycle()`.

Tests: `apps/server/src/selected-native-lifecycle.test.ts` (Mars and Little Martians native factories, local owner
lifecycle requests, SQLite, fake models). They do not cover production accounts, browser behaviour or retirement
execution.
