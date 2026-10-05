# Explicit local Eden bootstrap (C207 / PM-T053)

`tools/core/local-eden.mjs` is a source-owned process entry, separate from
production `main.ts`. It runs the immutable C194 native/runtime closure, actual
Hono server, current private-Me WebSocket Hub, lifecycle, V2/history and REST/MCP
agent services. Its host is always loopback; minds are fake, model keys cleared,
budget zero, invites required, one ordinary account quota unchanged at five.
V2 choices are enabled; optional retries are disabled. No automatic cast is seeded.

The selected runtime is
`<worktrees>/core/.e2e/exports/core-native-c190-live-me-45b9c986/sim`.
The entry verifies its sealed content-manifest identity and twelve direct runtime
pins. Transitive source/vendor custody remains the accepted C194 closure; this
is no new full dependency qualification. PM copies only this entry into its
preview worktree; `PREVIEW_INPUT` selects that immutable supplier. Frontend and
public model assets are explicit independent paths chosen by PM. No Core branch
overlay, new install, live configuration, root/main change or frozen-source edit.

PM's `team/previews/20261005/preview.py` accepts this descriptor:

```json
{
  "entry": "tools/core/local-eden.mjs",
  "dataDir": "<team>/previews/20261005/eden-data",
  "worldId": "pm-preview-eden-20261005",
  "build": "local-core-c194-20261005",
  "previewFlags": {
    "PREVIEW_INPUT": "<worktrees>/core/.e2e/exports/core-native-c190-live-me-45b9c986/sim"
  }
}
```

PM owns installing, starting/stopping and serving the combined app at4970.
The launcher also takes positional input/data/world/port/web/assets arguments
for isolated Core use. Neither path loads `.env`. `SIGINT`/`SIGTERM` refuses new
HTTP inputs, drains existing V2 workers while the clock/DB remain available,
saves an eligible snapshot, and closes sockets/server/DB. This is controlled
shutdown; no held-worker abort, crash recovery or automatic reinterpretation.

## Old preview preservation

An actual read-only SQLite backup of the old4970 DB held one Soul
`s_06e6dc6de0`, owner`dev:admin`, body`h_06e6dc6de0`,172 original events. Its
rules have no`crew-removal/1`. The physical Greenfield→commons preview on the
copy succeeded at1716002; an actual installation then reached the existing
LifecycleRunner policy refusal. That failure is retained. No versioned legacy
crew-policy migration is present in C194.

The final launcher refuses such a header before host boot or physical writes:
`local-bootstrap.lifecycle-policy-upgrade-unavailable`. Copied DB normal schema
migrations add token_generation; every original persisted column in worlds,
events, Souls and snapshots remains identical. Core never opened the original
DB for writes or managed4970. PM explicitly selected a distinct new persistent
world/DB on October5. Keep the old world/history and consistent backup; a fresh
world is not its migration. T054 policy migration is a separate successor.

## What works and what remains unavailable

Normal frontend/admin invitation and lifecycle creation can run after startup.
The registered native safe commons, clock, current authority, owner/agent APIs
and archived native observations use actual C194 services. Existing structured
legacy goals/cards remain available through their ordinary supported APIs.
The fake Brain's general text compiler returns null: V2 records a received
request, then`refused/not-understood`. It does not invent understanding,
physical fulfilment, models or a replacement grammar. This gap must be visible
to the local user. Audio/station/camp expansion/drinking are not installed by
this profile. Real sign-in/installed agent host/device/browser/release are
separate PM/App qualification.

## Bounded evidence and failures

- Native C194 progressive20→30,60simsec/phase:30 ordinary invited owned Souls
  admitted/ready/clear, no native or lifecycle faults. All20 moved in phase1;
  only24/30 endpoint-moved in phase2: **FAIL**. Tickp95 2.30/2.33ms;
  unforced heap67.2/63.4MB. Original report13:49:16 retained.
- Smaller5→10, same bounded workload: all5 moved in phase1; ten admitted/ready
  and clear, only4/10 moved in phase2: **FAIL**. Tickp95 .90/.87ms. Original
  report15:16:00 retained. Idle/completing programs and seeded choice need
  diagnosis; these are endpoint displacement tests, not actor-hour activity,
  resource sufficiency or sustainable AI budget proof. No weaker passing label.
- Actual final launcher:7 checks on fresh disposable native world with two
  invited ordinary synthetic human owners, prefixed real HTTP/WS, own-only
  welcome, V2 received→truthful refusal, anonymous/foreign negatives, actual
  REST pairing/revocation, fake$0. Proof`fresh-final.json`. No credential values
  exported. First wire test incorrectly used proto1/`welcome.me`; retained FAIL,
  corrected to source PROTO/actual`welcome.you`.
- Clean minimal environment CLI actual startup/HTTP health/SIGTERM exit0:
  `cli-smoke.json`. Copied legacy refusal/persisted-value preservation:
  `refusal-final.json`. Launcher shutdown closes every owned socket/process.
- First copied migration opened before lifecycle-policy validation and hit the
  actual missing-policy refusal; final guard moved ahead of boot. Initial
  preservation assertion compared raw tuples after an appended schema column;
  final comparison verifies every original column explicitly.

Private proof files are under Core`.e2e/preview-migration`; capacity reports
under`.e2e/c194-cohort`. PM receives exact pins in the shared review record.
These reports are local evidence, not public recordings or production readiness.
