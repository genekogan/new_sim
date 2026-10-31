# tools/cdn

Publishing and checking the immutable asset CDN at `https://assets.eden.art`. How it works and how to run each tool:
[docs/operations/cdn.md](../../docs/operations/cdn.md).

| File | Purpose |
|---|---|
| `publish.mjs`, `inventory.mjs`, `receipt.mjs` | Dry-run plan and client manifest; credentialed upload with receipts |
| `verify.mjs` | Public cache, header and hash proof of uploaded objects |
| `cdn-walk.mjs`, `origin-cache.mjs` | Real-Chrome runtime check of live pages (a release step) |
| `served-public.mjs`, `served-public.json`, `served-blobs.json`, `approved-derivatives.json` | Records of what may be published |
| `world-scoped.mjs`, `world-scoped.json` | Per-world objects |
| `browser-proof.mjs`, `world-scoped-proof.mjs` | Local browser proofs against stand-ins |
| `install-key.py` | Creates the 0600 R2 credentials file read through `EDEN_ASSETS_CREDENTIALS` |
| `worker/` | The god-uploads pull-through Worker, its tests and its post-deploy check |

Tests: `node --test tools/cdn/*.test.mjs tools/cdn/worker/*.test.mjs` and `python3 -B tools/cdn/install_key_test.py`.
