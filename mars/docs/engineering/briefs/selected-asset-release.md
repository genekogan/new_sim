# Selected workstation release packaging

Bounded repair from `5c8672d` (functional release source `c43e382`). Own only `viewer/deploy/prepare.py`, `viewer/deploy/prepare-allowlist.test.mjs`, this brief and its report. Root owns full gate, main integration and production verification.

Release 26 omitted the selected workstation GLB and attribution from its static allowlist. Local loaded-model tests passed against public files, but production returned 404 and rendered the primitive fallback. The HTTP sweep checked only the prepared manifest, so its 341 assets could not expose those missing entries. Activity/MCP proof is distinct from loaded appearance proof.

Add exactly `models/retro-computer-monitor.glb` and `models/retro-computer-monitor.credit.json` to FILES. Extend the existing app/engine URL contract scanner to models and require both selected files without a models archive glob. Preserve current assertions, physics, asset contents, pins and fallback behavior. Capture the focused regression RED before the fix and GREEN afterward. No deploy or production success claim until root required gate and published loaded-model proof.
