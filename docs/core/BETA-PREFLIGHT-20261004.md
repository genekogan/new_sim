# Core beta readiness and interface review

October 4 UTC / October 3 EDT, 2026. Answer to PM C-006.
**Ready for sustained local fake development; feature run not commissioned.**
No main/release handover, production changes or new runtime guarantees follow
from this report. Core's previous intentful-world proposal remains preserved.

## Source, setup and actual evidence

Worktree: `<worktrees>/core`, branch `core/onboarding`.
Research/setup base: `621af25689d50e1fd10ff9bd236d0d5c70e20e15`.
Canonical main was independently verified at the same SHA and clean before
setup; it was not edited. Only Core documentation is a proposed Git change.
Dependencies, receipts and local databases are under ignored worktree paths.
No canonical `.env` was copied.

| Check | Actual result | Limits |
|---|---|---|
| Toolchain | Node v22.20.0; pnpm 10.27.0 | Meets repo Node >=22.18 and pinned pnpm. Earlier survey's Node 26 was a different invocation context. |
| Frozen dependencies | `pnpm install --frozen-lockfile --store-dir ./data/core-preflight/pnpm-store`: exit 0, 720 packages | Lockfile unchanged. pnpm ignored several dependency build scripts; no blanket approve-builds or root workspace changes made. |
| Core type prerequisite | `pnpm exec tsc --noEmit -p apps/server`: exit 0 | Server and imported dependencies; not a new full native gate or web build. |
| Focused fake tests | Existing mandate, replay, world-isolation and paid-client receipt suites: **16 passed, 0 failed, 0 skipped/TODO** | Baseline prerequisite check after fresh install, not W/G conformance or new beta feature proof. |
| Local native process | Eden/Mars engine, one locally owned Soul, fake Brain, budget 0, archive off, port 4950 | Entirely separate local `eden-core-preflight` database, empty model/Privy/R2 credentials. |
| Basic authority | Own dashboard/perceive succeeded; anonymous dashboard 401; other owner 403 | Dev identities only; not production account proof or all-route authorization qualification. |
| Private accepted state | Fake ordinary standing rule accepted; unique private marker absent from world/kernel/log/scene/hot-take/durable-take HTTP responses | No assertion about prompt-by-hash, WS, MCP, every error route or all projections. Those remain required corrective/conformance work. |
| Process restart | Graceful shutdown, boot from snapshot, retained owner rule; tick advanced before stop | Tick 13 before shutdown, 14 after restart; three snapshots. Exact replay hashes are separately checked by the existing replay suite. |
| Cost | Local SQLite paid ledger: zero reservations and $0 | No paid provider/authentication pass. |
| Cleanup/ports | Own two temporary processes stopped cleanly; 4950–4959 bindable after shutdown | Availability is a point-in-time check; bind conflicts must still fail explicitly. |

Receipts in ignored `data/core-preflight/`: `typecheck.log`,
`focused-tests.log`, `eden-boot.log`, `eden-restart.log`, `http-smoke.json`.
The durable summary is this report; do not stage local databases/logs/node_modules.
SQLite's experimental Node warning appeared. Typecheck and actual SQLite boot
passed. Ignored optional dependency scripts did not block these Core checks;
browser/export/native build requirements belong to the appropriate later gates.

Focused command, run with fake mode, budget zero and empty provider credentials:

```sh
node --test --test-concurrency=1 --test-reporter=spec \
  apps/server/src/world-isolation.test.ts \
  apps/server/src/replay.test.ts \
  apps/server/src/mandate.test.ts \
  packages/brain/src/paid.test.ts
```

For a repeatable isolated process, use a fresh Core-owned directory and this
configuration. It is a setup example, not a production template. No env file is
loaded; unlisted credentials are absent through `env -i`.

```sh
env -i PATH="$PATH" \
  PORT=4950 HOST=127.0.0.1 \
  DATA_DIR=<worktrees>/core/data/core-preflight/new-local-eden \
  WORLD_KEY=eden WORLD_ID=eden-core-preflight WORLD_PATH=/w/eden \
  WORLD_OWNER_ID=dev:core-owner ENGINE=mars ENABLE_LIVING_WORLD=1 \
  BRAIN_MODE=fake BRAIN_BUDGET_USD_PER_DAY=0 ARCHIVE_TAKES=0 \
  DEV_AUTH=1 PUBLIC_URL=http://127.0.0.1:4950 INVITE_REQUIRED=1 \
  node apps/server/src/main.ts
```

Use a fresh path rather than overwriting the retained preflight database.
This starts only the explicitly invoked local process; stop that PID normally.
Core ports remain 4950–4959. No production service is involved.

