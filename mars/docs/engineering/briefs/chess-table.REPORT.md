# Tabletop chess — release32 verified

Root serial worktree `codex/chess-table-mvp`; no helper or camera/anatomy expansion.
Pure bounded board rules are separate from actual ordinary take/put execution.
Two standing players, a supported table/board and32real tokens use stable IDs.
No piece spawns/deletions/pose overrides. Capture keeps the same opponent token in
an actual supported tray. Turn commits only after placement. Parent hierarchical
claims retain tokens, table/board/tray and rollback locations across children.

## Executed focused proof

25/25PASS:6rules,16physical,1source-scan,2renderer/attention checks; TSc/scopedlint clean. Two orientations,
fullopening20legalmoves, invalid/blocked-ray/king exposure refusals, checkmate/
stalemate, captureidentity/support, four actual physical turns to checkmate,
controlled playerhandoff, interruptedcapture/en-passant rollback, cross-child
reservation/refusal and failed-child explicitrestoration all execute.

Failures preserved in ignored `.cloudflare/chess/`:
- first physical direction remained active because wrapper lacked controlledhandoff;
  then directwalk conflicted during deferredcleanup. Existing yieldTo/onDirective
  nowqueues the directive until physicalpiece return; no Runtimecore change.
- active restore refusal initially cancelled the original move through onDirective
  before normaladmission. Same-verb requests now leave the ownedtransfer intact;
  negative active/absent restore cases remain strict and pass.
- original pure pawn test incorrectly assumed a pawn attacked directly ahead;
  corrected its fixture expectation and added illegal two-square king coverage.
No existing project test, tolerance, pin, baseline or expectedoutcome was weakened.

Terminal failedtransfers retain named `chess.cleanup-required` and pendingphysical
state. Explicit `chess_move` with `restore:true` restores the exact original player,
move, board/tray and originalturn via ordinary transfers. Foreignownership,
wrongbinding/active/missingpending/unrelatedheldobjects refuse; restoration commits
no turn and never erases completed effects. Normal cancellation restores or keeps
an alreadyplaced completed effect. Physicalen-passant cleanup uses the captured
square rather than its empty destination. No resourcelease is left after completion.

## Remaining acceptance / honest scope

Lab controls/tour/selector and procedural checkerboard/distinct tokens are online
in verified release32. Choices include all supported legal
turns with optional initial four-turn checkmate proposals, not fixed runtime playback.
Both players face the board initially; read-only sharedgaze observes only explicitly
bound boards and releases anyone with foreigncontrol. No worldscan/alternatemover.
Focused actual Play, full combined gate and published proof are recorded below.
Blocked/unavailable/tilted/movedsupport/capabilitymismatch disruptions, deterministic
repeat, quiescentJSON board/capture persistence and active-snapshot unsafe-drop
refusal execute. Proceduralmeshes stay inside catalogbounds and share resources.
Two required browser cases execute: freshReset/Step, actualPlay
fourturns/checkmate, samepawninhand, interruption/restoration, alternativecapture,
32stableIDs and exactresourcecounts through3Reset.
Standingtabletop only: existing transfers stand; no claim of seatedchess or finger
precision. No strongAI/universalgamesystem. Castling is explicitly unsupported;
pure queenpromotion is legal but physicalpromotion explicitlyrefuses rather than
morphing/spawning replacement. Threefold/fiftymove/clock/resignation adjudication
is deferred and must be stated in exposedscope. This is a hypothetical staging of
an authentic chess activity family, not reconstruction of a historical match.


Global shared registry now registers `chess_move` with activities/14. Snapshot test
was corrected to use the global registry once (the intermediate duplicate extra
registration RED is preserved); no assertion weakened. Appearance/gameToken
capabilities separate color/role semantics from mesh identity. Unsupported unrelated
props refuse before acquisition. Current rig/item adapters remain unchanged.

## Actual runtime review, 2026-10-01

Frozen clean361a636, rebased on reviewed historical6451794: two required browser
cases PASS in34.1s (16.8s and15.9s), alternate ports5395/8915, actual UI Play.
`viewer/.cloudflare/chess/actual-play-first.log` retains the run;
`viewer/e2e/artifacts/chess-runtime-first/` contains five inspected PNGs and
`chess-reset-resources.json`. Same pawn ownership is observed during transfer;
four turns finish checkmate, cancellation physically restores the original pawn,
and alternative e2-e4/d7-d5/e4-d5 retains the captured black token in the tray.
All32 identities remain stable, zero invariant violations, exact51 geometries and
26 textures after each of three resets. Browser/Vite processes closed afterward.

Root inspected all five captures and the contact sheet: recognizable board/pieces,
standing players oriented toward the board, supported capture tray and coherent
completed positions. The first grasp image partly occludes the acting right hand
behind the player/board; it does not establish finger contact or full arm clearance.
The existing take/put adapter drives that hand; the visible hanging opposite arm
is not evidence of a second authority or a new pose system. A read-only bone/held
item JSON attachment is added for the next required run to make this angle easier
to assess. No rig, anatomy solver or physical execution changes are justified by
this capture alone. This dated first-run candidate status is superseded by the
combined acceptance and publication below.

## Combined acceptance and publication — release32

Clean functional084f492, based reviewed historical6451794, passed the established
full gate:243unit,941engine/0fail/6skip/11TODO,154browser/0fail/7skip, bothTSc,
zero-warning lint, unchanged flagship take/b746probe and all36localMCP. Original
idle-performance limits/pins passed. Current2022firstbay/wholehouse completion
checks executed and passed; originalW51FIXMEs remain excluded. Missing ignored
CAD cache caused the first gate to fail4unitchecks before later phases; originalRED
is retained and resolved with SHA-verified frozen31cache, no source/assertion change.

Published100% c24b42b3-ff1f-4eea-8965-86c3ab4eb080 at2026-10-01T15:59:41.295Z,
rollback31actual8f794aad. Public2/2PASS34.2s; fivePNGcaptures personally inspected,
3resets51geometries/26texturesexact. Readonly held-pawn pose records acting right
palm at requested target/error0/contact1 and matching rendered token grip; hanging
leftarm is untargeted. Acting hand is partly occluded by board/torso in this view;
no finger/skin guarantee or rig redesign. 507assets/19routes/649curlrequests and
exact computer/credit SHA/range/auth, public36MCP and director9steps15042ms pass.
NativeNodeHTTP not rerun; curl equivalent compression assertions retained. No new
sampled-tail/resource-attribution claim. Meal preparation/sleep drafts excluded.

Evidence: release32worktree viewer/.cloudflare/{release32-network-receipt.json,
browser-release32.log,mcp-release32.log,director-release32.log,curl-32-ae/receipt.json},
viewer/e2e/artifacts/release32-production; source chess-table-mvp gate
2026-10-01T15-05-45-762Z. Earlier accidental local director invocation and no-tests
filename error were corrected at invocation only; public two-case proof is explicit.
