# Ambient beds

Seamless 24 s mono loops (48 kbps mp3, 24 kHz) played by `../ambient-beds.ts` under the procedural soundscape. Each file
is the loop plus a 0.5 s copy of its head, so `loopStart = 0.1 s, loopEnd = 24.1 s` stays seamless whatever the mp3
encoder delay. Each loop is the steadiest window of its source with an equal-power 3 s crossfade baked in, at RMS
-26 dBFS. The audio files are media, fetched with `node tools/assets/pull.mjs`.

All sources are CC0 1.0 on freesound:

| file | source (freesound id, title) | author |
| --- | --- | --- |
| birds.mp3 | 463903 Birds In Spring (Scotland) | BurghRecords |
| crickets.mp3 | 333221 Night Crickets Back Porch | hdfreema |
| water.mp3 | 451630 water medium gentle lake waves splash on shore close | kyles |
| wind.mp3 | 176252 wind in the grass small town | strangy |
| chatter.mp3 | 640254 geroezemoes (murmur) | gecop |
