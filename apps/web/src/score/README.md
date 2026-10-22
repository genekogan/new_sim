# Isolated development Score adapter

`runtime.mjs` is generated from PM's frozen Score3b806f2/Tone15.1.22 input by
`tools/score/import-input.mjs <explicit-extraction>`. Seven source blobs are checked
against the import manifest before wrapping in a private Sim namespace and an
explicit Tone parameter. Five global root expressions change; all other source
and comments stay intact. `PROVENANCE.json` identifies transformations and hashes;
`SOURCE-NOTICE.md` preserves the adoption commission without assigning a license.
No Tone dependency or root wiring is imported into the web application here.

`createComposition({pieceId, seed})` composes Starfield or Zoning Board sequentially
with independent retained state. Returned frames are copies. It ends after64
cycles; this is a bounded development performance, not an endless radio station.
`composeAt({pieceId, seed, cycle})` replays every preceding cycle to reconstruct
memory. It neither seeks nor starts audio. Arbitrary checkpoint restoration,
canonical world cues, real-time synchronization and humanization are not qualified.

Run the distinct pure composition proof with:

```
node tools/score/composition-proof.mjs /absolute/reviewed/extraction/sim-score
```

Final proof:26 checks, both pieces/two seeds/64cycles compare original VM source
with owned wrapper and independent composer,36701 events,max state4241 bytes.
Cycle31 replay matches sequential memory; stateless Zoning Board cycle1 diverges.
Caller output mutation does not affect future frames. Invalid pieces/seeds/cycles
fail, global Sim survives, input source hashes stay unchanged, no Tone access or
local Math.random is allowed. Receipt `data/game-score-composition-proof.json`.

Two prior fixture failures remain in `data/game-score-composition-attempt{1,2}.json`
and their hypotheses: first retained the late-frame expected value by reference
then deliberately mutated it; second chose a solo cycle with no demonstrated
memory divergence. Final fixture clones its expected frame and checks A2 reuse
of A1's head. Adapter source did not change between those attempts. No passing
rerun. JavaScript syntax and web TypeScript checks pass; no audio/browser test.

Next: a separate audio controller with guarded async startup, one playback owner,
explicit Tone/resource disposal, gesture/mute/volume/world switch. Actual Tone
must resolve from the unchanged frozen artifact for the isolated qualification;
PM owns root/distribution wiring. Two actual listeners, late-join/transition/drift,
viewer/phone performance and CoreG003 cue/clock precede shared radio or beat claims.

## Actual Tone development preview

`createPreview(Tone, {onState})` in `preview.mjs` requires a current browser user
activation for each local preview start. It plays only the first1–8 seconds of a
qualification piece's first cycle; grid/swing are preserved, local random
humanization is deliberately omitted. Its private output gain supports mute and
volume. Ownership is exclusive per explicit Tone handle, with generation checks
after Tone.start and instrument readiness. Stop/dispose cancels its timer and
calls dispose on registered nodes; it does not close the shared audio context.
It never starts/stops/cancels Tone's global Transport and uses no global Sim.

New actual frozen Tone15.1.22 browser fixture passed13 checks:
`.e2e/runs/score-audio-2026-10-04T08-35-05.356Z/index.html`. Initial module autoplay
was refused without nodes; trusted button start produced nonzero WebAudio meter
signal; owner switch cleared old registered graph; mute measured -Infinity and
unmute restored signal; stop released the graph; disposal during actual Tone.start
held behind a fixture gate prevented late ownership/nodes. Global Transport stayed
stopped and application Sim stayed intact. No browser errors. Two screenshots
inspected; own4962/browser closed,$0. Frozen Tone bundle hash matches PM manifest.

The first fixture failed because Playwright evaluate supplied synthetic user
activation; corrected initial call runs in loading module before button gestures.
Receipt08:34:31FAIL remains, preview source unchanged; no passing rerun. Syntax/
web TypeScript checks pass. The plain standalone fixture UI is not the product UI.

This does not measure hardware audibility, musical quality, volume attenuation
ratio, full graph/AudioContext leak count, cancellation during post-construction
instrument readiness, natural clip-end timer or autonomous transitions. It does
not qualify actual route lifecycle, mounted viewer/mobile performance, two audio
listeners, late join, drift, canonical shared cue/clock or radio. Product root
Tone wiring/distribution remains PM's. Core's cue is still a prerequisite for
shared station and World beat claims.

## Resource-boundary final attempt

`tools/score/audio-resource-proof.mjs` records actual constructor identities,
PolySynth dummy/allocated voice parent edges, and forwarded disposal calls with
nesting/exceptions. Independent PM review identified four separately retained
dummy voices as the specific hypothesis; final attempt3 proves those identities.
Exact118 registered roots plus4 dummies dispose at cancellation/readiness rejection;
finite timeout also disposes5 allocated voices (127 observed objects total).
All direct disposal IDs match roots, children dispose through their real owners,
late readiness cannot revive playback, and prior ledgers survive later cases.

Final10 checks PASS at `.e2e/runs/score-resource-2026-10-04T10-06-33.639Z`.
Both earlier count-equality failures remainFAIL at09:52:36.068/58.800; no previous13
preview rerun or runtime change. A consumed-attempt marker prevents another run.
Readiness gates/rejection injected, actual frozen Tone unchanged. Diagnostic PNG
pending display is staleonState; object ledger is authoritative. No full internal
AudioContext leak, mounted-route/mobile/quality or synchronized-radio claim.

## Mounted local consumer

