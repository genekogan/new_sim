# Static/entity identifier namespace follow-up

Adversarial review reproduced an asymmetric collision: static_add followed by spawn with the same ID succeeded, while reversing those edits refused. Spawn now checks the effective static obstacle/surface/link namespace and returns `edit.id-taken` before modifying the fork.

Regression covers both static/spawn orderings with unchanged workspace head on refusal; base obstacle, surface and link IDs; an earlier static removal rolled back when a later surface/link collision fails; and legal reuse after static removal, including entity removal followed by static re-add. Existing scene entities are not retroactively rejected and move/remove keep their existing semantics.

Validation: focused static-edit tests 6 pass/0 fail/0 skip/0 TODO; lint zero and TypeScript clean. `node --experimental-strip-types --test --test-name-pattern='edit|spawn' engine/test/api.test.ts engine/test/edit-static.test.ts`: 10 pass/0 fail/0 skip/0 TODO, including existing spawn/move/remove and vehicle edits. No full gate, browser, deployment, pins, or historical changes. Lead owns integrated validation. Approximate work 8 minutes / 4k tokens including review and fix.
