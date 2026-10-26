# STATUS-C: director/ and personas/ (worker C, 2026-10-24)

## What works
- `personas/*.md`: 12 sheets (players newcomer, casual, social, spectator, storyteller, boundary, pinkteam, expert;
  creators first-timer, tinkerer, storyteller-god, pinkteam-god), 83 to 92 lines each. Each starts with a JSON frontmatter
  (`persona, role, axis, patienceSec, glanceSec, channelMix, maySeeSkill`) between `---` lines; `persona.mjs` strips
  it, so the persona never sees it. Sheets are second person, no internals (a test greps for them), and end with the
  strict JSON contract. The generator lives outside the repo; edit the sheets directly.
- `director/shown.mjs`: deterministic glance text (elapsed, screen path, legible, card, new chat, asked-so-far).
  Legible is cut to 1500 chars (head), chat to 2500 (tail, newest kept). Card text never shows ids.
- `director/persona.mjs`: `PersonaSession({runDir, seat, sheet, model, setting, skillPath?, callModel?})` with `step`
  and `finalRating`. One `claude -p` session per persona; the first call sends the sheet, the setting and glance 1, and
  later calls `--resume`. On a parse failure it nudges once ("JSON only"), then falls back to
  `{say:null, waitSec:20, parseError:true}`. If the first call fails, the next step starts a fresh session. Each step
  writes `turns.jsonl`, `shown/<n>.json` and `shown/<n>.png`, plus `sheet.md` and `session.json`. Only `expert` gets
  the skill file (copied to `shown/skill.md`).
- `director/director.mjs`: `runPlay({runDir, scenario, world, seats, god, observer, owner, clock?, personaFactory?,
  quotaCheck?, seed?, pollSec?})`.
  - Modes: persona mode, and scripted mode (shown bundles are still captured).
  - Seats: each player seat gets its own RNG (`seed+i`). The god seat is driven the same way.
  - Requests: each delivery opens evidence. A request closes on its card result, at `max-turns`, at its budget
    (90 s if quick, else 180 s; `director.budgetSec` (number or `{quick, default}`) or a script entry's `budgetSec`
    overrides), or at run end or quota stop.
  - Rails: the quota check runs every 5 min, and everything stops at `durationSec`.
  - Logs: `decisions.jsonl` (the director's log), `requests.jsonl` (closures), `desires.jsonl` and `ratings.json`.
- `director/fakes.mjs`: virtual clock, fake seat, owner, observer (camera writes a 1x1 PNG, evidence records) and
  persona.

## Tests
`node --test tools/playtest/director/`: 21 tests, about 5 s wall, no world and no model.

Real check, one call, about 19 s: `node tools/playtest/director/real-step.mjs newcomer`. It uses
`fixtures/shown-newcomer-1.json` and `fixtures/shot5-metal.png`.

## Real persona step (newcomer, opus, fixture glance at 40 s)
```json
{"say":{"channel":"card","text":"hi pip!! where are u? go jump in the boat!"},"waitSec":20,
 "thought":"ooh a little pond with a boat, cute, but i dont see pip anywhere and it says he's away?","rating":null,"desires":[],
 "complaints":["my assistant said pip lives in the world now but i cant see him anywhere, the card just says away",
  "theres a weird orange message at the bottom about a look not working, no idea what that means"],"quick":true,"done":false}
```
The persona opened the screenshot: it names the boat, the pond and the orange toast. A second step resumed the same
session and the persona remembered its card note. It switched to chat ("i dont see pip anywhere?? …") and logged the
desire "i wanted pip to jump in the boat but i cant even find him". Valid JSON both times, with no retry.

## Findings for the coordinator (please act)
1. **CLAUDE.md leak.** A `claude -p` call whose cwd is under `~/Eden` loads ancestor and user CLAUDE.md, even with
   `--setting-sources project`; a probe quoted `~/.claude/CLAUDE.md`. Run folders under `<team>/playtest/runs/`
   would therefore leak Eden internals into seats, the reviewer and personas.
   - Personas are safe: their cwd is a fresh `os.tmpdir()` dir.
   - Probe result: `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` in the env suppressed it, and so did a cwd outside `$HOME`.
   - Suggested fix: set that env in `lib/claude-p.mjs` and in the seat adapters, or put seat folders outside `~/Eden`.
2. **Permission rule form.** An absolute path in a permission rule needs `//`. `Read(/abs/**)` is denied (probed), so
   `allowedTools` is `[`Read(/${absShownDir}/**)`]`, which gives `Read(//…/personas/<seat>/shown/**)`.

## Assumed interfaces (code against these or tell me)
- `observer.camera(seatId) → {shot(path), legible()}`; `observer.cameras[seatId]` also works.
- `observer.evidence.openRequest({runDir, seat, soulId, requestId, text, channel, sentAt, messageId}) → {sample?,
  close({cutoffReason})}`.
- `seat.renderedChatSince(n) → {text, lastTurn}` or a string. Optional on the seat: `seat.turnCount` (function or
  number); `seat.soulId`, `identity`, `soulName` (or `seat.info.*`).
- God seat: `chat`, `sendGodCard({text}) → {messageId}`, `cardView()`.
- `owner.cardView` result is read loosely: `{latest|message: {id|messageId, text, state, ack|ackText,
  result|resultText}, messages?, presence, queued}`.
- From the world: `world.name` (or `slug`), and `world.skillPath` for the expert.
- Glance range precedence: `seat.glanceSec`, then the sheet, then `scenario.director.glanceSec`.

## Glue needed against the committed arena/observer (checked at the end)
- `Seat` has no `renderedChatSince` or `turnCount`. The director needs one of them over the adapter's `renderChat`.
  It already reads `seat.info.soulId` and `seat.info.ownerIdentity`.
- The director calls `seat.noteRequest()` on each delivery, if the seat has it.
- `sendGodCard` and `godCardView` are module functions that take `{base, text}`. The director wants `sendGodCard({text})`
  and `cardView()` methods on the god seat object: wrap them.
- The observer exports `openCamera(...)`, not `observer.camera(seatId)`. Pass
  `{camera: (id) => followCams[id], evidence: {openRequest}}`.
- `owner.mjs` `sendCard` and `cardView` match as they are.

## Stubbed or not done
- Not run against the real arena or observer, which do not exist yet.
- Chat-channel requests close when the card result changes after the chat turn, otherwise at max-turns or budget.
  Nothing else signals a chat result.
- A chat turn still running at the end is not awaited (`summary.seats[id].pendingChatTurns`); seat stop belongs to
  close.
- `finalRating` is skipped on a quota stop.
- A glance comes early when the card or chat changes, but no sooner than the sheet's minimum gap.