## Exact ownership and baseline acceptance

I accept every proposed resolved-map row in
`<team>/RECONCILIATION-20261003.md`, with no ownership objection:

- World leads `engine/bodies/{models.ts,pose.ts}`, camera algorithms,
  `api/camera-vocab.ts` and camera-only tests. Core retains `body/model.ts`,
  physical reach/admission/locomotion, canonical observation semantics, hashes,
  take format and recorder; physical/schema changes require Core review.
- World leads LM geometry generator, visual footprints/assets and pure render
  helpers. Core integrates coupled LM `scene.json` and Mars camp `manifest.json`
  once, with World review. No independent regeneration of shared outputs.
- World leads `LiveWorld.tsx`, `WorldGeometry.ts` and world-geometry tests;
  App specifies copy/controls and uses agreed viewer hooks. Core owns upstream
  transport/replay; frozen Worker `snapshot-order.ts` remains outside pure
  visual ownership.
- App leads `auth.ts` and `skill.ts`; Core reviews authority/protocol claims.
  Core integrates `souls.ts` and `http.ts`, with App account/lifecycle/token/
  invite-policy review and explicit scoped permission for App edits.
- PM leads `mars-static.ts`, root/static/proxy/build/dependency/CI/release
  wiring. World supplies building/asset content; Core hosts the relevant route
  until extraction; App reviews URLs/human copy.
- Core leads simulation/physical packages, server persistence/steering/minds,
  REST/MCP producer/projection code and tests. App leads shell/routes/styles/
  panels/client UI; World retains 3D exclusions.
- Core/World own technical source truth; App human guides/navigation; PM
  STATUS/runbook/qualification/ops/mirror sync and integration. No strategy
  decision or mirror is independently rewritten.

I accept W-001 and G-001 baseline scope exactly as written, including the
separate corrective classification of prompt authorization. These signatures
do not certify code conformance; World/App counterpart tests and PM checkpoint
remain required. Unknown take payload types, renderScene drift and legacy
route/identity shapes cannot become stable merely through this signature.

I also explicitly accept **W-002, G-002 and G-003 scope and acceptance
obligations**, as read from PM's named proposals this session, with no scope
objection. W-002 physical/topology changes and G-002 trigger/query/Toy migration
semantics require their stated compatibility checkpoints. G-003's cue extension
does not silently change physical dance semantics; a canonical beat/controller
change is qualified/versioned through W-002. Precise types, compatibility
adapters, producer/consumer fixtures and measured tolerance remain unimplemented.
The clock/pause/tempo choice below is a routine cross-boundary detail to settle
in those first fixtures, not a request for Gene access or a startup blocker.

## Revised direction accepted, with versioned behavior

I accept the refined beta priorities attributed to Gene in the PM plan:
quality first up to $3/world/rolling real 24h; Eden as 101/playground; arid
eight-Soul Mars; reversible construction; Broadcast default; first-class
secure external-agent access; three-scale perception; reviewed Sim Score import.
No live/default cap changes here. The earlier $2 proposal is historical research,
not the latest tranche limit.

Ordinary actionable words must wake reconsideration and begin a supported safe
transition without the human learning NOW. Optional preferences remain optional.
Sleeping can wake; a climb/boat exit waits for a supported phase and reports
the delay. Preserve legacy trigger/replay decoding; this is an explicit new
intention semantics version. Five-second visible response is a proposed target
for simple supported cases, not a measured present guarantee.

Owner words accumulate with durable source/version/history, relevance and
explicitly understood strength, completion, withdrawal and conflict. A new
instruction may suspend older work without erasing it. No FIFO daily plan,
timetable or recurring execution object is introduced. Compaction retains
applicable strict constraints and commitments with source references.

## Proposed extension shapes and fixtures

The following are **illustrative design types**, not published endpoints or
implemented schemas. Core supplies eventual code/validators/producer fixtures;
World/App supply actual consumer assertions. Freeze only the small seam needed
for the next milestone after counterpart agreement.

### G: intention lifecycle and prompt response

```ts
type IntentionReceiptDraft = {
  schema: 'intent-receipt/2'; worldId: string; soulId: string;
  requestId: string; intentionId: string; intentVersion: number;
  state: 'received' | 'understood' | 'attempted' | 'started' | 'blocked' |
         'completed' | 'interrupted' | 'withdrawn';
  acceptedTick: number; eventSeq: number;
  actionIds?: string[]; relatedIntentionIds?: string[];
  reason?: { code: string; text: string; safePhase?: string };
};
```

