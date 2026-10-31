---
name: proof
description: Record the proof clip a T2+ change needs — one uncut, real-speed Playwright video of the changed user journey on a local fake-mind world, with a scrub bar and timecode burned in, desktop and (when layout changed) phone — then attach it to the pull request without committing video into the repo. Use when a change is tier T2 or higher, when a PR or issue asks for a clip, when the finish skill reaches its proof step, or when reproducing a bug on camera for triage.
---

# proof — an uncut clip of the changed journey

A reviewer should be able to watch what a user would see, at normal speed, start to finish. The clip is the
evidence; a screenshot, a contact sheet or a sped-up recording is not.

Source of truth for what a tier needs: `docs/process/PROOF-POLICY.yml` (T0 nothing; T1 focused tests + typecheck;
T2 adds one clip of the changed journey, desktop, plus phone if layout changed, on a fake-mind world; T3/T4 add more).
Get the tier of the current diff with `node tools/proof/tier.mjs --base origin/main`.

## Rules
- **Uncut and real speed.** One browser context, one take. Never trim, splice, speed up or slow down. If the journey
  is longer than the policy's `max_seconds`, record a shorter journey that still shows the change, not a faster one.
- **Real input.** Drive with `page.mouse`, `page.keyboard`, `page.touchscreen` or locator clicks, the way a user
  would. Do not call app internals from `page.evaluate` to make things happen on camera.
- **Fake minds, isolated data.** Local worlds only, `BRAIN_MODE=fake`, a fresh data dir. Never record against a
  production world unless the maintainer asks, and never with a signed-in personal browser profile.
- **Never commit video** (or frames) into the repo. Work under `.e2e/` (gitignored).
- The clip must show the change. Watch it (or at least extract frames, below) before you attach it.

## 1. Boot a fake-mind world

Needs a built web client (`pnpm install --frozen-lockfile && pnpm --filter @sim/web build`; skip if
`apps/web/dist/index.html` exists and is current for your change).

```bash
node tools/god-skill/dev-world.mjs proof 4710 --genesis worlds/templates/hello-hamlet.json --fresh
# prints http://127.0.0.1:4710/w/proof?dev=1 (pid N, log .lane/proof.log); the server keeps running detached
```

Pick the template that contains the changed surface (`worlds/templates/`: hello-hamlet is small and fast; eden-2026,
mars-two and others are larger). Use a free port; `E2E.md` lists ports reserved for other harnesses. Stop the server
with `kill <pid>` when done.

## 2. Write the steps

Copy `.claude/skills/proof/steps.example.mjs` to `.e2e/proof/<slug>/steps.mjs` and script the changed journey:
arrive, do the thing, show the result. `mark('label')` stamps a chapter time into the sidecar so the PR can say
"the panel opens at 0:07". Keep it to the journey the change affects.

## 3. Record

```bash
node .claude/skills/proof/record.mjs --url 'http://127.0.0.1:4710/w/proof?dev=1' \
  --steps .e2e/proof/<slug>/steps.mjs --out .e2e/proof/<slug>/desktop.mp4 --viewport desktop
# layout or touch changed? also:
node .claude/skills/proof/record.mjs --url '...' --steps .e2e/proof/<slug>/steps.mjs \
  --out .e2e/proof/<slug>/phone.mp4 --viewport phone
```

- Browsers: uses `PLAYWRIGHT_BROWSERS_PATH`, else `/opt/pw-browsers` when present. If Chromium is missing:
  `PLAYWRIGHT_BROWSERS_PATH="$PWD/.e2e/browsers" pnpm --filter mars-campus-viewer exec playwright install chromium`.
- Playwright is resolved the same way the playtest harness does (`tools/playtest/lib/platform.mjs`: a global
  `playwright`, else `@playwright/test` from `mars/viewer`). No GPU is needed; WebGL runs on SwiftShader.
- `--max-seconds` defaults to the policy's `max_seconds`. Exit 3 means the journey ran past it: shorten it.
- With ffmpeg: an mp4 with a progress bar along the bottom and a `hh:mm:ss / total` timecode (the timecode needs an
  ffmpeg built with drawtext; the sidecar's `timecode` says whether it is there). Without ffmpeg: the raw `.webm`;
  say so in the PR (players still show their own scrub bar).
- Each clip gets a `<clip>.json` sidecar: url, viewport, duration, marks, console errors, commit and dirty flag.
  Console errors in the sidecar are findings: explain or fix them.

The run takes well under the 10-minute foreground limit. For several clips in one go, run them in the background
(`nohup setsid node ... > .e2e/proof/<slug>/rec.log 2>&1 &`) and poll the log.

## 4. Check it yourself

```bash
for t in 1 4 8; do ffmpeg -loglevel error -y -ss $t -i .e2e/proof/<slug>/desktop.mp4 -frames:v 1 .e2e/proof/<slug>/t$t.png; done
```

Look at the frames (Read the PNGs). The changed state must be visible, the world must have loaded (not a blank or
loading canvas), and nothing in frame should be private. If it does not show the change, fix the steps and record a
new take; do not attach a clip that does not prove the claim.

## 5. Attach it to the PR (never commit it)

In order of preference:

1. **The documented proofs host.** If `.github/pull_request_template.md`, `CONTRIBUTING.md` or `AGENTS.md` names an
   upload command or host for proof clips, use exactly that and paste the returned URL into the PR's Proof section.
2. **A `proofs` release, if the maintainer created one** (check: `gh api repos/$REPO/releases/tags/proofs --jq .id`).
   Upload the clip as a release asset named `pr<N>-<slug>-<viewport>.mp4`:
   ```bash
   RID=$(gh api repos/$REPO/releases/tags/proofs --jq .id)
   gh api -X POST "https://uploads.github.com/repos/$REPO/releases/$RID/assets?name=pr$N-$SLUG-desktop.mp4" \
     -H 'Content-Type: video/mp4' --input .e2e/proof/$SLUG/desktop.mp4 --jq .browser_download_url
   ```
   Do not create the release yourself; if it is missing or the upload returns 403/404, fall through.
3. **No host available:** post a PR comment that says the clip exists but is not uploaded, with its duration,
   viewport, sidecar summary (marks, console errors, commit) and the exact `record.mjs` command and steps file
   contents, so anyone can re-record it. Mark the proof as pending in the PR body. Never paste video as base64,
   never commit it, never push it to another branch.

`$REPO` is `owner/name`: `REPO=${GITHUB_REPOSITORY:-$(git remote get-url origin | sed -E 's#\.git$##; s#.*[:/]([^/]+/[^/]+)$#\1#')}`.
Comment with `gh api repos/$REPO/issues/$N/comments -F body=@.e2e/proof/$SLUG/comment.md` (`gh pr` is not available
in cloud sessions; use `gh api` REST only).

## What to write next to the clip
One line per clip: what journey, which world template, viewport, duration, commit, and the moment the change is
visible ("0:07 the seat highlights and the Soul sits"). Plus any console errors and why they are acceptable.
