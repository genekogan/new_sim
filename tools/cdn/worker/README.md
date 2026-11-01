# God upload CDN

`god-uploads.js` is the module Worker for `assets.eden.art/w/*`. It requires the existing `ASSETS` R2 binding.
It pulls cache misses from `https://souls.game/w/<slug>/assets/<sha>.<ext>`, verifies the SHA-256 and size, then stores
at the unchanged `w/<slug>/assets/<sha>.<ext>` key. Old slug keys remain valid: the root launcher must retain those
slug aliases. Never redirect authenticated agent APIs across origins as a substitute for launcher aliases.

## Cutover order

1. Deploy the root launcher and migrate its registry with the documented aliases. Verify upload routes at both
   canonical and old slugs reach the same world. The new Worker requires this upstream before serving cache misses.
2. In the existing static asset bucket's CORS rule, retain `https://sim.eden.art` and add exactly `https://souls.game`.
   Retain its methods and exposed headers; do not replace unrelated rules or use a wildcard. This bucket rule is
   separate from Worker CORS. Check a known static object with each Origin header.
3. Record the current Worker version and deployed route/bindings. Deploy this module to that existing Worker using
   the authorized Cloudflare CLI or dashboard, preserving its route and `ASSETS` binding. Account IDs, credentials,
   deployment config and receipts belong in private operational records, not this repository.
4. Run the verifier against an authorized scratch god folder. It uploads one fresh small GLB but does not place
   or define it in the world. The folder can name either allowed app origin and `/w/<slug>/` or `/worlds/w/<slug>/`.
   The verifier exercises miss, immediate R2 hit, cache hits, hash refusal and exact CORS for both origins.

```sh
node --test tools/cdn/worker/god-uploads.test.mjs
node tools/cdn/worker/verify-worker.mjs --self-test --out .local/cdn-self-test.json
node tools/cdn/worker/verify-worker.mjs --god /path/to/authorized/scratch-god --out .local/cdn-live.json
```

Walk the real client on both origins and check static and uploaded assets render without CORS failures. A loopback
receipt proves the handler contract; it does not prove the Cloudflare deployment or a browser's live rendering.
The Worker grants CORS only to the two exact origins, including on OPTIONS, HEAD, 304, errors and cached replies.
No Origin or any other Origin gets no allow-origin header. Cached bytes are shared, but responses bind CORS to the
current request and vary on Origin.

## Temporary origin-only release

If external CDN configuration cannot be completed, build the release with `SIM_GOD_UPLOADS_CDN=0` to serve uploads
from the world origin. If static bucket CORS is also unavailable, use `SIM_ASSETS_CDN_ENABLED=0`. These are build
settings, so changing them after a build does not alter the shipped app. A prebuilt artifact must match the settings.
Record the fallback in the release receipt and verify origin asset rendering. Re-enable only in a newly built,
verified release. To roll back the Worker, restore the recorded version; its upstream URL must still reach the
active world authority.
