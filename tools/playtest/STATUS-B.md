# STATUS-B — observer/ (worker B, 2026-10-24)

Files: `observer/world-truth.mjs`, `observer/browser.mjs`, `observer/evidence.mjs`, `observer/*.test.mjs`,
`observer/fixtures/*.json` (recorded from the pttest dev world), `observer/smoke.mjs`.

## How to run
- Tests (no world, no browser): `node --test tools/playtest/observer/*.test.mjs` — 9 pass.
- Smoke (needs a dev world; default pttest on 4981, Pip): `node tools/playtest/observer/smoke.mjs [--base URL]
  [--soul s_…] [--identity agent-…] [--out DIR] [--gpu metal|swiftshader]`. Prints one JSON object on stdout.

## What works (verified on the pttest world)
- `snapshotSoul({base, soulId, identity?, admin?, keepRaw?})` — public Soul + owner status + owner inbox + /v1/world.
  `identity` = owner (status + inbox); `admin:true` reads owner status as `dev:admin` (dev worlds read any Soul) but
  no inbox. `pos.src` says where the position came from (`owner` status or the `lastReceipt`). `http` has route codes.
  `holding/following/riding` are read if the server ever returns them (none of the routes do today → null).
- `receipt({base, id, soulId})` — from the public receipts list (`/v1/edge/receipts/<id>` needs a Soul token: 401).
- `healthz(base)`, `serverWindow({log, fromMono, toMono, runStartMs})` (time-sliced log lines + error count).
- `godSlice({base, godDir, around, radius})` — `/v1/god/snapshot` refuses `dev:admin` (needs a god token), so it
  downloads `<base>/god/eden-god.mjs` into an observer-owned `godDir`, runs `register <base> dev:admin` + `mint` once
  (mint adds a token; it does not revoke the god seat's), then `where x,z --json` + `describe <path> --json` per entity
  within radius. Returns `{inside, insideSolid (layer solid, Souls excluded), entities:[{path,id,def,dist,layer,
  footprint:{minX,minZ,maxX,maxZ} from aabb, box, pose, slots}], ground, footprints:true}`; null ⇒ oracle `unknown`.
  Never point `godDir` at a seat's folder. (~1.5 s unloaded; 23 s at load 33.)
- Browser: `openBrowser({gpu})` → `.openCamera({base, identity, kind, soulId, viewport, dpr, name})`; `Camera.shot(path)`,
  `.legible()`, `.ensureFollow()`, `.viewer()`; `sampler({cameras, everySec, runDir})` → `shots/<cam>/<mono>.png` +
  `shots/index.jsonl` (cam name defaults to the soulId for follow, `wide`; pass `name: '<seat>'`).
- **Follow**: `#soul/<id>` only selects the Soul (camera stays `broadcast`); the camera then real-clicks
  `.soul-card .soul-follow[aria-pressed=false]` and waits for `.viewer-history[data-viewer-mode=follow]` with
  `data-viewer-selection=<id>`. The OWNER's card hides Follow while the agent is away → `follow.ok=false` with that
  reason; `ensureFollow()` runs before each follow shot and clicks once the button appears. Wide = default broadcast.
- Evidence: `openRequest({runDir, seat, soulId, requestId, text, channel, sentAt})` → `.sample({snap, legible, shot})`,
  `.addChatTurn`, `.addServerErrors`, `.setCost`, `.close({cutoffReason})` writes `evidence/<requestId>.json` with the
  §4.2 keys (+ `firstBodyChangeMono`, `cardSeen{ackAt,resultAt}`, `omitted[]`). ack = inbox `latest.reply` /
  `acknowledgedAt`; result = `latest.result` / `resultAt`; resultState = `latest.outcome` (done|failed|withdrawn).
  Values over 256 KB (sample raw bodies, legible innerText, whole samples) → `evidence/raw/<sha>.json.gz`, replaced by
  `{omitted:true, raw, sha, bytes, projection}`.

## Selectors (full list in the browser.mjs header)
viewer `.viewer-history[data-viewer-mode|selection|presentation|tick|ready]`, `.viewer-following-label`; arrival
`.viewer-arrival` / body text "Arriving in"; card `article.soul-card` `#soul-card-name` `.soul-status` `.soul-doing`
`.soul-agent[data-agent-state]` `.soul-follow`; agent box `.agent-message-presence[data-agent-presence] > span`,
`.agent-message-receipt[data-message-state]` `.agent-message-state` `.agent-message-text` `.agent-message-reply`×n
(ack, result); bubbles `.world-name-tag[data-soul-id]` (b, line, card, `[data-channel-chip]`), `.dlg-row-text`,
`.dlg-lines`; signs `.world-place-card`, `.world-hover-tooltip`; toasts `[role=status|alert],[aria-live]` outside the
card, `.viewer-follow-hint`, `.warn`; roster `.my-souls button[aria-label]`, `.explore-souls`; New Soul = a button
with that text.

## Stubbed / limits
- Speech bubbles proper are 3D (SpectatorSpeechLayer) — only the name-tag line, channel chip and dialogue dock are
  legible text. Explore roster is read only when Explore is open (the observer does not open it).
- `legible().card.ack/result` are positional (`.agent-message-reply` order); when only a result exists it lands in
  `ack`. Use the inbox (`snapshotSoul().inbox.latest`) as truth; legible is "what a human could read".
- Under heavy machine load (load avg 27–33 during the smokes) arrival took 16–66 s and a shot 2.4–12 s (Metal,
  1280×800); when a shot outlasts the interval the sampler runs back to back instead of every N s.

## Smoke output (pttest, compact; no tokens)
Run 2 at 03:29Z (load avg ~27); full JSON: `/private/tmp/claude-501/-home-Eden/b8858d4a-ce94-5d46-86a2-d81fc77129bc/scratchpad/obsB-smoke2.json`.

**Follow screenshot for the coordinator:** `/private/tmp/claude-501/-home-Eden/b8858d4a-ce94-5d46-86a2-d81fc77129bc/scratchpad/obsB-smoke2/shots/s_6021854a99/75158.png`
(Pip selected, HUD "Following Pip", card button "Following"; wide shots in `/private/tmp/claude-501/-home-Eden/b8858d4a-ce94-5d46-86a2-d81fc77129bc/scratchpad/obsB-smoke2/shots/wide/`).

```
follow: {"ok":true,"how":"hash #soul/<id> + click .soul-card .soul-follow"}  arrivedMs: {"follow":16083,"wide":30076}

shots: follow@62500ms 3485ms follow | wide@65987ms 2494ms broadcast | follow@68482ms 2376ms follow | wide@70859ms 4299ms broadcast | follow@75158ms 2462ms follow | wide@77621ms 3454ms broadcast

legible(follow): {"card":{"name":"Pip","presence":null,"presenceState":null,"chip":null,"fade":"Fading","doing":"Standing around","energy":null,"following":true,"followButton":true,"sent":null,"messageState":null,"stateText":null,"ack":null,"result":null,"replies":[],"error":null,"thread":null,"view":"card"},"bubbles":[{"soulId":"s_6021854a99","name":"Pip","line":"Standing around","card":null,"chip":null},{"soulId":"s_d0d67e0f21","name":"Mira","line":"Standing around","card":null,"chip":null}],"signs":[],"toasts":[{"cls":"warn","text":"A Soul’s chosen look could not be composed; a simple figure marks its position."}],"roster":["Open Mira (agent away)"],"arrival":null,"newSoul":true,"viewer":{"mode":"follow","selection":"s_6021854a99","presentation":"live","following":"Following Pip"}}

snapshotSoul(Pip, admin): {"t":"2026-10-25T03:29:32.638Z","mono":81243,"soulId":"s_6021854a99","name":"Pip","tick":44172,"place":"field","placePath":["Green field","World"],"pos":{"x":0,"z":0,"region":"field","src":"owner"},"posture":"standing","activity":"idle","doing":"standing around","mood":"curious","needs":{"energy":43.99576388889279,"hunger":62.90027777784327,"company":80.96458333329153,"restlessness":67.72618055565208},"near":[{"id":"h_d0d67e0f21","who":"Mira","distance":"here","doing":"idle"},{"id":"punt-e_474462fa-14e506","who":"e_474462fa rowing punt","distance":"far","doing":null},{"id":"e_686d8418","who":"knoll","distance":"far","doing":null},{"id":"e_993f2f0b","who":"bench","distance":"far","doing":null},{"id":"e_c7a888a3","who":"cottage","distance":"far","doing":null}],"holding":null,"following":null,"riding":null,"fade":{"colour":"yellow","idleSeconds":2113},"lastAcceptedAt":1792896744833,"lastReceipt":{"id":"r_65282d3f-b822-4d4f-86ee-53eecdd4f679","soulId":"s_6021854a99","capability":"sit:here","phase":"completed","acceptedTick":99,"startedTick":99,"endedTick":2500,"code":null,"reason":null,"endedAt":{"place":"field","placePath":["Green field","World"],"pos":[0,0],"heading":90,"posture":"standing"}},"receipts":"[1 = lastReceipt]","agent":{"attached":true,"label":"eden 2.0.0","lastUsed":1792896800220},"inbox":null,"world":{"tick":44172,"souls":2},"http":{"public":200,"owner":200,"inbox":null,"world":200,"ms":19}}

godSlice(around Pip, r10): {"ms":12605,"ground":{"y":0,"slopeDeg":0,"water":null,"medium":"walk","room":null},"insideSolid":[],"footprints":true,"entities":[{"path":"plaza","def":"core-flag@1","dist":0,"layer":"decor","footprint":{"minX":-0.04,"minZ":-0.04,"maxX":0.04,"maxZ":0.04},"slots":1,"soul":false},{"path":"pip","def":"core/humanoid@1","dist":0,"layer":"solid","footprint":{"minX":-0.28,"minZ":-0.28,"maxX":0.28,"maxZ":0.28},"slots":1,"soul":true},{"path":"mira","def":"core/humanoid@1","dist":0.53,"layer":"solid","footprint":{"minX":0.51,"minZ":0.15,"maxX":1.07,"maxZ":0.71},"slots":1,"soul":true}]}

pageErrors: []
```

