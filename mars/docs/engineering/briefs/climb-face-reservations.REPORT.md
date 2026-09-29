# LM-022 — mutual exclusion for a column face

Branch `codex/climb-face-reservations`, base integrated `61cd7cc` (`codex/studio-integration`). Changes: `engine/construction/frame.ts`, `framemove.ts`, new `engine/test/climb-reservation.test.ts`, `docs/engineering/HANDUP.md`, this report. No historical content or pin edits.

## Mechanism

`climbFaceResource` derives an exclusive resource from the existing generated link: upright id, column (`l`/`r`), and approach face in upright-local Z. Seat height is omitted; opposite faces remain distinct. Nothing is added to the world, link schema, path or spatial hash. `climb_frame` reserves this resource beside its actor through the Runtime's existing admission/release mechanism. Conflicting actions fail before approach with named `reservation.conflict`; callers may retry after the holder completes. The existing per-link occupancy check remains.

The reservation covers approach, ascent/descent and step-off. Safe cancellation and completion release it. A mid-climb unsafe cancellation keeps the holder's reservation. Runtime state/pin changes are not expected; pinned suites remain lead-owned in the serialized combined gate.

## Tests and inspected capture

- `node --test engine/test/climb-reservation.test.ts engine/test/frame.test.ts engine/test/handup.test.ts`: **18 pass / 0 fail / 0 skip/todo**, 0.96 seconds.
- Final expanded `node --test viewer/engine/test/climb-reservation.test.ts`: **3 pass / 0 fail / 0 skip/todo**, 0.23 seconds. The second test additionally checks unsafe cancellation and upward-vs-downward conflicts.
- `npx tsc --noEmit -p .`: **PASS**.
- `git diff --check`: **PASS**.
- No full engine suite launched during the lead's gate; combined gate must verify all unchanged pins before merge.

Regression cases: higher and lower links sharing the face; failed admission leaves the second actor untouched and unreserved; independent column admitted; safe cancellation; unsafe cancellation retains lock; completion releases lock; ascending/descending share a resource; missing link claims nothing; opposite physical faces yield distinct keys.

Inspected capture `/tmp/climb-face-reservations-capture.log`:

```json
{"resource":"climb-face:A:l:z+","holder":"a1","refusedLink":"climb:A:l@0.46","refused":{"code":"reservation.conflict","message":"climb-face:A:l:z+ is already reserved by action a1 (climb_frame, executing)","subjects":["A:l:z+"],"details":{"resource":"climb-face:A:l:z+","holder":"a1"}},"independentLink":"climb:A:r@1.83","independentStatus":"executing","secondActorUnchanged":true}
```

This is a nonvisual reservation correctness change; no renderer behavior or screenshot claim. The lead approved diagnostic JSON capture for this task. HANDUP now documents the face reservation and removes the resolved caveat without removing the remaining beam/column limitations. No new body/path collision claim is made (LM-032 remains separate).

Approximate effort: 5k tokens / 10–15 minutes, no helpers. No runtime test processes remain running.
