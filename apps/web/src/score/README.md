# Score: world music

Every world page plays a playlist of Sim Score pieces: Tone.js music written as code and composed in the browser, with
no samples. Sim Score is MIT licensed, © Gene Kogan (see `SOURCE-NOTICE.md`).

## Vendored Sim Score

`vendor/sim-score/` is a byte-for-byte copy of one Sim Score commit: its `site/` (engine, pieces, catalog, browser
page), its Node lint harness (`tools/load.mjs`, `lint.mjs`, `score.mjs`, `serve.py`), `README.md` and `COMPOSING.md`.
`vendor/sim-score/PROVENANCE.json` records the source commit and a sha256 per file. Never edit the copy: fix a piece in
the Sim Score repository, commit there, and sync:

```sh
node tools/score/sync-sim-score.mjs <path-to-sim-score> [commit]   # commit defaults to HEAD
```

The sync refuses a source with uncommitted changes and a vendored copy edited by hand. It copies the commit's files,
removes the ones it dropped, rewrites `PROVENANCE.json`, prints what was added, changed or removed, and rebuilds the
playlist. Lint vendored pieces in place with `node vendor/sim-score/tools/lint.mjs <id ...> --cycles 32 --seed 7`. The
browser page runs from the copy too: `python3 vendor/sim-score/tools/serve.py 4802` (Tone comes from cdnjs).

## Playlist

`node tools/score/build-playlist.mjs` builds `playlist/` from the vendored copy:

- `playlist/engine.mjs`: the nine engine files (theory, compose, instruments, more-instruments, conductor, then the
  optional phrasing, spc, dialogue, groove) unchanged inside `createPlaylistScore(Tone)`, which takes Tone explicitly and
  keeps `Sim` private; plus `PLAYLIST` and `loadPiece(id)`. Nothing plays on import.
- `playlist/pieces/<id>.mjs`: each piece unchanged inside `register(Sim, Tone)`, one chunk per piece.
- `playlist/BUILD.json`: source commit, playlist and a sha256 per generated file.

To change the playlist, edit `PLAYLIST` in the builder and rerun it. The builder prints any catalog "New pieces" id the
playlist leaves out. The current order is the "New pieces" family in catalog order, then twelve earlier pieces.

The player is `apps/web/src/gen-mesh/music.ts`. The first piece is random per visit, then playlist order; each plays
240 s, fades over 4 s, and the next starts. Mute or music off (bottom-right buttons; on a phone, the HUD's More menu)
stops it; turning it on restarts the current piece. A world's own `music` things stay quiet under it, and moving the
camera never restarts a piece.

Nothing loads at arrival. `tone` and the score engine are lazy chunks, loaded after arrival, after the first gesture,
with music on and sound unmuted, in idle time. Each piece chunk is fetched just before it plays; the next one is
prefetched during the current fade. Tone owns its AudioContext; a gesture resumes it where the browser requires (iOS).

Checks:

- `window.__edenMusic.state() / log() / level() / next() / trackSeconds(s)` in the browser (`state().fetched` lists the
  piece chunks fetched so far).
- `playlist.test.ts`: every piece registers once and composes its first cycles under an inert Tone, the optional modules
  load, the vendored copy matches its provenance, and the generated chunks match a fresh build.
- `node vendor/sim-score/tools/lint.mjs <ids> --cycles 32 --seed 1` (also seeds 7 and 12345) over the playlist.
- `tools/sound/camera-restarts.mjs`: 60 s of camera drags, counting sound and music restarts.

## Other modules

- `station-connection.mjs` and `server-clock.mjs` follow a world's music station over the existing connection and
  estimate the server clock from ping/pong (used by `useSim.ts`). They open no sockets and start no audio.
- `runtime.mjs`, `composition.mjs`, `preview.mjs` and `MusicPreview.tsx` are an older development adapter: an earlier
  Sim Score revision (`PROVENANCE.json`) wrapped in a private namespace with Tone passed explicitly, a bounded 64-cycle
  composer (`createComposition`, `composeAt`) and a gesture-started local preview with mute, volume and disposal. The
  product does not mount them.
