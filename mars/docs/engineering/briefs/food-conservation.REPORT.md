# Serving conservation — bounded engineering draft

Root serial `codex/meal-prep-mvp`, not integrated/released. Enables reliable shared
food and subsequent preparation without silently replacing or creating portions.
No rig, movement, support, ownership, historical content or appearance change.

Three new regressions reproduce the source failures (6 existing checks PASS,
3 new FAIL, retained `.cloudflare/meal/conservation-before.log`): a nonempty bowl
was overwritten, a tenth of a pot filled a whole bowl despite the established
quarter-pot/full-bowl conversion, and two simultaneous diners both received the
same last quarter-pot portion. The shared pot lease allowed both plans, so admission
alone could not guarantee remaining quantity at actual deposit.

Serving now requires an empty bowl and at least one full portion, with named
`serve.bowl-not-empty` and `serve.insufficient-food` diagnostics. Recheck at deposit
before either contents write; on shortage release the overlay/claims, retain the
empty supported bowl and remaining food, explain why this attempt failed. Existing
empty-pot diagnostics and ordinary four-person meal outcomes remain unchanged.
No partial serving or implicit topping-up/mixing is claimed. The existing ratio
remains one full bowl per0.25pot; general container-volume conversion is deferred.

Five new checks cover both admission refusals without world mutation, shared-pot
last-portion contention with exact conservation/resource release, and cancellation
before/after a committed deposit retaining that effect and ownership. Combined meal,
shared-food, purposeful-routine and source-scan checks58/58PASS15.6s; viewer TSc and
scoped oxlint clean. Retained final log `.cloudflare/meal/conservation-final.log`.
Rule version activities/14→15 explicitly records stricter serving semantics; no
golden, pin, tolerance, existing assertion or expected successful outcome changes.

No new browser/full gate/public proof yet. Chess084f492 full gate is running on its
frozen source independently. This draft must join a later combined candidate and
required actual Play food evidence before release; no claim of implemented meal
preparation or supported sleep follows from these guards.