Request identity and an accepted event associate submission, interpretation,
activity and outcome. A failed interpretation needs an explicit error receipt;
receipt states cannot imply physical completion. Owner-only history preserves
original words and their revisions. Request IDs need specified idempotency,
payload conflict and retention semantics; they are not merely logging labels.

Fixture: sleeping Soul + ordinary campfire request; immediate acknowledged
submission followed by waking/travel or a precise blocker; prior project
retained. Repeat at unsafe carry/climb/board phases. Add optional request,
contradiction, withdrawal, duplicate request, stale compilation, restart and
old-version replay cases. Measure submission → receipt → admission → first
motion separately, p50/p95; safety delays are not hidden in the average.

### G: scoped knowledge and agent authority

```ts
type ObservationDraft = {
  schema: 'observation/1'; worldId: string; soulId: string;
  scope: 'local' | 'regional' | 'atlas'; asOfTick: number;
  items: Array<{
    id: string; source: 'observed' | 'heard' | 'remembered' | 'public';
    sourceEventSeq?: number; observedTick: number;
    confidence?: number; precision: 'exact-local' | 'coarse';
    facts: Record<string, unknown>;
  }>;
  nextCursor?: string; truncated: boolean;
};
```

Filter before serialization; define caps, cursor/expiry and fact schemas before
shipping. Built-in mind and ordinary owner agent use the same perspective.
Owner-only intent/memory inspection and operator debugging are separate access
surfaces. Regional reports carry age/source rather than omniscient coordinates.
Existing public visible-world facts remain public; a scoped perceive endpoint
cannot be advertised as secrecy if raw public routes reveal the same facts.

Fixture: two distant Souls, one private marker each, a heard report and a stale
known location; compare own/local/regional/atlas, other-owner, spectator/admin,
wrong-world and revoked-agent outputs through REST/MCP/WS/history/errors and
legacy raw routes. Bound item counts and query cost; do not require a 100-actor
world to qualify the shape.

External-agent fixture: clean isolated profile → initiate pairing → actual
human Soul approval → one-use exchange → perceive/steer/await → revoke;
expiry, restart, reconnect and wrong-world negatives. Tokens stay in App's
approved secure wrapper/store; never in chat/URLs/arguments. Core owns protocol,
rates/waits/authority; App owns skill/CLI/docs/llms.txt packaging and account UI.
No new token or pairing was created during this preflight.

### W: supports, water, boats and activities

```ts
type PhysicalManifestDraft = {
  schema: 'physical-manifest/1'; worldId: string; sceneRevision: string;
  units: 'm'; up: '+Y'; appliedTick: number;
  surfaces: Array<{ id: string; sourceGeometry: string; kind: 'terrain' | 'deck' }>;
  waters: Array<{ id: string; surfaceField: string; bedField: string }>;
  slots: Array<{ id: string; entityId: string; frameId: string; capacity: number }>;
};
```

This identifies domains only; qualified geometry/field codecs, normals, bounds,
traversal, draft, flow, boarding anchors and revision hashes need concrete
fixtures. World authors simplified source geometry; Core validates canonical
integration and publishes. Mesh appearance never implicitly supplies physics.
Public takes gain optional contact/immersion/travel/occupancy/phase/effectors
with old-take defaults. Legacy whole-actor claims remain exclusive.

Fixture: Eden slope + stacked bridge/bank + calm lake/shore + dock/two seats;
walk/wade/swim/tread/exit and independent passenger boarding; seat conflict,
blocked shore/exit, cancellation, old-take decode and exact active-state restart.
World supplies the dimensions; Core can first use small deterministic authored
fixtures, replacing geometry through the agreed versioned seam later.

### W/G: one shared station cue, separate audio and physical authority

```ts
type StationCueDraft = {
  schema: 'station-cue/1'; worldId: string; epoch: string; cueId: string;
  scoreRevision: string; catalogRevision: string; pieceId: string; seed: string;
  startRealMs: number; transitionRealMs?: number;
  sourceTick: number; effectiveTick: number; compositionCheckpoint: string;
  publicSituation: { kind: string; aggregateEnergy: number };
  beat: { originTick: number; periodTicks: number; meter: number };
};
```

The sketch requires an agreed clock model and sufficient score state for bounded
seeking; a seed alone is insufficient. Core announces one shared public selection;
App owns the deterministic selection policy/audio module and supplies a reviewed
pure selector/cue proposal, not independent per-browser random choice. Pinned
score/catalog/selector provenance precedes import. Physical dance reads the
logged tick/phase bridge; it must never depend on a browser transport or a new
wall-clock read during replay.

