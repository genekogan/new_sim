# Browser end-to-end checks

Markdown scenarios in `e2e/scenarios/` drive an isolated client fixture in headless Chromium from an explicit
browser cache, never a signed-in browser profile. Runs write screenshots, page text and a machine-readable summary
under `.e2e/runs/` (gitignored).

Install Chromium into the workspace cache first:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.e2e/browsers" pnpm --filter mars-campus-viewer exec playwright install chromium
```

## Client fixture scenarios (`e2e/scenarios/`)

Scenarios are Markdown files with front matter (`id`, `tier`, `fixture`, `critical_path`) and numbered steps of
actions plus `expect`, `expect-url`, `expect-console` and `screenshot` lines. `e2e/config.mjs` sets the paths, the
ports and an iteration cap of three failed attempts per scenario.

`client-fixture-arrival.md` covers arrival, camera and selection, and leaving and re-entering an isolated world:

- The fixture is a private, test-flagged world started from a tracked genesis with fake minds, served on
  loopback port 7830. Read-only bundle proxies run on 7834 (candidate) and 7835 (control). Chrome is driven over
  CDP on 7838 with a scratch profile, and an optional phone observer uses 7839.
- Arrival is complete when the entity layer is active, the asset queue is empty, every selected LOD asset has
  loaded and a hardware WebGL renderer is in use.
- The scenario leaves through the fixture's `/healthz` page and checks that re-entry creates a new document with
  exactly one world canvas. This proves full-document navigation only, not same-document renderer cleanup.

Rules for fixture runs:

- Whoever boots the fixture records its process IDs and stops only those processes. Never kill a process just
  because it holds a port, and never point scenarios at production worlds or production data.
- Build the browser bundle under test from a committed tree and record its path and hash with the fixture.
- Re-run a passing scenario only after a source change. Performance A/B samples are planned measurements
  (see [the speed tools](../../tools/speed/README.md)), not repeated smoke attempts.

The release-time real-Chrome walks (V7) are separate; see [remote gate](remote-gate.md).
