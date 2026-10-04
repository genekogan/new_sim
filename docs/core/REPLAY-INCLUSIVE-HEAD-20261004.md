# Explicit replay of accepted inputs at the head tick

`replayFromGenesis(..., untilTick, {includeHeadEvents:true})` folds canonical
events accepted at that tick in sequence order without advancing past it.
The legacy default remains exclusive, as recorded in COMPILE-FENCE-20261004.md.
No default bootstrap/caller, log, snapshot or historical repair changes.

Actual native walking-retirement qualification initially failed the pure replay
hash while WorldHost restart matched: retirement and its terminal checkpoint at
the final tick were omitted by the legacy helper. The explicit mode restores the
native hash; the test retains the actual cleanup and kernel comparisons.

Focused Toy head proof covers tick0 birth, later retirement, sequence order,
unchanged legacy omission, no extra step and exclusion of future-tick input.
The first future assertion queued that input before advancing the host, so it
correctly occurred at the earlier tick; the harness was corrected to enqueue
after the advance. Final head plus existing replay-regressions8/8 PASS; initial
native failure and harness correction are retained, not claimed prior success.
Local model-free/$0. Full historical recovery/capacity claims remain unchanged.
