# D4 / LM-100: exact rafter spacing for sheet support

Branch `codex/rafter-span`, base `6c55285`, reused the free `raise-cancel` checkout after all prior commits were preserved on `codex/raise-cancel`. No historical content changes.

Inspection clarified the ledger's older description: rafters already enter `sheetSupports` because `isJoist` accepts catalog `2x4-*` definitions. They therefore received the generic 24 in + 10 mm joist allowance, while the exact `RAFTER_SPACING_MAX` was unused. The support analyzer now recognizes bearing rafters through catalog `framingRole` and applies the existing exact 24 in limit whenever a sheet rests on rafters, including mixed rafter/joist support. Only 1e-9 m numeric tolerance is allowed for rotated layouts. Rafter diagnostics print four decimal places so 0.6146 m versus the 0.6096 m limit stays visible rather than both rounding to 0.61 m. Ordinary joist and reconstruction-frame beam rules retain their existing values and behavior. No new sloped-sheet geometry is claimed.

Validation: `rafter-span.test.ts` **5 passed, 0 failed/skipped/TODO** (123 ms): exact 24 in accepted; +5 mm and +100 mm refused with `plywood.span` naming sheet and both supports; axis-aligned and 45° layouts; mixed rafter/joist layouts; rejected `install_plywood` leaves world and resource owners unchanged; ordinary-joist allowance control remains accepted. Fixtures are hypothetical supported flat rafters on installed plates/uprights; this is support-validation evidence, not a newly sequenced roof-build claim. Lint/typecheck clean; source scan passed. Heavy engine/browser/pin suites deferred while the lead's release gate owns the host; no full-gate claim made.

The implementing agent inspected all 13 records in `rafter-span.capture.json`: four exact-boundary acceptances, eight named atomic refusals, and the ordinary-joist control. Reproduce from `viewer/`:

```sh
MARS_RAFTER_SPAN_CAPTURE=../docs/engineering/briefs/rafter-span.capture.json node --experimental-strip-types --test engine/test/rafter-span.test.ts
```

LM-089 remains dependent on LM-070 (wave2 F1). It is not honestly a constants-only change: liftcrew horizontal 1.0 m/apex 2.4 m differ from BODY_MODEL 0.8 m/2.06 m, while FOLLOW_KEEP 0.9 m and fallback 0.85 m already exceed that body cap. Copying the legacy limits into BODY_MODEL would conceal the physical mismatch; replacing them requires coordinated body/station behavior and outcome verification. This brief does not change those limits or claim LM-089 fixed.

No pins, thresholds, deployments, merge, remotes or pushes. Approximate worker effort: 6k tokens / 12 minutes, no helpers. Lead owns final rebase, integrated gate and counts.
