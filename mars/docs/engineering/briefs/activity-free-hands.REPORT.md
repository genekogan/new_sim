# Activity free-hands admission correction

Source main `cb5ff57`; new isolated checkout `<mars-worktrees>/activity-free-hands`, branch `codex/activity-free-hands`. Local Git only. Dirty held-source bridge preserved and untouched.

## Change

Existing holdingDiagnostic checks construction grips, not small items with in-hand support. Narrow classroom initial/join and computer-work fresh/resume admission now inspect the existing heldBy model and refuse with `classroom.hands-occupied` / `workstation.hands-occupied`. Messages/subjects identify the actor and held item IDs and ask for an explicit put-down. Failed requests preserve world hash, item support, claims and unfinished work state. This does not implicitly put anything down, retry the requested activity, or discard meal contents.

The global holdingDiagnostic, item taking/putting, seated meal overlays, shared types and registry are unchanged. No physical execution changes; free-hand actions use the existing children. Registry version policy remains with integration owner.

## Checks

- Nine new focused tests use real registered take_item/put_item actions for bowls and spoons: initial class refusal, late join refusal then success after explicit puts, fresh work refusal, resumed unfinished-work refusal then same-user completion after puts, free-hand class completion, and successful taking/eating with both items while seated.
- Refusal checks compare world hash and actor/hand/item/holds/station/seat/display claims. Existing hold_items intentionally remains responsible for items still held after refusal.
- Combined focused coordinator/join/map/workstation/meal/new admission tests:56/56 pass. Existing meal golden remains unchanged.
- TypeScript and focused oxlint pass. No full gate, browser, deployment, golden, shared roadmap, dependency, or put_item edits.

## Preparation plan and limits

Read-only feasibility plan saved separately at `/tmp/mars-stow-activity-plan.md`. A future explicit standalone stow parent can delegate ordinary put_item children without Runtime redesign, but shared destination-slot claims/rechecking are a bounded prerequisite for concurrent safe surface placement. Existing ground drops use one point and cannot safely represent two arbitrary deposits. Atomic stow-to-work/class handoff remains outside these admission guards because existing actor-busy plans reject a parent's own actor claim. User chooses the next registered activity only after explicit put-down completion.
