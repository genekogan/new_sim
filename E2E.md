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
