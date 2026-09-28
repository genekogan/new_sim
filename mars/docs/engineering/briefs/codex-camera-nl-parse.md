# Codex brief: natural-language camera directions → `CameraDirection`

Branch `codex/camera-nl-parse` · worktree per CODEX.md §1 (`TOPIC=camera-nl-parse`) · ETA (estimate): 4–6 h of Codex
work · report: `docs/engineering/briefs/codex-camera-nl-parse.REPORT.md`.

## Why

Owner feedback §11: Gene directs the camera in sentences, such as "pan across Chiba with the sunset in the
background". Today a director, an LLM or a person, must write typed `CameraDirection` objects. The engine then:
- resolves the names;
- computes the trajectory;
- simulates it against the take and self-corrects (`engine/camera/{direct,synth,solve,correct}.ts`,
  CAMERA_DIRECT.md).

The missing layer is **sentence → `CameraDirection`**: a pure, deterministic parser that either produces a
schema-valid direction or refuses with a structured question. It never guesses.

## Context to read first

1. `docs/engineering/CODEX.md`, all of it. §7: the schema is **frozen**.
2. `docs/engineering/CAMERA_DIRECT.md`:
   - §1: the vocabulary, verb semantics, and **Gene's four sentences as data**. These are exactly the objects your
     tests must produce.
   - §2: the resolver. Name → entity / assembly / region / fixture / group matching is **not** your job, but your
     `subject.ref` strings must be what `resolveSubject` matches: ids, labels or query words. Its refusal shape
     (`camera.direct.ambiguous` with `question` + `candidates`) is the model for yours.
   - §2 "Context checks" and §7: what the engine refuses later (sun below horizon, not sunset, incompatible verb
     + interior). Do not duplicate those checks. Parse what was said.
3. `viewer/engine/camera/direct.ts`. `cameraDirectionSchema` (line 62, zod strictObject) and the type
   `CameraDirection` (line 73): `label?`, `subject`, `motion` (discriminated on `verb`, one of the 9 `MOTION_VERBS`),
   `duration?` / `speed?` (not both), `at?`, `framing?`, `context?`, `fov?`. **Import it; never change it.**
4. `viewer/engine/actions/types.ts`: `Diagnostic { code, message, subjects, at }`, the refusal convention.
5. `docs/engineering/ENGINE_GUIDE.md`. `engine/camera/` is engine core: strip-types TS, zod only, no host
   `Math.*` transcendentals or `Math.hypot` (the scan in `engine/test/core.test.ts` covers `engine/**`), no `**`,
   and no `Date` / `Math.random`.

## Files owned (create / edit only these)

- `viewer/engine/camera/parse.ts` (new).
- `viewer/engine/test/camera-parse.test.ts` (new; add more `camera-parse-*.test.ts` files if you split them).
- `docs/engineering/briefs/codex-camera-nl-parse.REPORT.md`.

## Files forbidden (Claude-owned; read only)

- `viewer/engine/camera/*` other than `parse.ts`: `direct.ts` (the frozen schema), `synth.ts`, `solve.ts`,
  `correct.ts`, `index.ts`, `track.ts`, `take-sampler.ts`, … Do **not** re-export `parse.ts` from `camera/index.ts`;
  the lead wires it.
- `viewer/engine/api/**` (registry, MCP tools, schemas). Exposing the parser as `engine_direct_camera { sentence }`
  or a new op is the lead's integration.
- `viewer/app/studio/**` (the Direct-camera panel), `viewer/app/lab/**`, and all other `viewer/engine/**`,
  including take, campus, spatial, locomotion, construction and body.
- `viewer/e2e/**`, and every `docs/engineering/*.md` other than your REPORT.

**Pin rule (CODEX.md §4):** never edit a pinned hash. If one moves, STOP, REVERT, REPORT. A new pure module moves
none. If a camera test changes, you touched something you should not have.

## Deliverables

`engine/camera/parse.ts` has pure functions only (no I/O, no world access, no clock):

```ts
export type ParseVocab = {                         // optional, supplied by the caller from its SemanticWorld
  regions?: string[]; assemblies?: string[]; fixtures?: string[]; groups?: string[];
};
export type ParseRefusal = {
  code: 'camera.parse.ambiguous' | 'camera.parse.missing' | 'camera.parse.unknown-verb'
      | 'camera.parse.deictic' | 'camera.parse.conflict' | 'camera.parse.invalid';
  message: string;                                 // names the words at fault
  question?: string;                               // what to ask back ("which activity?")
  candidates?: string[];                           // readings / values it could not choose between
  span?: [number, number];                         // character range in the sentence
};
export type ParseResult =
  | { ok: true; direction: CameraDirection; notes: string[] }   // notes: defaults left to the engine, words ignored
  | { ok: false; refusal: ParseRefusal };
export function parseSentence(sentence: string, vocab?: ParseVocab): ParseResult;
export function parseSentences(text: string, vocab?: ParseVocab): ParseResult[];   // "…, then …" / sentence split
```

