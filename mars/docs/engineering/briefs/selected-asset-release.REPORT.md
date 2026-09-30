# Selected workstation packaging repair report

2026-09-30. Worktree/branch `codex/selected-asset-release`, base `5c8672d`; local Git only. Four normal links preserved. Root authorizes only packaging repair and focused checks; no build, full suite, browser or deployment performed here.

Release 26 static manifest has no `/models/` entries, so neither selected GLB nor credit shipped. Its successful 341-asset HTTP sweep enumerated that incomplete manifest. Root actual published loaded-model proof returned 404/primitive fallback and is RED for appearance; this is separate from passing release 26 activity/MCP infrastructure. No claim of an established Cloudflare1102 fix.

Before the fix, the extended `node --test deploy/prepare-allowlist.test.mjs` reproduced RED: four tests, two pass/two fail, 196.4ms. The URL contract named `/models/retro-computer-monitor.glb` absent from allowlist; the explicit selection regression named the attribution JSON absent. Log `viewer/.cloudflare/allowlist-before.log` preserved.

Repair adds only two FILES entries under models: `retro-computer-monitor.glb` and `retro-computer-monitor.credit.json`. The scanner now recognizes models URLs and guards detection of the known selected model literal. A new regression requires exactly the selected model/attribution files and forbids a broad models glob. Existing assertions remain intact; no archive import, source asset change, renderer, engine or tolerance change.

After repair the same focused command is GREEN: four pass, zero fail/skip/TODO, 169.0ms. Log `viewer/.cloudflare/allowlist-after.log` preserved. Diff/credential review and normal commit scanner apply. Root still owns required combined full gate and subsequent published loaded-model/reset/credit verification; this report proves the local packaging contract only.
