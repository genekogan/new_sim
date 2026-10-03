# Item destination claim prerequisite

Source `3134294` (`codex/classroom-floor-release`); isolated checkout `<mars-worktrees>/item-destination-claims`, branch `codex/item-destination-claims`. Next playable milestone candidate only; current independent gate/release untouched. Local Git only; dirty held-source bridge untouched.

## Change

Existing non-ground put_item acquires exclusive canonical `surface-slot:<surfaceSlot>` alongside its existing actor/hand/item claims. Valid surface IDs already resolve through the one surfaceSlot model; no alias or separate registry is added. A future stow parent can hold that same token and delegate it to ordinary put_item children through existing ancestor claims. Different surface-slot destinations remain independent.

Plan stores detached owner pose/definition and the existing slot point. Immediately before the normal release transition, put_item resolves the surface again, checks owner pose/definition and slot binding, and rechecks occupancy. Missing/unusable surface returns item.destination-unavailable; changed binding returns item.destination-moved; late occupancy returns item.slot-occupied. Subjects identify actor, item and exact destination (plus owner/occupier). Refusal keeps in-hand support, releases failed transfer claims, and leaves the independent hold_items action responsible for the held object.

No reach duration, walk route, hand trajectory or valid release behavior changed. Cancel before release retains the held item; cancel after release retains the placed support. Failed approaches/cancel release the destination token. Ground behavior and all activity/stow parent implementations are untouched.

## Verification

Twelve focused new tests use actual take_item to establish held bowls and ordinary put_item execution:

- Two actors racing one destination: second receives reservation.conflict without world mutation; first completes.
- Two distinct slots: both execute and complete independently.
- Cancel before/after release: correct support persists and all transfer claims release.
- Late occupancy, removal, translation, rotation and wrong surface capability: release refuses by name, item remains held, no transfer claim leaks/violations.
- Failed walk child approach: destination releases while held support remains.
- Exact parent token delegation: child can acquire inherited token, parent retains it after child completion, then releases.
- Mid-reach JSON snapshot round trip: token/binding restored, final world matches normal completion.

Combined dedicated destination + existing meal tests:18/18 pass. Meal includes existing pinned608-tick world hash and mid-eat snapshot restore; no goldens changed. TypeScript and focused oxlint pass. No full gate, browser, performance or paid calls.

## Limits and integration

Claims coordinate registered puts/future parents; they cannot prevent arbitrary external world mutation, hence the release revalidation. This deliberately refuses moved surfaces instead of rerouting/rebinding. It does not implement surface movement/editor control, table entity locks, or ground-cell reservations. Snapshot test covers the new exec format; old active-put snapshots are not promised migration. Lead owns any engine rules-version bump at future integration; registry/types outside item internals remain unchanged. Ground placement (including two overlapping ground deposits) and explicit stow/preparation remain deferred per `/tmp/mars-stow-activity-plan.md`.
