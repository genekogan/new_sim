# LM137: verify a saved file camera track

The implementation already resolves `{track:{file:id}}` through `fileCamera` in `app/studio/page.tsx`. The release10 clean gate and production run passed the end-to-end save/download/reopen/select/verify case, comparing every verification sample with the in-page directed track and preserving the take bytes. The lead inspected `prod-smoke-10/studio-direct-file-track.png`.

This follow-up adds the negative case: a nonexistent file camera returns null, cannot fall back to the active camera, and changes neither selected camera nor replay pose. No runtime code or pin changes. Candidate closure awaits the complete next gate.
