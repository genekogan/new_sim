# Pile continuity — PILE-01

Bounded renderer candidate from main9b2cc83, local branch `codex/pile-continuity`.

The visible upright stock pile used the catalog blue while the extracted upright
used the already established photo-derived renderer green. `FixtureViews.fillStack`
now applies `rendererColor` to the pile's existing piece definition, matching
`ComponentViews.build`. No historical data, catalog colours or palette values change.
Ownership: `viewer/app/engine-view/fixtures.ts`, new
`viewer/e2e/pile-continuity.spec.ts`, this report. Core construction and year-build
sequencing remain root/stance-worker owned.

## Identity and physical audit

The pile is one fixture with count/fraction inventory, not individual entity IDs.
`campus/sequence.ts` selects a matching nonempty pile, creates a
`take_from_bundle` step for the canonical target frame id, and passes that same id
to `carry`, `raise_upright`, `hold_frame` and `let_go`. The next extraction waits
for the preceding carry to clear its take-out spot.

`construction/bundle.ts` creates the component only when the 4-second pull finishes:
its def is `BUNDLES[pile.def].piece`, its phase is stored, support is ground, and
provenance records the source pile. That same tick decrements count (or removes
empty fixture). The pull motion is explicitly unanimated; this explains the new
component appearing on the adjacent ground. The renderer does not substitute a
second object or assign support. A continuous pull trajectory would require an
explicit authoritative construction change and is outside this renderer repair.

The aggregate uses simplified horizontal columns/crossbars; the extracted kit
upright uses diagonal bracing inside the same catalog dimensions. It also has
different existing surface roughness/metalness. This candidate aligns the
palette lookup only; it does not claim identical fine geometry or shading, or
per-piece identity before extraction.

The palette disagreement is confirmed by code. Whether the full public journey
also has support/stance defects is root's reproduction and worker's scope; this
report does not claim those resolved by matching colour.

## Validation

Focused regression covers pile/component materials for rack stack defs,
count reduction, aggregate removal, persistent component mesh/material through
phases, renderer nonmutation, and invalid missing-stock/reused-id/occupied-owner
requests. Live first east-house extraction, using the explicit supported pre-W51 source, checks the same target id absent before
taking, stored+ground after, pile count reduced by one, then same id carried+held.
Five real screenshots capture stock, extraction, lift, supported build-bay stock and installed frame without changing baselines.

The historical route mock reads exact commit
`a0c347e0374b473876c97f536dc44dba42399521:viewer/public/engine/campus-2022.json`
and asserts SHA256
`205d20234f72a5a05da8252262b9b57488080c70727c20a00b6daf08162d6d93`.
This is supported historical-source mechanics proof, not current reconciled
2022-house acceptance. Root’s integrated current-house preflight refuses its
9 blocked beams before any build. The supported build-bay starts with individual
stored components, so its actual A frame stored → held → installed+connected
proof does not claim aggregate unbundling.

Validation at root-authorized HEAVY_SLOT: app TypeScript clean; focused
`engine/test/year-stock.test.ts`: 2 pass / 0 fail / 1 existing TODO.
Focused Playwright final result and artifact inspection recorded below.
No full engine suite, release gate or deployment run: root owns the combined gate.

Final focused Playwright: **4/4 pass**, 10.0 s, run
`codex-pile-continuity-5` on port5491. Personally inspected the five captures;
the stock palette matches the extracted frame, the lift retains that frame,
and supported build-bay installation retains A with connected support.
Artifacts (ignored, never committed):
`viewer/e2e/artifacts/codex-pile-continuity-5/` with five PNGs and two JSON reports.
Root must inspect these captures before integration. The report’s field data
records exact source provenance and component phases/support.

The palette candidate does not resolve continuous physical pull animation,
simplified aggregate bracing/shading or the current reconciled house’s blocked
construction. Those are explicitly retained limitations, not completion claims.
