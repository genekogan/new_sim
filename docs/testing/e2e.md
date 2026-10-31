# Milestone browser validation

`infra/smoke.mjs` drives isolated Playwright Chromium against fake local
processes or the existing staging origin. Never reuse the owner's signed-in
browser or enable DEV_AUTH on a public URL. The test context is disposed on
exit. The one signed-in browser remains available for owner/admin spot checks.

Install using an explicit cache (never Playwright's default Library path):
`PLAYWRIGHT_BROWSERS_PATH="$PWD/.e2e/browsers" pnpm --filter mars-campus-viewer exec playwright install chromium`.

For local processes on 4610/toy and 4612/Mars:
`SIM_SMOKE_MARS_BASE=http://127.0.0.1:4612 node infra/smoke.mjs`.
For staging: set `SIM_SMOKE_BASE=https://<staging-host>`.
Set PLAYWRIGHT_BROWSERS_PATH to an existing explicit workspace cache when
needed. Screenshots, body text and a machine-readable summary are written
under `.e2e/runs/`. Screenshot review accompanies assertions; this smoke is
not a replacement for the full preserved Mars release gate.

The deployed ten-route smoke sets `SIM_SMOKE_EXTRA_WORLDS=1` and covers the world
list, four live worlds, three Labs and two representative year pages. All eight
year pages have separate merge proof. Route smoke proves load/health, not every
physical activity; use the qualification note for completion/restart evidence.


Client performance scenarios in `e2e/scenarios/` use private, test-flagged tracked-genesis
fixtures on loopback7830–7833, read-only bundle overlays7834/7835, an explicit scratch Chrome profile/CDP7838, and the
read-only physical-phone observer on7839. The coordinating lane owns fixture boot
and teardown through receipt-recorded PIDs; scenario drivers own and close their
browser contexts. Never kill a process merely because it owns a port. Never use
ports4981–4999 or product world data. Build exact committed browser bundles on
Modal, then provide their path/hash with the fixture receipt. Parse scenarios with
`.e2e/parse-scenario.mjs`; save snapshots, screenshots, console logs, assertions,
and summaries under `.e2e/runs/`. A source change permits a new validation run;
passing scenarios are not rerun for reassurance. Cap failed attempts at three,
with independent diagnosis before the third. Performance A/B samples are separately
planned measurements, not repeated functional smoke attempts.

The performance lane attaches to receipt-owned remote fixtures through loopback
tunnels instead of booting another server. Its browser driver uses Playwright CDP
against the owned hardware-GPU Chrome, records a ready receipt, and closes only
its own browser contexts. Read-only `/healthz` is the isolated navigation-away
target; the product-facing all-worlds link is outside this fixture scenario.
Selected distance LOD assets, not every possible original model, define arrival
completeness. Same-document scene cleanup needs the separate epoch-remount proof;
full-document navigation alone does not establish that contract.
