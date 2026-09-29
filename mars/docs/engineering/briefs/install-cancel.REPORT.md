# LM-038 — install cancellation safety

Five per-verb regression tests exercise `connect_beam`, `install_joist`, `install_plywood`, `install_stair_flight`, and `install_tread` through the existing real construction fixtures. Each first accepts a pre-lift cancel and releases ownership. It then restarts, waits for measurable physical displacement, refuses cancellation twice with the verb's named `*.cancel-unsafe` diagnostic, and finishes the same action.

The four lifting parts are more than 5 cm above their initial support when cancelled. The stair flight intentionally follows the existing ground-level carried translation (`liftOver: false`); that case cancels after more than 5 cm horizontal movement and checks unchanged floor contact. It is not claimed as airborne-flight coverage.

Assertions inspect the complete world before/after refusal, held support and each crew grip, every declared reservation via Runtime.holder, inability of a competing walk to steal a holder, installed support/connections after completion, released tasks/grips/resources, and zero invariant violations throughout. The successful pre-lift control protects against an always-refuse regression. No production changes were needed and no existing simulation outcome/pin changed.

Validation: five new targeted cases pass, 0 fail/skip/TODO. Full construction/progressive files plus source-scan and lint/typecheck are recorded below. No full gate, deployment, generated takes, or historical content changed. Lead owns the integrated gate/evidence ledger. Approximate worker cost: 15 minutes / 7k tokens.

`node --experimental-strip-types --test engine/test/construction.test.ts engine/test/progressive.test.ts engine/test/source-scan.test.ts`: 30 pass / 0 fail / 0 skip / 0 TODO (11 s). Lint with `--max-warnings=0` and `npx tsc --noEmit -p .` clean. The only follow-up after the test run re-read support from the mutable world to avoid TypeScript retaining a pre-step assertion's `held` narrowing; runtime behavior is identical.

Inspected capture: `install-cancel.capture.json` contains all five actual cases. Before/after poses and held support are identical; owners persist across refusal and are empty at completion; final support is connected/resting-on; every violations array is empty. Beam/joist/plywood/tread sampled heights are 0.05035/0.05263/0.07599/0.05052 m; stair stays y=0 while translated to x=4.94201. Reproduce from viewer:

```sh
MARS_INSTALL_CANCEL_CAPTURE=../docs/engineering/briefs/install-cancel.capture.json node --experimental-strip-types --test --test-concurrency=1 --test-name-pattern=LM-038 engine/test/construction.test.ts engine/test/progressive.test.ts
```

Opt-in capture writes only when requested; serialized files prevent competing writers. Capture run: 5 pass/0 fail/0 skip/0 TODO; lint/typecheck clean.