`MusicPreview.tsx` accepts an explicit reviewed `ScoreTone`, selected `worldId`
and display name. It owns its React player lifetime; a new world identity remounts
and cancels the previous instance, and unmount disposes it. Focus can release the
viewer's input through its existing hook. No Tone/global/script loader, public
cue, automatic playback or station endpoint is supplied by this component.
Normal boot placement and Tone distribution remain PM-owned integration work.

Human controls offer two named pieces, an8-second Listen sample, Stop, Mute and
bounded volume with explicit local-preview/loading/playing/error status. Piece
changes stop previous playback and require another click; late cancelled work
cannot update a replacement instance. `preview.d.mts` names the current binding.

Distinct mounted fixture `tools/score/mounted-preview-proof.mjs` uses an explicit
unchanged frozen input, actual React/LiveWorld/useSim/anonymous current-G Toy
server and WebAudio meter. Final15 checks PASS at10:32:41.102UTC. First10:31:35.609
FAIL retained: nested select label included option text; explicit Piece accessible
name corrected in component. No old13/10 rerun. Synthetic context/SPA route and
Tone startup delay/refusal qualify only this consumer lifetime. Actual startup,
mute/unmute, piece stop, old graph disposal, pending cancellation, retained viewer
canvas and loading-headline caller assertion pass; no native world routing,
real owners, mobile/device load, full AudioContext leak or shared-radio claim.

## World playlist

Lane S3 (2026-10-20). Gene: "music sucks. didn't we make better music? check the tone.js task for some of the music we
made and put those on a playlist." The music in every world page (new worlds and the old `/w/eden`) is
now a playlist of Sim Score pieces, replacing the sound layer's own generative `music` bed.

- **Source.** The vendored Sim Score in `vendor/sim-score/` (see "Vendored Sim Score" below; Tone.js pieces composed in
  the browser, no samples). `tools/score/build-playlist.mjs` builds `playlist/` from it: `engine.mjs` holds the nine engine
  files (theory, compose, instruments, more-instruments, conductor, then the optional phrasing, spc, dialogue, groove, in
  sim-score's `index.html` order) unchanged inside one function that takes Tone explicitly (`Sim` stays private, nothing
  plays on import), the playlist and `loadPiece(id)`; `pieces/<id>.mjs` holds each piece unchanged inside
  `register(Sim, Tone)`; `BUILD.json` records the source commit and a sha256 per generated file. Edit `PLAYLIST` in the
  builder and rerun it to change the playlist (sync reruns it too). Until 2026-10-22 an importer read `<sim-score-repo>`
  directly and bundled everything into one `playlist-runtime.mjs`.
- **Why these 12.** Gene's last word on Sim Score (Oct 4) asked for "more adventurous music and a bit more percussion"
  and named SimCity, Tetris, Brian Eno, F-Zero, Karate Kid, Knight Rider, disco subgenres and vaporwave; there is no
  later per-piece verdict, so the playlist is one round-three piece per named influence, in this order:
  Pixel Town (SimCity town theme), Downtown Rush (city-sim jazz funk), Neon Shibuya (future funk), Departure Lounge
  (Eno ambient), Line Clear (Tetris chiptune), Mirror Ball (Philly disco), Night Drive (synthwave), Plaza Mall (mallsoft),
  Grand Prix (F-Zero racing fusion), Magic Orbit (space disco), Montage (80s synth rock), Night Patrol (80s TV synth).
- **Player.** `apps/web/src/gen-mesh/music.ts`. The first piece is random per visit, then playlist order; each plays
  240 s, fades 4 s, and the next starts. Mute or music off (the speaker and note buttons bottom right; on a phone, in the
  HUD's More menu) stops it; on again restarts the current piece. A world's own `music` things stay quiet under it.
  Nothing in it follows the camera, so moving the camera never restarts a piece.
- **Cost.** Nothing at arrival: `tone` (about 341 KB) and the score `engine` are lazy chunks, not in `index.html`'s
  preloads, loaded only after the arrival is over, after the first gesture, with music on and sound unmuted, in idle
  time. Each piece is its own chunk (about 18 KB, 7 KB gzipped), fetched just before it plays; the next piece's chunk is
  fetched when the current one starts its 4 s fade (`__edenMusic.log()` shows `load`/`loaded` with the piece and
  `play` or `prefetch`). Tone owns its own AudioContext (its worklets); a gesture resumes it where a browser
  insists (iOS).
- **Proof.** `window.__edenMusic.state() / log() / level() / next() / trackSeconds(s)`; `score/playlist.test.ts` (all 12
  pieces register and compose); `tools/sound/camera-restarts.mjs` (60 s of camera drags: sound and music restarts).

### Vendored Sim Score (lane SCORE, 2026-10-22)

Sim Score stays Gene's own project (`<sim-score-repo>`, its own git repository); Sim keeps a checked-in copy so it builds,
tests and runs without it. `vendor/sim-score/` holds sim-score's `site/` (engine, pieces, catalog, the browser page) and
its Node lint harness (`tools/load.mjs`, `lint.mjs`, `score.mjs`), byte for byte, with `PROVENANCE.json` (source commit
and a sha256 per file). Never edit it: fix a piece in sim-score, commit there, and sync. To absorb a newer sim-score:

```
node tools/score/sync-sim-score.mjs <sim-score-repo> [commit]
```

It refuses a source with uncommitted changes and a vendored copy edited by hand, copies that commit's files, removes
the ones it dropped, rewrites `PROVENANCE.json`, and prints the pieces, engine modules and other files it added,
changed or removed. Lint the vendored pieces in place: `node vendor/sim-score/tools/lint.mjs <id ...> --cycles 32 --seed 7`.
The browser page runs from the copy too (`python3 vendor/sim-score/tools/serve.py 4802`; Tone comes from cdnjs).
