# Tabletop chess — bounded pursuit, focused physical draft

Mars MVP requires a two-player chess game at a usable table, not a decorative board.
Authentic activity family: Mars archive public2026 recap lists chess workshops
(`docs/substack/posts/2026-05-18-recap-of-mars-2026.md`,149). Participants, board,
arrangement and proposed game are hypothetical; no historical match is reconstructed.

## Small supported physical interaction

Use existing `take_item`, `put_item`, hand holders and surface slots for real pieces.
Both people approach a real supported board/table and take independent turns. Prefer
standing tabletop play for the first supported arrangement: existing transfers
explicitly stand before taking/placing, so claiming seated chess would be false.
No new rig, finger motion, general seated manipulation or bespoke anatomy layer.
Measure feasibility using the existing admission path before commissioning rendering.
If this is visibly unconvincing or exposes repeated anatomy work, escalate/narrow
explicitly rather than silently replacing it with UI-only piece movement.

Pure board rules choose legal moves without moving world entities. A physical
coordinator binds piece IDs and destination slots, commits a turn only after real
placement, and retains partial intentions through interruption. Capture removes the
same captured piece to an explicit tray; no deletion/spawned replacement. Hard
support/ownership/claims and collision admission remain authoritative. Actor control
uses ordinary children only. Physical failure retains coherent placed/held state and
explains which resource/placement must be resolved; no forced completion/teleport.

## Acceptance and boundaries

Two orientations; valid/invalid chess moves; alternating commitments; illegal moves
leave world/rules unchanged; capture identity/support; same-piece pickup/place
continuity; player intervention; unavailable/moved board; blocked route; interruption
and explicit resumption/cleanup; deterministic repetition; quiescent persistence
where implemented, explicit active restoration limitation. Actual Play and personally
inspected captures before integration, then clean full combined gate/public proof.

Begin with small pure rules and a feasibility fixture. Legal chess rules and physical
execution must stay separate so Eden can reuse them. Do not build a strong chess AI,
arbitrary table planner, new seated-IK machinery or universal game framework.
Root owns this independent worktree, serial/light while music's immutable gate uses
GPU and historical owner uses allthree shared helpers. Music30 is verified online; this independent chess draft is not exposed or released.
