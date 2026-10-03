# Autonomous camera: start here

Read the [durable camera handoff](../../docs/engineering/briefs/autonomous-camera.md)
before changing this system. It documents architecture/module responsibilities,
frozen read-only hooks, operator precedence, policies, safety, async Jev/replay,
release18 status, actual MP4 evidence, reproduction/validation, prioritized TODOs,
open questions and future-agent takeover.

The [chronological report](../../docs/engineering/briefs/autonomous-camera.REPORT.md)
contains source/test/capture provenance and retained failures. Its dated historical
“not integrated/released” statements do not supersede the handoff's current status.

Camera observes the world; it never directs authoritative actor behavior. Existing
engine camera and shared Lab/build/deploy paths are integration-owner controlled.
Gene retired the original session after documentation; future work starts only
when requested, on an isolated branch, with current ownership/ports verified.
