# Cold meal preparation — bounded helper candidate

2026-10-01. Unreleased, unregistered helper candidate on local branch
`codex/meal-preparation-helper`, based on exact `57c34cd`. Root owns integration,
Lab UI, existing serving guard, release 32 and deployment. No shared files changed.

The new `viewer/engine/activities/prepare-food.ts` action prepares an explicitly
hypothetical cold two-ingredient shared dish at an existing ground `table-6ft`.
Two finite full ingredient bowls, an empty supported pot and a supported spoon are
required. Ordinary `take_item` and `walk_to` children approach authored supports,
turn/facing included. A held right-hand spoon reaches each ingredient for 20 ticks,
then the supported pot for 20 ticks, for eight scoop/deposit cycles. The same utensil
expresses a small deterministic polygon stirring motion for 60 ticks (3 seconds at
DT 1/20). Existing semantic hand points and `followHand` express this action; no new
rig, actor mover, physical support override, catalog object or replacement vessel.

Each committed deposit transfers 0.25 bowl fraction to 0.0625 pot fraction. Four cycles
empty each bowl; two full bowls become 0.5 pot, meaning exactly two full served bowls.
The existing ratio stays full bowl = 1 serving, full pot = 4 servings. Binary quarter
fractions avoid rounding drift. Actor, right hand, spoon, pot, both source bowls and
table have exclusive hierarchical leases. Source/pot IDs, poses and supports stay
unchanged. Every-tick conservation is checked in both feasible layout regressions.

## Plain object state and stop contract

Optional `Entity.foodPreparation` contains only JSON:

```ts
{
  kind: 'cold-two-ingredient-v1',
  ingredients: [
    { item: 'beans', food: 'beans', initial: 1, deposited: 0 },
    { item: 'greens', food: 'greens', initial: 1, deposited: 0 }
  ],
  mixedTicks: 0,
  complete: false
}
```

`initial` and `deposited` use source-bowl fractions. Pot food/fraction and source
food/fractions are checked against these commitments. The first mutation happens
on a runtime step, not admission/start. Ingredient quantity and progress commit
atomically at deposit; a scoop before deposit is an uncommitted visual reach, with
no separate consumable spoon payload. Cancelled scoops can repeat without consuming
anything twice. Cancellation/draining retains all deposited food and mixed ticks;
explicit retry infers remaining work from the same vessel state. A successful
preparation marks `complete` only after all eight deposits and all 60 mix ticks.
No actual heat, chopping, cutting, volumetric spoon physics or historical recipe.

`yieldTo` and `onDirective` stop owned child work for a new director actor/hand
command. The independent directive proceeds through Runtime after leases drain.
Partial preparation remains unfinished. On stop/completion, preparation leases
release; the spoon remains physically held through ordinary `hold_items`, which
retains only its established `holds:<actor>` lease. Call ordinary `put_item` when
an authored return is wanted. No automatic cleanup overrides a directive.

Quiescent JSON stringify/parse of the world, followed by a new Runtime and explicit
retry, preserves exact partial mixing. Active graph restoration is explicitly
nonresumable through the ActionDef reason; no claim of tick-exact active snapshots.
The pot's progress is authoritative; source/pot changes, replaced state, moved
support and changed quantities refuse with named `prepare_food.*` diagnostics.

## Minimal root integration (not performed here)

1. Add optional `foodPreparation` to `Entity` in `world/types.ts`, with the shape
   above (a world-owned exported type may replace the module's temporary local
   intersection). Include it in any explicit persistent/input object schema used
   by Lab/reset/checkpoints; `physicalView` already retains unknown object fields.
2. Register `PREPARATION_ACTIONS` through the existing activity registry and record
   the changed activity rule version. The scenario provides its own tiny registry
   for focused tests, so the production registry is intentionally unchanged here.
3. In existing `servingContents` (used at both plan and deposit), reject any pot with
   `foodPreparation` present and `complete !== true`, e.g. named
   `serve.preparation-incomplete`, naming that pot and remaining deposits/mix ticks.
   This candidate alone MUST NOT be integrated as a playable serving path without
   that guard. Preserve legacy pots without this field. After completed serving,
   the state is historical completion metadata; already-prepared retry should
   still refuse, and no second batch/new-recipe reuse is claimed.
4. Bind Lab to `preparationWorld`/`preparationParams` or an equivalent explicitly
   authored arrangement, expose the preparation action/phase plus partial contents,
   and retain the tested reset JSON field. The second validated layout is yaw pi/2
   at (3,2); the first is yaw 0 at (0,0). Both have ground-only table access.
5. Run the actual incomplete/complete serving guard regressions, existing meal and
   shared-food regressions, actual Play including interruption/reset lifetime,
   viewer typecheck and required combined gate before a release claim.

## Verification performed

`node --test engine/test/food-preparation.test.ts engine/test/source-scan.test.ts`
passed 20/20 (19 preparation + 1 source scan), final run 0.663 seconds. Checks cover two
layouts/orientations; finite every-tick conservation; stable source/pot
identity/support; varying stirring hand points; partial/complete progress; exact
cancellation before/after deposit and during taking, source approach, scoop, pot
approach and mixing; explicit retry; quiescent JSON restoration; director walk
handoff; missing ingredient/spoon; foreign held spoon and foreign actor lease;
moved table support; quantity corruption on retry; unsupported pot, nonempty pot,
partial source; deterministic world and ActionRecords; released resources and zero
Runtime invariant violations. Source scan retains all existing bans/allowlists.

Focused strict TypeScript clean:
`tsc --noEmit --strict --target es2023 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --skipLibCheck engine/activities/prepare-food.ts engine/scenarios/preparation.ts engine/test/food-preparation.test.ts`.
Scoped oxlint clean; three source files formatted with oxfmt. A first ad-hoc tsc
invocation omitted `--strict` and produced existing dependency-narrowing errors;
the corrected strict command is the verification above. Initial test iterations
caught event-field and retry-aliasing mistakes; final suite is fully green.

No heavy suite, full engine gate, build, GPU, browser, deployment, remote or push.
Retained historical/owner worktrees and dirty changes. This is a bounded reviewed
candidate for root integration, not a shipped meal or a universal preparation
subsystem. Supported scope is exactly two initially full finite bowls, one empty
pot, a right-hand spoon, one existing ground table, ground-only access and one
batch; ingredient selection/planning, multiple cooks and subsequent batch reuse
remain unsupported.
