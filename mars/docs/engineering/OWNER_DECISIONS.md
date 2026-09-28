# Owner decisions (Gene, 2026-09-27 interview)

- Production deploys of validated work are allowed ("pre-release, ok to break stuff"). Record previous Worker version for rollback before each deploy.
- Git: local repo at campus-2026-reconstruction/, author genekogan <1335251+genekogan@users.noreply.github.com>. Remote (github.com/genekogan) to be set up by Gene later. Never push without him.
- Any npm libs / Playwright+Chromium / CC0 assets allowed. No account sign-ups.
- Terminology: **upright** = the tall blue frame with two columns (a braced side frame), up to 19 ft; carried/raised as one unit. **beam** = the orange horizontal members.
- Rack component sizes in use: 8 ft, 9 ft, 12 ft, 19 ft (which apply to uprights vs beams to be confirmed against the 2026 catalog; unknowns marked provisional).
- Flagship demo: hypothetical build on open ground in a *fork of 2026* (2-bay, 2-level rack building w/ 2x4 joists, plywood, stairs), clearly labelled non-historical.
- Compute: spend ~50 points of weekly quota over 12–20 h; not front-loaded. Gene's meter said 58% remaining when usage.py read 11% used → hard stop around usage.py week ≈ 61%.
- (2026-09-28) **How Martian floors are made:** builders stand on and climb the rack structure itself while
  staging — uprights' bracing works as a ladder, beams as a walkway — and materials come up by hand-up
  (ground crew lifts, two receivers on the beams take and lay) or by forklift. Nothing above standing reach
  may be interpolated into place. Full requirements: OWNER_FEEDBACK_2026-09-28.md.
- (2026-09-28) Movement quality bar: gradual splined turns; immediate reaction to blocks (no pushing into
  objects for strides); feet on stair treads; animated fire. Same file.
- (2026-09-28) **Build order at Mars:** skeleton first — large tranches of pallet racks raised and connected,
  then 2x4 framing (top plates, rafters, joists) and a 2x4 stair/ramp to the upper level — and only then floors,
  ceilings and walls, gradually, in a logical, ergonomic and safe order. Wood comes as strapped bundles
  (plywood, 2x4, 2x6, other sizes); there is cutting equipment on site; solar panels are their own piles and go
  up last onto roofs. Photos: docs/engineering/evidence/. Headline milestone: replay each year's construction
  from piles to the canonical state (OWNER_FEEDBACK_2026-09-28.md §7–10).

- (2026-09-28 02:20 EDT, **lead decision, overnight — Gene may veto**) **One body model.** The engine's reach envelope (arm 0.75 m,
  overhead 2.1 m, reach-down 1.0 m) and the Quaternius rig (arm 0.44–0.50 m from 1.33 m shoulders, ≈ 1.9 m overhead) disagreed,
  so hand-ups rendered with hanging arms under a sheet nobody could reach. Resolution: a single `engine/body/model.ts`
  (shoulder height, arm length 0.62 m, overhead reach ≈ 2.0 m, reach-down, lean limits) is the source of truth; the rig's arm
  bones are scaled to it once per template; hand-up/items/paint constants import it; a Playwright test pins measured rig reach
  to the model within 2 cm. Anything the model cannot reach is refused by the engine, never interpolated (feedback §5/§6).
- (2026-09-28 04:20 EDT, lead, overnight — Gene may veto) **Body model = the measured rig.** Renderer measurement (W9, three templates
  scaled to 1.75 m): shoulders 1.34 m, arm 0.62 m, overhead 2.00 m (2.06 on heels), kneeling reach-down at a deck edge ≈ 0.35–0.54 m
  below the feet at 0.45 m out. The engine model adopts these (shoulders 1.34, half-width 0.15, reach-down 0.5 m below the feet);
  the spec's "≈ 1.0 m reach-down" is therefore replaced by 0.5 m — hand-offs needing more are refused ("use the forklift").
  Supersedes the reach-down question in PROGRESS.md unless Gene wants a lying-down receiver posture instead.
- (2026-09-29 morning, Gene) **Reach-down:** the 0.5 m kneel rule stands as the default; a **prone receiver** (lying on the
  stomach at the deck edge, then rising to knees and feet while holding the load) is a real Mars practice and is to be modelled
  as a further posture (OWNER_FEEDBACK §13). **Top beams:** two people climb the upright on its cross braces and each holds one
  side of the beam while setting it — the `hang_beam`/stance mechanism is the real method (§14).
- (2026-09-29 ~09:45 EDT, Gene) **External Codex split.** Bounded areas move to an external Codex contributor (not a Claude
  subagent) on `codex/<topic>` branches off main; the Claude lead merges (ff/cherry-pick) after re-gating in a worktree; a Codex
  change that moves a pin is rejected back with the reason. **Codex-owned:** `engine/camera/parse.ts` (+ its tests);
  `app/engine-view/fire.ts` + `e2e/fire.spec.ts`; the paint/solar/equipment mesh files under `app/engine-view/` named by the
  render-polish brief; `docs/engineering/data/**` (2026 grouping output); lint/gate tooling files. **Claude-owned:** everything
  else — locomotion, construction, campus, spatial, body, take (`engine/take/**`), year-build sequencing, studio replay,
  `app/history/scenes.ts`. Never brief Claude workers into Codex areas; never touch `codex/*` except to merge. Codex uses its own
  Vite/Playwright port and artifact/.cloudflare dirs, reports to `docs/engineering/briefs/<brief>.REPORT.md`, never PROGRESS or
  HANDOFF. Guide: `docs/engineering/CODEX.md`; briefs: `briefs/`. Questions for Gene are parked in `QUESTIONS_FOR_GENE.md`
  (non-blocking; not re-surfaced in handoffs).
- (same) **Checkpoint 1** = 2022 complete: phase B landed and pinned, 2x4 framing verbs, all four houses, studio "Watch it being
  built · 2022". No deploy until Gene says so. The 2026 frame grouping is Codex's; Claude takes the integration half once its JSON
  is on a `codex/*` branch.
