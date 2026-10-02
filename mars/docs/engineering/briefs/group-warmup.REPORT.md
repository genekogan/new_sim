# Bounded guided standing warm-up

Implemented on `codex/group-warmup`, from `a509b65`, isolated at
`<mars-worktrees>/group-warmup`. Only four new owned files changed.
Shared registry, types, renderer, cameras, Lab and browser proof remain root-owned.

The experience walks an instructor and independently scheduled followers to clear
flat ground, then follows a continuous settle → raise → open → lower cycle. Each
follower has a bounded lag; support and root position remain planted after ordinary
arrival. Existing engine hand points drive current rigs. Joining, leaving, directed
walking, Pause, explicit same-runtime Resume and End release hands safely before
releasing actor/floor resources. Leave releases in place; an ordinary walk directive
then departs. No automatic departure/teleport or new anatomy/physics is introduced.

## API

- `GROUP_WARMUP_ACTIONS`: `group_warmup`, `warmup_participant`,
  `group_warmup_control` for common registry registration.
- `GroupWarmupParams`: `{instructor:{actor,at,face}, followers:[{actor,at,face,
  join?,joinAfter?,lag?}], phaseDuration, cycles, resumeFrom?}`. Duration is required,
  1–10 seconds/phase, 1–5 cycles. 1–5 followers; guide is separate. `joinAfter` is
  instructor-clock time (0–30 seconds), `lag` is 0–2 seconds. No rigid actor labels
  in activities. The example uses guide + four generic followers.
- `group_warmup_control`: `{warmup,command:'join'|'leave'|'pause'|'end',actor?}`.
  Actor is required for follower Join/Leave. End sets retained `ended:true` and
  cancels safely; natural duration completes. Pause/cancel permits unchanged-binding
  Resume via a new `group_warmup` with `resumeFrom`. Changed bindings and ended
  originals are refused. Withdrawn followers stay withdrawn across Resume;
  manually invited followers retain invitation.
- `readGroupWarmup(rt,id)` / `latestGroupWarmup(rt)`: detached actual lifecycle,
  clock/timing/bindings and participant role, actual state/child, withdrawal,
  local timing, actual hands, attention and child diagnostics.
- `groupWarmupAttention(rt,id)`: detached active planted follower → instructor
  actual position map for renderer/camera observation. No world authority.
- `groupWarmupBinding(yaw)` / `groupWarmupRuntime(yaw)` example factory supports
  rotated layouts and registers only missing new actions via `createRegistry(extra)`.

Floor admission refuses named obstacles/edges, unsupported/riding/seated floor,
occupied places, overlapping reserved arm envelopes, busy actors, held items and
unreachable ordinary routes. Per-tick planted checks stop safely on changed floor
conditions. A failing follower has a named child diagnostic and withdraws; a failing
instructor stops the session. Active graph snapshot restoration remains explicitly
unsupported; same-runtime Resume only. Late arrival may miss early phases by design.

## Verification

`node --test engine/test/group-warmup.test.ts engine/test/source-scan.test.ts`:
18/18 passed (17 warm-up cases and source scanner), zero skip/TODO. All successful
physical scenarios check zero runtime violations throughout. Coverage includes
four independently arriving/phased followers in two orientations, planted roots,
body reach bounds, per-tick hand continuity, late Join/Leave, directed follower
walking, instructor preemption and resumed completion, safe cancellation during
arrival and every phase, Pause/Resume retained progress/withdrawal, explicit End
versus natural completion, named infeasible cases, detached readout and deterministic
world/record/readout replay. Focused oxlint and `npm run typecheck` pass.

No browser, performance or full combined gate was run in this isolated task;
serialized actual Play captures and shared renderer/UI integration are required
before claiming the tranche shipped.

## Provenance and scope

Source read: `~/Mars/docs/archive/events/bombay-neighbour-yoga-2021.md`.
It explicitly describes neighbouring permanent Bombay Beach residents' yoga,
relayed into Mars Discord, not Mars-organized yoga. This is a hypothetical standing
warm-up inspired by wellness practice, not a reconstruction of that historical
activity or those people. No advanced yoga, single-leg balancing, prone/ground
contortions, rig migration, save/load or real identities are claimed.
