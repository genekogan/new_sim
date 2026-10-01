# Tabletop chess — focused draft, not released

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

Lab controls/tour/selector and procedural checkerboard/distincttokens are now saved
drafts, not exposed online or visually accepted. Choices include all supported legal
turns with optional initial four-turn checkmate proposals, not fixed runtime playback.
Both players face the board initially; read-only sharedgaze observes only explicitly
bound boards and releases anyone with foreigncontrol. No worldscan/alternatemover.
No actual Play capture, fullgate or publishedproof yet; do not call this playable.
Blocked/unavailable/tilted/movedsupport/capabilitymismatch disruptions, deterministic
repeat, quiescentJSON board/capture persistence and active-snapshot unsafe-drop
refusal execute. Proceduralmeshes stay inside catalogbounds and share resources.
Two required browser cases are authored (not yet run): freshReset/Step, actualPlay
fourturns/checkmate, samepawninhand, interruption/restoration, alternativecapture,
32stableIDs and exactresourcecounts through3Reset. Historical fullgate currently
owns serialized browser capacity; root intentionally holds runtimevalidation.
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