The field names above are a suggestion. Keep the semantics. **Do not name anything `parseDirection`:** `direct.ts:404`
already exports `parseDirection(input: unknown, index)`, the zod validation of a typed direction. Reuse it for the
schema check.

Requirements:
- Every `ok` result passes `cameraDirectionSchema.parse` (assert it in the tests via `cameraDirectionSchema` or `direct.ts`'s `parseDirection`).
- **Structured refusal instead of guessing:**
  - two readings → `ambiguous`, with both in `candidates`;
  - a required value missing (e.g. an orbit with no angle and no "full circle") → `missing`, with a `question`;
  - "this" / "that" with nothing to bind → `deictic`;
  - "pan left … to the right" → `conflict`;
  - both a duration and a speed → `conflict`. The schema forbids both.
- **Numbers and units:**
  - degrees: "270°", "270 degrees", "three quarters of a turn", "a full circle / revolution" = 360;
  - durations: "over 2 minutes" = 120, "for 30 s", "in ten seconds";
  - speeds: deg/s for pan, tilt and orbit; m/s for dolly, crane, push_in, pull_out and fly_through (the schema's
    `speed` semantics);
  - start time: "at 1:30" = 90.
- **Vocabulary:** map verbs and synonyms onto the 9 motion verbs (pan, tilt, dolly, orbit / "revolve" / "circle",
  crane / "rise", push_in / "move in", pull_out / "back away", fly_through / "go inside" / "fly into", hold /
  "look at" / "watch"). Map framing words (wide, medium, close; "rule of thirds left"), `context.sunBehind` /
  `sunset` ("with the sunset behind / in the background"), `context.interior` + `lookAt` ("inside the kitchen …
  face the sink"), and `fov` ("wide lens" is **not** a fov; do not invent numbers).
- **Subject kind:** with a `vocab`, a phrase that names a known region / assembly / fixture / group gets that kind.
  Without one, use the rules the §1 table implies (a named place → `region`; racks / "pallet racks" / bay →
  `assembly` `rack bay`; people doing X → `group` with the activity word). Anything else → `ambiguous` over
  the kinds.
- Deterministic: same input, same output, on every host. No locale-dependent calls (`toLocaleLowerCase`, `Intl`).

## Tests (acceptance)

`engine/test/camera-parse.test.ts` (runs in `npm run test:engine`):
- **Gene's four sentences**, deep-equal to the CAMERA_DIRECT §1 objects:
  1. "do a pan across Chiba with the sunset in the background" →
     `{subject:{kind:'region',ref:'chiba'}, motion:{verb:'pan'}, context:{sunBehind:{sunset:true}}}`.
  2. "do a 270° revolution around the main pallet racks over 2 minutes" →
     `{subject:{kind:'assembly',ref:'rack bay'}, motion:{verb:'orbit',degrees:270}, duration:120}`.
  3. "go inside the kitchen and face the sink" →
     `{subject:{kind:'region',ref:'kitchen-interior'}, motion:{verb:'fly_through'},
     context:{interior:'kitchen-interior', lookAt:'sink'}}`. State in the REPORT how "kitchen" becomes
     `kitchen-interior`: from `vocab`, or a documented rule.
  4. "look at this crowd of people having this activity" → **`camera.parse.deictic`** refusal asking which
     activity, because "this" has no referent. The same sentence with the activity named ("look at the crowd of
     people eating") → `{subject:{kind:'group',ref:'eat'}, motion:{verb:'hold'}}`, with `ref` from `vocab.groups`
     when given.
- **Sentence → object table:** ≥ 30 more cases covering every verb, every unit form above, framing, `at`, `fov`,
  and multi-direction text via `parseSentences`.
- **Refusal cases:** ≥ 10 deliberately bad or ambiguous sentences, each asserting `code`, `question` / `candidates`
  and `span`. Examples: "orbit the racks" with no angle; "pan left to the right"; "over 2 minutes at 10 deg/s";
  "zoom in"; "look at that".
- **Schema round-trip:** every `ok` output passes `cameraDirectionSchema.parse`.
- **Purity / determinism:** the same input twice gives deep-equal output; the module imports only `zod`, `direct.ts`
  types and `core/`.
- `npm run test:engine` and `npx tsc --noEmit -p .` green, and every existing camera test and pin unchanged.
- Optional, reported only: run the four `ok` outputs through `resolveSubject` (`direct.ts:300`) / `directCamera`
  (`synth.ts:1043`) on the existing `camera-direct` test fixtures to show the resolver accepts the refs. Do not edit those tests.

## Report format

CODEX.md §8, plus:
- the full sentence → object table (as run);
- the refusal table;
- a list of phrasings you deliberately refuse, with the reason;
- what the lead should add when wiring `parse.ts` into `engine_direct_camera` or the studio panel.
