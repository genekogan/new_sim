# Wave 1 — static geometry edits (LM-002)

`engine_edit_world` accepts `static_add`, `static_update` and `static_remove` on editable forks. Query `include: ['obstacles']` returns the effective geometry. Overrides live in checkpoint state; shared/canonical campus files remain untouched. Navigation, rehearsal and room cameras use the effective scene and its hash. A physical diff includes the new optional field, so existing unedited pins do not change.

Edits refuse named conflicts for bounds, overlap, unsupported geometry, duplicate/missing ids, dependent surfaces/solids/traversal links or resting entities. One convex existing surface must support the complete footprint; disconnected corner patches do not permit floating spans. Batches are atomic. This is a conservative static-prism editor; moving a supporting assembly is deliberately refused.

Four focused regressions cover removal + auto-rebind, restart persistence, sequential edits and invalid cases, supporting posts, and disconnected floors. Combined engine run: 447 total, 430 pass, 0 fail, 6 skip, 11 TODO in 58.5 s (`viewer/.cloudflare/integrated-engine.log`). Typecheck and zero-warning lint passed. Existing skips/TODOs remain historical-content work; no pins moved.

Browser: `E2E_VITE_PORT=5497 E2E_RUN=static-edits-1 npx playwright test -c e2e/playwright.config.ts static-edits.spec.ts`, 1 pass. Lead inspected `e2e/artifacts/static-edits-1/static-closed.png` and `static-open.png`: visible gate wall forces the detour; its removal restores the passage. Both complete with zero violations; JSON proof beside captures.

MCP integration for static edits is being added in a separate control-plane evidence change. This report does not claim a completed release gate or merge.

Final review adds a fifth focused regression: a person standing directly on a static platform without an explicit resting-on support tag cannot be stranded by removing it. Support refusal now checks physical entity bottoms as well as recorded support references. Five focused tests and lint pass; full gate follows.
