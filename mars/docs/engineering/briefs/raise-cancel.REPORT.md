# LM-036: supported mid-raise cancellation

Branch `codex/raise-cancel`, base `8decb07`. Implemented safe lowering along the actual physical raise choreography, beginning at pickup rather than rewinding gathering/walking. Cancellation preflights the full reverse path, then revalidates every fixed-tick segment against current static geometry, bystanders, and floor support. Unsafe requests return `raise.cancel-unsafe` without changing poses, support or ownership. An obstruction appearing later blocks lowering with the frame still held; removing it permits completion. Holders retain current task/resource ownership throughout, and release only after the original lying footprint is supported on ground.

The trail records frame/holder poses and grips (never old whole-human/task state), including any physical changes before a blocked return. Its deterministic 1024-frame bound never truncates: overflow refuses cancellation while allowing the original raise to finish. Current catalog/crew combinations require fewer than 400 moving ticks (19 ft height / 0.6 m/s, 5 s rotation, <2.3 m step-around / 0.6 m/s, at 20 Hz plus phase boundaries); all 16 actual combinations peak at 282 frames / 150966 serialized bytes. Normal action steps remain identical in physical/event/take outcome to base `8decb07`; no pins changed.

Only the lowering phase becomes snapshot-resumable. Other raise phases retain the named non-resumable refusal. A four-person 19 ft lowering snapshot is 111242 bytes; restore preserves IDs, trail index, ownership, held support, every subsequent state hash and events. Runtime cancellation now clears a stale refusal diagnostic when a later retry succeeds; the refuse/remove-obstruction/retry regression exercises that actual transition.

## Validation

- Focused construction/progressive/raise-cancel/resume/source-scan suite: **42 passed, 0 failed, 0 skipped, 0 TODO** (9.3 s), before the small stale-diagnostic retry fix and proof fixture additions.
- Final lowering/retry/snapshot/normal-compatibility/bounds/floor checks: **11 passed** (3.5 s). Added fixture test initially failed solely on diagnostic regex capitalization; corrected test then independently **1 passed, 0 failed/skipped/TODO**. All 12 cases pass across these runs. The lead owns the subsequent combined gate.
- Final `npm run lint` and `npm run typecheck`: clean.
- Isolated browser port5593: safe lowering case **1 passed** (3.5 s) after fixing active unlisted scenario label; cluttered build-bay refusal **1 passed** (4.2 s). No console errors; no violations. No full browser suite run by this worker.
- Normal compatibility: all 16 catalog/allowed-crew cases match baseline world, event and full-take hashes exactly; zero violations. `raise-cancel.normal-baseline.json` is a focused compatibility fixture, not a production pin change.
- Informational action-step profiling (one warmup, three alternating passes of 16 cases / 6635 action calls each): baseline **2.15–2.51 µs/step**, current **6.38–6.89 µs/step**. Roughly 4.2 µs added per call on this host, with bounded per-action trail storage. No timing threshold changed. Raw result: `raise-cancel.cost.json`.

## Captures and reproduction

The implementing agent inspected all state records and all three rendered images. [Proof gallery](raise-cancel-proof/index.html) shows hands maintaining contact during lowering, the frame resting flat on ground after release, and an unsafe cluttered build-bay request retaining its held frame. Nearby low staged beam `b2` blocks the footer's reverse path under the conservative body guard. This is an honest refusal, not a reason to weaken collision policy.

`raise-cancel-proof` is an explicitly selected, labeled **hypothetical** fixture accessible only by exact name/URL. It is not added to `SCENARIOS` or the standard probe/preset enumeration. Resolution and unknown-name refusal are tested. The active unlisted fixture gets its own select label; ordinary scenario options stay unchanged. The lab hook's `cancelAction` calls the real runtime and notifies the renderer, with no pose mutation shortcut.

From `viewer/`:

```sh
MARS_RAISE_CANCEL_CAPTURE=../docs/engineering/briefs/raise-cancel.capture.json node --experimental-strip-types --test engine/test/raise-cancel.test.ts
E2E_VITE_PORT=5593 E2E_RUN=raise-cancel npm run e2e -- raise-cancel.spec.ts --workers=1
```

Browser output is in `viewer/e2e/artifacts/raise-cancel/`; the inspected proof copy is in `briefs/raise-cancel-proof/`. Node capture contains tick/phase/poses/support, reservation ownership, refusal subjects, final lying state/zero violations, snapshot size and normal compatibility summary. Profiling used `normalRaiseProof` with `action.step` wrapped in `performance.now()` accumulation, importing the unchanged baseline action from the integration checkout (verified `git diff 8decb07 -- viewer/engine/construction/raise.ts` empty), then the current action, three alternating measured passes after warmup.

No history/content edits, state/tick pin changes, merge, deployment, dependency installs, remote or push. Scope remains LM-036; other construction-phase persistence is intentionally not claimed. Approximate incremental worker effort: 35k tokens / 65 minutes, including design, safety tests, captures and review; no child agents. Full gate remains lead-owned.
