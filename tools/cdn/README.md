# tools/cdn

Publishing and checking the immutable asset CDN at `https://assets.eden.art`. How it works and how to run each tool:
[docs/operations/cdn.md](../../docs/operations/cdn.md). Pulling media into a checkout is `tools/assets/`
(`pnpm assets:pull`).

Dry runs need nothing. A real upload (`--apply`) needs `CF_ACCOUNT_ID`, from the environment or the untracked
`deploy.env` at the repository root (template: `deploy.env.example`), and `EDEN_ASSETS_CREDENTIALS` in the environment:
the absolute path of the mode-0600 R2 credentials file, kept outside the repository.

| File | Purpose |
|---|---|
| `publish.mjs`, `inventory.mjs`, `receipt.mjs` | Dry-run plan and client manifest; credentialed upload with receipts; `--repo-media` publishes the pull-only media in `tools/assets/manifest.json` |
| `verify.mjs` | Public cache, header and hash proof of uploaded objects |
| `cdn-walk.mjs`, `origin-cache.mjs` | Real-Chrome runtime check of live pages (a release step) |
| `served-public.mjs`, `served-public.json`, `served-blobs.json`, `approved-derivatives.json` | Records of what may be published |
| `world-scoped.mjs`, `world-scoped.json` | Per-world objects |
| `browser-proof.mjs`, `world-scoped-proof.mjs` | Local browser proofs against stand-ins |
| `install-key.py` | Creates the 0600 R2 credentials file read through `EDEN_ASSETS_CREDENTIALS` |
| `worker/` | The god-uploads pull-through Worker, its tests and its post-deploy check |

Tests: `node --test tools/cdn/*.test.mjs tools/cdn/worker/*.test.mjs` and `python3 -B tools/cdn/install_key_test.py`.
