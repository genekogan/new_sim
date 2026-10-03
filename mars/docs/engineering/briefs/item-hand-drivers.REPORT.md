# Reserved hands and physical hand drivers

Bounded prerequisite for explicit two-item preparation. `hold_items` previously skipped every reserved hand, including reservation-only composites and item transfers still approaching/turning. A pending item could stay behind with in-hand support while its owner moved.

`ActionDef.drivesReservedHands` is optional: omitted preserves legacy driver ownership, false declares a reservation-only coordinator, and a pure record-phase predicate distinguishes transfer reach/withdraw from approach/turn. Take/put drive only reach/withdraw; eat/serve and unknown existing actions retain the default. No Runtime ordering, support, cancellation or meal timing changes.

Regression coverage uses real bowl/spoon takes, standalone and reservation-only-parent puts, walking and turning, transfer reach ownership, continuous bounded pending-item motion, and legacy default driver ownership. Validation: 5 dedicated driver tests + 6 meal tests pass (included in 48 combined focused tests with stow/destination). Meal pin remains 608 ticks / 3c28879fa21e485e910eef10f0266ced8562534d3c83623232b00a94e26090eb. Typecheck and scoped oxlint pass.

The existing Runtime submission-order cadence remains: older hold_items follows the body pose from immediately before the newer mover's step. Same-tick following, exact contact/finger fidelity and broad collision certification are deferred. Root owns visual inspection of the supported table-room flow before release.