Open seam to settle: whether station pauses/rate changes follow world pause/rate,
and how a new cue maps server real time to canonical dance ticks. Qualify fixed
tempo/short segments first; a tempo transition needs a versioned phase segment,
not an in-place reinterpretation of past beats. App owns note timing, late join,
drift correction, gesture start/mute and transport disposal. World consumes
public beat/attention only. Private intentions never tune the public station.

Fixture: two staggered listeners, restart/reconnect/tab suspension, world switch,
planned segue, pause/rate and old-cue rejection; same events/phase within an
explicit measured tolerance. Compare a dancing actor's admitted phase at those
ticks. Exact audio waveform equality across hardware is not required. Core can
use a synthetic fixed cue until App delivers a reviewed immutable score subset;
no edits/import from the active `<sim-score-repo>` working tree now.

### Mars upgrade, dismantling and Toy migration

Mars cast/material binding must use stable IDs rather than sorted indices.
An idempotent logged scene/cast upgrade preserves the four current Souls,
intentions/history/components and creates only qualified human-owned additions.
App/Gene define admission/assignment policy; Core does not invent it. Test a
partially applied upgrade, retry, restart and replay before persistent rollout.

Dismantle fixtures cover occupied/dependent floors, supported loads, reservations,
installed versus recoverable parts, cut-board conservation and altered rebuild.
Every commissioned constructible assembly gets a qualified reverse path;
lowering one frame alone is not general deconstruction. No economy is designed.

Toy retirement needs an inventory of root aliases, tokens, bootstrap, checks,
archive scripts, public nav and units. Preserve archive/private deterministic
fixtures; rescue useful recipes as qualified Eden behavior, never copy Toy DB
or abstract poses into native state. Old aliases must explicitly retire/version
rather than silently route Toy credentials to Eden. PM handles archive/service/
release migration; App nav/default links; Core compatibility/identity/events.

## First milestone, dependencies and cadence

First independent implementation milestone, **only after commissioning**:
local owner-prompt failing fixture and minimally reviewed access correction,
code W/G baseline documents/types and Core producer/privacy fixtures. Then
ordinary-language receipt/reconsideration + retained intention lifecycle on a
small campfire/rest fixture, preserving legacy event decoding. These do not
wait for terrain art, audio catalog or extra bodies.

Planning forecast: baseline privacy/contracts approximately 2–3 focused working
days; first responsive retained-intention slice another 3–5, subject to exact
semantics/tests and App policy review. The broader physical/memory program is
several subsequent tranches. Revised early scope includes stable eight-Soul Mars
upgrade and reversible catalog coverage; it cannot be folded into the previous
two-week calm-water aspiration without qualification. Reforecast after the first
intention slice and the concrete Mars/Eden geometry/catalog inventory.

Upstream dependencies: App permission/admission/receipt policy and actual G
consumer tests; World W consumer agreement and stable support/shore/dock/Mars
fixtures; App immutable score/selector/seek handoff; PM root dependencies,
checkpoint/merge/release and Toy archive plan. Until they arrive, Core continues
local privacy/replay/intention fixtures, deterministic physical fixtures and
recorded-context model evaluation design. No other trunk is a startup blocker.

I can do sustained work in this chat while a turn is active. This completed
preflight does not itself create a continuing goal or scheduled wake; after it
ends, explicit commissioning/new input or a requested goal/schedule is needed
for unattended continuation. PM's own schedules do not wake Core. No new
background automation is created. Once commissioned: update LOG at least every
2–3 active hours, compact PM bundles around 10:00/18:00 Eastern, immediate
blocker notices, small topic commits and PM-only integration/release.

## Access and outstanding gates

No Gene access is needed for fake local startup. Jev and Anthropic key presence
is configured in canonical `.env`; absent in this process and never copied or
printed. No new authentication/paid pass. OpenAI/Gemini keys are absent in the
checked envs; optional comparisons need approved account/model access later.
Real two-owner Privy identities are a later live journey gate, not a fake fixture
prerequisite. Production archive credentials and release authority belong to PM.

The $3 change must cover **config.ts, Brain setter, admin route and durable
Db.reserveCost**; the database's independent $1 clamp is easy to miss. Validate
finite inputs, exact rolling boundary, restarts, unsettled holds, retries/model
pricing and zero-budget continuation. Protocol currently admits budget values
through 100, so make intended request/clamp/receipt semantics consistent.
Do not relax pre-contact bounds or set default $3 merely to claim readiness.

Blocking sustained feature start: PM's final pairwise checkpoint and explicit
commission. Blocking merge/release: Gene's handover and exact candidate gates.
Neither is a technical startup failure. No full W/G conformance, new semantics,
water/boat support, score sync, eight-Soul upgrade, deconstruction or Toy
retirement is claimed complete by this preflight.
