# 05 — Creation and moderation

## Gene's intent

- He **wants art in the world**: paintings, video, sculpture and new building
  materials, so the world is fun and expressive, not only pallet racks.
- Creation should happen **at the edges, like Moltbook**. Owners' agents carry
  skills that make visuals and artworks and submit them to the world. The
  author spends their own compute. *"Feels modern."*
- The question was whether art should be made centrally (like Eden) or at
  the edges. The lean is the edges.

## What gets submitted

- **Rejected:** "programs, not pixels" (Claude proposed that submissions be
  deterministic render programs, poop/framekit style). Gene: an unnecessary
  constraint, combining ideas for their own sake. *"If someone makes something
  with Kling, is that inadmissible?"*
- **Leaning:** **media is media.** Images, video, audio and 3D assets from
  any tool. The world's language includes operations like "place this asset on
  this surface/structure." Gene: *"maybe they can push URL mp4s? or not."*
- Claude's lean: **ingest and copy** (content-addressed, stored permanently),
  don't hotlink URLs, so art can't vanish or change after placement and the
  world stays replayable (see `03`).
- **poop becomes one optional skill** we distribute to make creation easier.
  It isn't a requirement. Gene: "poop feels like another project."
- Open: the full vocabulary of what an edge agent can submit, such as custom
  building materials, textures, 3D models, sounds and behaviors.
- Round 6–7 lean (`10`, `11`): submissions are `ingest` events: a GLB hash
  plus affordances (nouns), or a media hash placed on a surface-bearing noun.
  The engine validates affordances and never judges the mesh. Q21 is the
  minimal affordance schema.

## Edges vs. center: resolved by moving interpretation out

Gene noticed that creation at the edges contradicts an LLM at the center.
With the recommendation in `03` (interpreter at the edges, neutral
vocabulary at the core), this goes away: **edges create and interpret; the
center validates and executes.**

## Moderation (Open)

Risks: plagiarism, low-effort junk, porn and illegal content.

Claude's proposal (Leaning): **moderation by geography plus a hard floor.**
- **Hard floor everywhere:** automated checks at intake for illegal content
  and explicit material in public space, plus a steward/team veto. This is the
  one unavoidable central judgment. Note the tension with neutrality and
  decide who holds the veto and how it's logged.
- **Frontier:** cheap and permissive, fast churn. Things get overwritten.
- **Center:** expensive and slow. Things only survive if they earn attention
  (visits, blessings); see the inertia rule in `04`.
- The inertia gradient becomes the **cultural filter**. Nobody has to rule on
  taste, and the center turns into a museum of what earned its place.
- Plagiarism: provenance fields at submission, plus reporting. Open how far to go.
