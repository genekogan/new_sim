# R6 — Spore: the game, the sharing, the world state, and what Sim should take from it

> Written 2026-10-02 from web research on that day. It builds on doc 10, which already covers
> Chris Hecker's animation retargeting ("Spore at the level of verbs"), and does not repeat it.
> Every fact carries a URL. **[claimed]** marks something I could only find in a forum,
> a fan wiki, search-engine summaries or a single secondary source and could not check. The
> "live API" figures come from Spore's own public REST endpoints, which still answer, read at
> about 20:00 UTC on 2026-10-02. "Sim" means the shell described in `<old-sim-repo>/docs/STATUS.md`
> (as of 2026-10-01) and the design in docs 02, 04, 05, 10, 18 and 19.

## 0. The short version

Spore (Maxis/EA, September 2008) had five short games in a row: cell, creature, tribe,
civilization, space. Each sat on top of a set of easy editors that turned a few kilobytes of
"recipe" into an animated creature, building or ship. The editors were the triumph and the
games were the disappointment. Its own leads said so: Hecker said "we totally dropped the
ball" on gameplay, and Soren Johnson said "Spore is actually a game about creativity." The
sharing model was "massively single-player". Every creation was uploaded to a central
Sporepedia and copied into other players' private galaxies, where those players' local AI ran
them. That model let a single-player game feel inhabited, and it cost almost nothing to run.
Eighteen years later the server is still up: 191.8 million uploads, 5.7 million accounts and
about 250 new uploads a day. People still make creatures there, but very few play the game
through. For Sim, three things matter most. (1) The moment of making something, and seeing it
come alive, was the product. Ship it first. (2) Spore's deepest failure was that the shape you
made did not change what you could do. Sim can fix this: derive a Soul's verbs (cards) from
its body. (3) Spore stored a tiny canonical recipe, generated the depiction, tracked lineage
and kept a public API, and that is why its archive survives. Sim's kernel already follows the
same pattern, and it should extend it to Souls, cards and made things.

## 1. Gameplay: five stages, their loops, verbs and editors

### 1.1 The stages

| Stage | What it plays like | Core loop and verbs | Currency | Editor | How it ends |
|---|---|---|---|---|---|
| **Cell** | 2D top-down arcade, "a very analog, very fluid version of Pac-Man" (Wright, 2005) | swim, eat plants or cells, avoid being eaten; ram with spikes, spit, shock | DNA points from eating | Cell editor (six part types: jets, fins, spikes…) | find a brain, grow until the evolution meter fills; the creature editor opens and asks for legs |
| **Creature** | 3D action/MMO-style soloing | befriend (sing, dance, charm, pose) or hunt (bite, charge, strike, spit) other species; collect parts from allies, kills and bones; call a mate and re-edit at the nest | DNA points | Creature editor | brain grows enough; species enters Tribal and **its design becomes permanent** |
| **Tribal** | light real-time strategy, up to 12 members | gather food, build huts, ally (play instruments) or conquer (weapons) five neighbouring tribes | food | Tribal outfitter (clothing/accessories only) | all five tribes allied or conquered; five heads on the totem |
| **Civilization** | scaled-up RTS on one planet | capture spice geysers, build, take cities by force, religion or purchase; superweapons | Sporebucks | Building and vehicle editors (land, sea, air), city planner | control the planet |
| **Space** | open galaxy sandbox, "longer than all the other stages combined" (IGN) | fly, contact, trade spice, ally, war, colonise, terraform, abduct creatures, hunt rares, run missions | Sporebucks, spice | Spaceship editor, planet colouring/sculpting tools | no hard end; the main goal is the galactic core |

Sources: stage mechanics and the Pac-Man line are from the 2005 GDC report
(https://www.gamedeveloper.com/design/gdc-2005-report-the-future-of-content, 2005-03-15) and
Wikipedia (https://en.wikipedia.org/wiki/Spore_(2008_video_game)). Wikipedia supplies the
transitions ("once the microbe has found a brain… the creature editor appears, prompting the
user to add legs"; "when all five tribes are allied or conquered"; "the species' design becomes
permanent"), the 12-member tribe and the superweapons. IGN's review (Jason Ocampo, 2008-09-04,
https://web.archive.org/web/20080905080313/http://pc.ign.com/articles/907/907454p1.html and
pages `p2`, `p3`) gives the cell parts, the evolution meter, food as the only tribal resource,
four instruments, the totem pole and capture by "force, conversion, or buying". Eurogamer's
review (Tom Bramwell, 2008-09-04, https://www.eurogamer.net/spore-review) gives singing and
dancing versus striking and charging, parts collected from "allies, defeated enemies and
discarded remains", and conquering the planet. The space-stage verbs are in StrategyWiki
(https://strategywiki.org/wiki/Spore/Space_Stage).

The galaxy holds "around 500,000 planets… orbiting around 100,000 stars (including Earth and
its star, Sol)" (Wikipedia, above).

### 1.2 Verbs came from parts, not from shape

The creature editor did give bodies verbs, but through part tags, not geometry. Each mouth,
limb or ornament carried ability levels. The Sporepedia still stores them per creature. A
creature uploaded today (`Nuladon`, 2026-10-02) has this record on the live API: `bite 2,
charge 2, strike 1, spit 0, sing 4, dance 3, gesture 3, posture 2, sprint 2, stealth 0,
glide 0`, `footcount 2, graspercount 2`, `herbivore 1`, `cuteness 56.9, meanness 8`,
`cost 965` (http://www.spore.com/rest/creature/501124937503). No part is mandatory except a
mouth. Legless creatures slither, and armless ones cannot manipulate objects (Wikipedia,
above). How long the legs are, or what the body looks like, makes no difference. Johnson: "the
player's creativity in designing the creature's shape has no impact on actual gameplay"
(https://www.designer-notes.com/?p=654, 2013-09-30). The tag system also put expression and
optimization in conflict. Eurogamer: "the Creature Creator doesn't let you make exactly the
creature you want because your survival depends on parts that spoil the look" (above).

### 1.3 Carry-over between stages

Two things carried over. The first was **diet**: how you ate as a cell fixed which mouths the
creature could use. The second was **consequence traits**: "at the end of each phase, the
player's actions cause their creature to be assigned a characteristic… Each phase has three
consequence traits, usually based on how aggressively or peacefully the phase was played"
(Wikipedia, above). The traits combined into one of about ten space-stage archetypes, and
experienced players planned the first four stages to reach the archetype they wanted
(**[claimed]**: SporeWiki via search summaries, https://spore.fandom.com/wiki/Philosophy;
Fandom refused direct reads). After a first playthrough you could start a new planet at any
stage, but then you lost the timeline and the traits (IGN, page 3, above).

Eurogamer's reading became the standard one: the first four stages are "an elaborate
combination of character-creator and tutorial masquerading as a game" for space. They were
"simplistic (and difficult to fail)" and "too fleeting" (above). bit-tech, ten years on: "a
really long tutorial" (2018-09-25, https://bit-tech.net/features/gaming/pc/10-years-on-spore/1/).

### 1.4 The editors and the procedural machinery

Wikipedia counts **18 editors** across the game and its expansion: cell, creature, tribal
outfitter, building, three vehicle editors, spaceship, captain outfitter, adventure creator,
planet tools and others (above). The machinery underneath was:

- **Recipes, not meshes.** Hecker chose implicit surfaces for creature skin partly "because we
  need to keep the 'recipe' for the creature very small so we can transmit it over the wire"
  (liner notes, https://chrishecker.com/My_Liner_Notes_for_Spore). Wright in 2005: "We can get
  five megabytes of content into 1 kilobyte" (GDC report, above). Wikipedia: "only a couple of
  kilobytes per item transmitted" (above).
- **Animation authored once for bodies nobody has seen.** "Most of the content in the game will
  be made after the game ships… my creature might have two arms and one leg, yours might have no
  arms and seven legs, and two mouths"
  (https://chrishecker.com/How_To_Animate_a_Character_You%27ve_Never_Seen_Before, GDC 2007).
  The SIGGRAPH 2008 paper records motion "in a morphology-independent form" and turns it into
  IK pose goals at runtime
  (https://chrishecker.com/Real-time_Motion_Retargeting_to_Highly_Varied_User-Created_Morphologies).
  Doc 10 covers this.
- **Accidents kept as features.** The skin is one implicit surface, so limbs placed close
  together grow webbing. Players used this on purpose, so the team left it in. Hecker's phrase
  for it was "Bugs + Player Creativity = Features" (liner notes, above).
- **Scale.** More than 80 people worked on it near the end, over more than five years (liner
  notes, above). The New York Times put the budget at a projected $20 million in 2006 (cited in
  https://en.wikipedia.org/wiki/Development_of_Spore).

*For Sim:* the creature record above is the nearest precedent for a **capability map**
(doc 10): counts of feet and graspers, plus levels for a fixed set of verbs. Spore's verb list
was closed (about a dozen). Sim's card vocabulary is open, so the capability map can decide
*which* cards a body may play rather than *how strong* it is at a fixed few.

## 2. How people interacted

### 2.1 With the game: a toy first

Reviewers kept reaching for "toy". IGN opened with "Maxis excels at making software toys rather
than games… a toy is something that you tinker with, whereas a game is something with a
narrative, goals, or a way to win" and closed with "an amazing product, it's just not quite an
amazing game" (above). Wright said the shallowness was a choice, at launch: "We're taking some
hits in the press for the depth of levels. Shallow or not. That was pretty much intentional",
and "It's interesting to have the player create the story in contrast to us trying to impose a
story on the player" (GamesBeat, 2008-09-07,
https://gamesbeat.com/qa-with-will-wright-on-the-launch-of-spore/). Fourteen years later his
view had changed. An Axios headline reads "Will Wright: Spore should have been multiple games",
and quotes him saying it "was much more of a toy than a game"
(https://www.axios.com/2022/11/01/will-wright-spore-video-games, 2022-11-01; **[claimed]**: I
saw only the headline and a search excerpt, because the page refused direct reads).

The editor shipped before the game. The **Spore Creature Creator** went on sale on 2008-06-17
($9.95, with a free version holding 25% of the parts) and could upload videos straight to
YouTube (https://en.wikipedia.org/wiki/Spore_Creature_Creator). Players made over a million
creatures in the first week (MCV, https://mcvuk.com/business-news/spore-creature-creator-hits-1m/;
WorthPlaying, 2008-06-25,
https://www.worthplaying.com/article/2008/6/25/news/52393-spore-registers-one-millionth-creature-created/),
and more than three million by the launch three months later (IGN page 2, above; Wright to
Pocket Gamer, 2008-09-03,
https://www.pocketgamer.com/spore-origins/live-from-london-will-wright-talks-spore/). Wright
said in that interview that "the community is almost becoming more important than the game
itself".

Hecker's favourite moment says what the toy was: "when you first attach a leg or arm or mouth to
the torso in the creature editor, and your creature comes alive and turns to look at its new
limb or roars with its mouth" (liner notes, above).

### 2.2 With each other: "massively single-player"

There was no shared session. Wright's term was "a massively single-player game". In 2008 he
explained that MMOs stop players from being able to "cheat or otherwise shape the world—or blow
up entire worlds with these huge powers" (Pocket Gamer, above). In 2005: "All the other
creatures in the environment are coming from other players. They are asynchronously sent [from
game servers] to your computer" (GDC report, above).

The parts of the system:

- **Automatic upload.** Anything made in an editor was published to the Sporepedia
  (https://en.wikipedia.org/wiki/Spore_(2008_video_game)).
- **"Pollination".** The game downloaded others' creations into your galaxy. What arrived was
  steered by your buddies, the **Sporecasts** you subscribed to, and tags. Eurogamer: Sporecasts
  "populate your galaxy with the best of someone else's discoveries, ever the hook" (above).
  bit-tech's preview (2008-02-13,
  https://www.bit-tech.net/reviews/gaming/pc/spore_hands-on_preview/2/) said the system lets
  "the community itself… decide what is and isn't appropriate". It also said a whole Sporecast
  weighs about 8 KB. The SIGGRAPH 2009 talk on the Spore API lists "tagging, ratings…
  Sporecasts, buddy systems, subscriptions" (https://history.siggraph.org/?p=148956). The exact
  priority order among buddies, Sporecasts, ratings and Maxis picks is **[claimed]**; the fan
  wiki page "Pollination" would not load.
- **A per-player content toggle**: "'no user generated content', 'official Maxis-approved
  content', 'downloadable friend content', and 'all user-created content'" (Wikipedia, above).
- **Reports from other players' worlds.** "Via the in-game 'MySpore Page', players receive
  statistics of how their creatures are faring in other players' games, which has been referred
  to as the 'alternate realities' of the Spore metaverse" (Wikipedia, above).
- **Creations as portable images.** A creation's PNG thumbnail carried the full recipe in its
  low bits. Drag the picture into the game and the creature loads, so creations spread by email,
  Flickr and forums (Ned Batchelder, June 2008,
  https://nedbatchelder.com/blog/200806/spore_creature_creator_and_steganography). Community
  tools still decode these PNGs today (https://github.com/Spore-Community).
- **A public API** (February 2009): REST and XML access to creations, users, Sporecasts and
  stats, used for aquariums, tournaments and widgets (Shacknews,
  https://www.shacknews.com/article/57447/maxis-releases-spore-api; Venus Patrol,
  https://venuspatrol.com/2009/02/data-mashers-at-the-ready-maxi/). It still answers (§5.4).
- **Curators.** A typical Sporecast survives on the live API: *THE KNIT COLLECTION*, 1,424
  creations, 4,970 subscribers, last updated 2010-05-28
  (http://www.spore.com/rest/sporecasts/MaxisCactus).
- **Shared authoring of scenarios.** The *Galactic Adventures* expansion (2009-06-23) added an
  Adventure Creator for missions on planets. Players made more than 100,000 adventures in about
  a month (WorthPlaying, 2009-07-31,
  https://www.worthplaying.com/article/2009/7/31/news/63886-spore-galactic-adventures-gets-100k-user-created-adventures/).
  The highest-rated item on the Sporepedia today is still an adventure from 2009, *Eaten!*
  (http://www.spore.com/rest/assets/search/TOP_RATED/0/3).

*For Sim:* Spore's sharing is the reverse of Sim's. Spore copied everyone's nouns into private
worlds, where their creators had no say. Sim has one world, and owners steer their own Souls.
The parts that carry over are curation by subscription, the "alternate realities" report, the
portable recipe and the public API. Section 6 takes each in turn.

### 2.3 What the creators made, and the moderation it needed

**Volume.**

| Date | Count | Source |
|---|---|---|
| 2008-06-24 (1 week) | >1 million creatures | MCV / WorthPlaying, above |
| 2008-09 (launch) | >3 million creatures | IGN; Pocket Gamer, above |
| 2008-09-24 | >25 million "creatures, vehicles and buildings"; 1 million copies sold | EA press release, https://s204.q4cdn.com/701424631/files/doc_news/2008/09/1/336620.pdf |
| 2009-04-29 | 100 million creations, "an average of more than 307,000 daily", of which 31,017,761 creatures | EA press release 2009-05-04, https://s204.q4cdn.com/701424631/files/doc_news/2009/05/1/381318.pdf; Engadget, https://www.engadget.com/2009-05-04-over-100-million-creatures-made-in-spore.html |
| 2026-10-02 | 191,785,152 uploads; 5,747,486 users | live API, http://www.spore.com/rest/stats |

Engadget notes that the 100 million figure excluded banned creatures (above). So by 2009 only
about a third of uploads were creatures. The rest were buildings, vehicles and ships.

**What people made.** Within two weeks of the Creature Creator came Pokémon clones "from perfect
Pikachus to misshapen monstrosities" (GamesRadar, 2008-07-01,
https://gamesradar.com/pokemon-invade-spore). Others built objects the editor was never meant
for, such as Viking longboats with oars made in the creature editor (IGN page 2, above).
Eurogamer described the result as "a Frankenstein's universe of inventive or funny or
pop-culture or genital Adams-of-the-other-guy's-labours" (above).

**"Sporn" and the response.** YouTube filled with genital creatures within days. EA's handling
had four parts:

- **Warning emails at once.** EA flagged accounts the same day. PC Gamer's Kristen Salvatore got
  a terms-of-service warning on 2008-06-18 for a creature she had just made (GamesRadar,
  https://gamesradar.com/busted-boobalicious-banned).
- **Removals with YouTube, under a ladder of sanctions.** By 2008-08-01 EA was "working with
  YouTube" on removals, with accounts warned, then suspended, then removed. EA also let players
  filter which creatures appear in their own universe. Executive producer Lucy Bradshaw: "a
  small number of people can be counted on to use it for something vulgar" (bit-tech,
  https://bit-tech.net/news/gaming/ea-clamps-down-on-sporn/1).
- **A ban achievement, withdrawn.** The game shipped with a secret achievement, "Bad Baby",
  awarded when one of your creations was banned from the Sporepedia. Patch 1.02 removed it on
  2008-10-16. The same patch made creator videos upload to YouTube as private by default
  (Shacknews, https://www.shacknews.com/article/55391/spore-patch-102-released-removes).
- **The forum, closed.** The official forum (the "Sporum") ran with volunteer moderators until
  it closed in 2018 (https://spore-community.github.io/).

*For Sim:* Spore had a hard floor of central moderation, plus a per-viewer choice of how much
others' content to see. That is the same shape doc 05 proposes ("hard floor everywhere", then
geography). The one thing Spore did wrong in public was to turn a moderation outcome into a
reward.

### 2.4 How long people played, and where they stopped

No public telemetry on stage completion turned up (see §8). The proxies:

- **Length.** HowLongToBeat, from player submissions read on 2026-10-02: main story 12½ hours,
  main + sides 29½, completionist 103. Of tracked players, 2,315 report completing it, 739 have
  "retired" it and 3,857 have it in a backlog (https://howlongtobeat.com/game/8985). Space is
  where most of the hours go. IGN: space is "longer than all the other stages combined" (above).
- **Which stages people liked.** Cell and Creature were liked. Tribal and Civilization were the
  weak middle. Timothy Burke suggested cutting both as "shallow, simplistic and rather boring"
  (2008-09-09,
  https://archive.swarthmore.edu/easily_distracted/blog/2008/09/09/spore-needs-more-and-less).
- **Fatigue on reaching space.** By the time he got there, one reviewer wrote, "the game had
  sapped my will to live" (peterb, 2008-09-23, https://tleaves.com/wordpress-archive/post1004/).
- **Chores in space.** Players complained that pirate raids and "eco-disasters" kept calling
  them back to defend colonies they had already built. The game exposes console commands to
  slow pirate raids (**[claimed]**: player forums,
  https://steamcommunity.com/app/17390/discussions/0/135513421440428381). StrategyWiki's guide
  to the galactic core advises making peace first because "an enemy attack during your quest…
  is very annoying" (https://strategywiki.org/wiki/Spore/Center_of_the_Galaxy).
- **Who the audience was.** At GDC 2009 Margaret Robertson found that Spore's real users in
  schools were mostly children under 12. They used the free Creature Creator, not the game, for
  creative writing, 3D modelling and emotional-literacy work. She found no one using it to
  teach science (https://www.gamedeveloper.com/pc/gdc-lessons-learned-from-i-spore-i-its-science-and-more,
  2009-03-25).
- **Sales over time.** EEDAR estimated about 2.8 million copies worldwide by May 2009 (3.2
  million with the Creature Creator), and sales had been "declining" since December 2008, a
  normal retail curve rather than The Sims' long tail
  (https://gamesbeat.com/spores-creature-count-hits-100-million-what-does-it-portend/).

The pattern: creation held people longest, the early stages were enjoyed but finished quickly,
the middle was a toll road, and space was where committed players stayed. The creating
continued long after the playing stopped. Today about 250 new creations a day arrive from a few
hundred people (§5.4).

## 3. World state

### 3.1 What the client held and what the server held

| Held by | What |
|---|---|
| **Client (each player's PC)** | the whole galaxy and every save: planets, empires, colonies, the player's species and its history, under `%appdata%\Spore\Games`; a local cache of downloaded creations (`Pollination.package`); the player's own creations (`My Spore Creations`) (**[claimed]**: EA and Steam forum posts, e.g. https://forums.ea.com/discussions/other-ea-games-en/how-to-transfer-saved-games-in-spore/10561365) |
| **Server (Sporepedia)** | every published creation (recipe plus thumbnail), with author, tags, description, rating, comments and a `parent` field; accounts; buddies; Sporecasts and subscriptions; achievements; "MySpore" statistics |

The server fields are as served by the live API on 2026-10-02 (e.g.
http://www.spore.com/rest/asset/501124937503; http://www.spore.com/rest/user/MaxisCactus) and as
listed in the 2009 SIGGRAPH talk (above).

The simulation itself never ran on a server. Each galaxy was a private procedural world. Its
planets were generated locally and populated with a mix of Maxis creations, your own, and
whatever pollination had brought down. When an empire turned up in your galaxy built on a
stranger's species, your machine's AI ran it. The stranger never knew, apart from the statistics
on their MySpore page (Eurogamer: "their species become part of your game-world, adopted by the
AI ruling their own planets", above). Exactly when pollination ran (when a planet was first
generated, or when the player visited) is **[claimed]**; I found no primary description.

### 3.2 Lineage

Every Sporepedia asset carries a `parent`, the id of the creation it was derived from. In the
newest 1,000 uploads (2026-09-28 21:04 to 2026-10-02 19:49 UTC), **392 have a parent**
(http://www.spore.com/rest/assets/search/NEWEST/0/500 and `/500/500`, my count). Building sets
point at a shared parent: one author's "Rögnvaldr's Mill" and "Feast Hall" share parent
`501124933044`. My reading is that `parent` means "edited from"; Maxis never documented this
that I could find. Remixing was common, and the record keeps the history without changing the
original.

### 3.3 Procedural generation as compression

Wright's 2005 pitch was compression ("5000 to 1"). His argument for it rested on what content
is worth. Speaking of The Sims 2, he said: "Content and cost do not directly translate into
value" (2005 report, above). Hecker designed around that constraint (implicit surfaces, small
recipes), and Wright "hired demoscene programmers specifically for their procedural expertise"
(https://en.wikipedia.org/wiki/Development_of_Spore). The music was procedural too: Brian Eno
contributed generative music systems (same page).

*For Sim:* Spore split the work this way: canonical, tiny and shared on the server; large,
regenerable and local in the depiction. Sim already does the same for meaning (the kernel's
11,939 events replay in 35 ms with no engine; `STATUS.md`). The difference is that Spore's
*simulation* was local and free to the publisher, while Sim's minds are central and paid by the
operator. Spore could afford 5.7 million users because each user's CPU ran their own galaxy.
Sim cannot do that, and §8 returns to it.

## 4. Objective

### 4.1 The stated goal

The space stage gives missions from the homeworld that lead step by step to "contact the Grox"
and "get to the center of the galaxy" (StrategyWiki, Space Stage, above). The Grox hold the
core with "a 2,400-system cybernetic empire" (Wikipedia, above). Near the core your jump range
falls to about 3 parsecs from the usual 20, so the trip becomes "a maze which slowly destroys
your ship" (StrategyWiki, Center of the Galaxy, above). Inside, "the player is introduced to
Steve", is "shot out of the black hole, and gets rewarded with the Staff of Life", a
terraforming item (Wikipedia, above). After that: "there's nothing else of quite the same
magnitude to do" (StrategyWiki, above). Badges raise a rank whose top is "Omnipotent"
(StrategyWiki, Space Stage).

The reward for the main goal was a joke and a tool. The goal mattered less than the journey,
and much less than what players set out to do for themselves.

### 4.2 The goals players set themselves

From the record above:

- **Making things**: by far the largest activity. There were 100 million creations in ten
  months and nearly 192 million in total, against about 3 million copies sold by mid-2009
  (§2.3, §2.4).
- **Reproducing culture**: Pokémon, film and game references, and the "Bank Holiday sofa sale
  species" (Eurogamer, above).
- **Curation and audience**: Sporecasts with thousands of subscribers (§2.2), and the
  race to own the 100 millionth upload. Spore Illustrated estimated 90,000 creatures were
  uploaded just after 2 pm on 2009-04-29 to hit it (Engadget, above).
- **Planning an archetype** across four stages (§1.3, **[claimed]**).
- **Playing god in space**: terraforming, abducting creatures and replanting them, sculpting
  planets. IGN: "you can basically play as a god, and that's always a nice rush" (above).
- **Writing scenarios** for others: 100,000 adventures in about a month (§2.2).
- **Changing the game itself** through mods (§5.4).

### 4.3 Wright's 2005 vision against what shipped

**What was shown in 2005.** At GDC on 2005-03-15, in a talk titled "The Future of Content",
Wright showed six levels (tide pool, creature, tribe, city, civilization, space), all
procedural, with "player stories will always be more powerful than scripted stories" as the
thesis (GDC report, above). Wikipedia's development history lists the 2005 phases as **seven**:
Cell, Underwater, Creature, Tribe, City, Civilization, Space. A 2007 plan had **eight**,
including a "Molecular" phase "likened to Tetris" and a space stage split into Terraform and
Galactic. The game shipped with **five**. The underwater phase was cut, and the city stage was
folded into Civilization (https://en.wikipedia.org/wiki/Development_of_Spore). The project had
been conceived as "SimEverything" in 1994 (same page). The demo's art was grittier. A "Cute"
camp and a "Science" camp split the team, and cell art was redone with cartoon eyes "to make it
cute" (same page).

**What was lost.** By the developers' and critics' own accounts:

1. **Depth in every stage, traded for breadth.** Johnson: "the team was making five games at
   once", and "the powers of ten idea put the team in a state of perpetual compromise where every
   major decision had to be considered according to its effect across all five stages." His
   view was that the stronger idea, procedural content, was never allowed to displace the
   original structure (https://www.designer-notes.com/?p=654).
2. **Shape that matters.** Johnson: "Spore is not really a game about evolution. Spore is
   actually a game about creativity", and creature shape "has no impact on actual gameplay"
   (same). Burke wanted a creature that "manipulated objects with tentacles" to "make artifacts
   and have social systems that reflected its biology". Instead, tribal masks were "generic
   rather than something which conforms to the anatomy" (above).
3. **Surprise.** peterb's complaint was that the player commands everything ("you are telling
   it 'Dance. Now sing.'"), so "there is no richness in the gameplay. There is richness in the
   player-created art". He pointed to Dwarf Fortress for creatures that surprise you (above).
4. **A world that reacts.** Hecker: "If you play with the editor you think it's pure magic. You
   play the game, and it's not as the same level of depth as the editor. It doesn't react to
   you", and "we totally dropped the ball there" (Game Informer, 2011-06-08,
   https://gameinformer.com/b/features/archive/2011/06/08/chris-hecker-spy-party-interview).
5. **Science.** A *Science* panel graded the game in October 2008 and gave it a single A
   (galactic structure) and several Fs (mutation, natural selection, genetics…) (Wikipedia,
   above). Robertson reported that people called it "a Mr. Potato Head simulator" (GDC 2009,
   above).

**Why it happened.** The developers' own reasons:

- **The audience was chosen deliberately.** Wright: "if you go after a lot of people who don't
  play games at all, you will take hits among the hardcore gamers" (GamesBeat, above).
  Wikipedia quotes him (from MTV) choosing "the Metacritic and sales of Sims 2" over "the
  Metacritic and sales of Half-Life" (above).
- **The game was playable too late.** Johnson: "Spore was not fully playable until, at best, the
  final year of the project", and "100 compelling yet limited prototypes are less likely to lead
  to a great game than a single playable one" (above).
- **The team was split.** The cute-against-science divide, and later a "gameplay" camp against a
  "Sim" camp: "These cultural divides ruined Spore's chances to be a focused, cohesive
  experience" (Johnson, above).
- **Gameplay got the least attention, and the blame stays inside the team.** Hecker did not
  blame EA: "it was our fault for dropping the ball and not focusing on the game design
  enough". He took away Rob Pardo's rule, "depth first, accessibility later" (Game Informer,
  above).

*For Sim:* each of Spore's stages was a separate genre with its own rules, and every transition
threw away the previous stage's verbs. Sim has one kernel with open vocabulary, so it can
*stage* a world without switching games. §6 makes this a proposal.

## 5. Reception and afterlife

### 5.1 Sales and reviews

- **Sales.**
  - 1 million copies sold through by 2008-09-24 (EA, above).
  - "Nearly 2 million" in EA's fiscal Q2 2009 (Shacknews,
    https://www.shacknews.com/article/55652/spore-sells-nearly-2-million).
  - 2 million in three weeks (Wikipedia, citing EA).
  - About 2.8 million by May 2009 (EEDAR via GamesBeat, above).
  - I found no lifetime figure from EA.
- **Reviews.**
  - Metacritic 84 (Wikipedia; EA's press release said 85 at the time).
  - IGN US 8.8 overall, but 8.0 for gameplay: "it lacks the gameplay depth that experienced
    gamers expect" (above).
  - Eurogamer 9/10 (above).
  - GameSpot 8.0: "individual gameplay elements are extremely simple" (Wikipedia, above).
- **Steam today.** 61,124 positive and 4,996 negative user reviews, with an owners estimate of
  2–5 million (SteamSpy,
  https://steamspy.com/api.php?request=appdetails&appid=17390, read 2026-10-02). bit-tech's
  2018 retrospective made the same point: critics scored it 84 in 2008, and players later rated
  it far higher (above).

### 5.2 The DRM controversy

Spore shipped with SecuROM and a limit of three online activations, which uninstalling did not
restore. By 2008-09-10 Amazon showed 1,662 one-star ratings out of 1,797, and the crack had
been out within a day of the Australian release (The Register,
https://www.theregister.com/2008/09/10/spore_drm_amazon_effect/). Wikipedia has 2,016 of
2,216 one-star ratings by 2008-09-14 (above).

EA's reply on 2008-09-12 cited data from 453,048 Creature Creator activations: 77% on one
machine, and only 1% trying more than three
(https://gamedeveloper.com/pc/electronic-arts-responds-to-i-spore-i-drm-criticism). EA then:

- raised the limit to five machines and released a de-authorization tool in December 2008
  (PCWorld, https://www.pcworld.com/article/532552/spore_deauthorization.html);
- went from **one screen name per copy** (the manual had wrongly promised several) to up to
  five (GameWatcher, 2008-09-22,
  https://www.gamewatcher.com/2008-22-09-spore-to-add-extra-screen-names-to-online-accounts;
  Shacknews, https://www.shacknews.com/onearticle.x/54704).

Class actions followed on 2008-09-22 and 2008-10-14, and Steam sold a version without SecuROM
from 2008-12-22 (Wikipedia, above). Spore was still the most pirated game of 2008, at an
estimated 1.7 million BitTorrent downloads in about three months (TorrentFreak via TechSpot,
https://www.techspot.com/news/32769-spore-tops-most-pirated-games-of-2008-list.html).

### 5.3 The franchise

The franchise after the main game:

- **Galactic Adventures**, the only full expansion (2009-06-23; EA, above).
- **Console and handheld spin-offs**: *Spore Creatures* (DS), *Spore Hero* (Wii), *Spore Hero
  Arena* (DS) (Wikipedia, above).
- **Darkspore**, an online-only action RPG. EA shut its servers on 2016-03-01, which left it
  unplayable (https://en.wikipedia.org/wiki/Darkspore).
- **The studio itself.** EA closed Maxis Emeryville, the studio behind Spore, on 2015-03-04
  (Game Informer,
  https://gameinformer.com/b/news/archive/2015/03/04/ea-shuts-down-simcity-studio-maxis-emeryville).

There was never a Spore 2.

### 5.4 What survives, as of 2026-10-02

- **The servers and the API.** `http://www.spore.com/rest/stats` returned
  `totalUploads 191,785,152, dayUploads 230, totalUsers 5,747,486, dayUsers 72`.
- **Recent activity.** The newest 1,000 uploads span 3 days 22 hours: 745 creatures, 95
  buildings, 72 vehicles, 59 ships, 29 adventures, from **178 distinct authors**. The top author
  made 108 of them (my count from the NEWEST listing, above). That is about 250 uploads a day,
  roughly 1/1,200th of the 2008–09 average.
- **Players.** SteamCharts showed 786 people playing on Steam, a 24-hour peak of 843 and an
  all-time peak of 5,549 (September 2016). Monthly averages over the past year ran from 477 to
  736, with September 2026 the lowest. The best month on record was February 2018 (1,265
  average) (https://steamcharts.com/app/17390). Steam is one store among several (EA app, GOG),
  so these figures are a floor.
- **EA's care for it.** A pinned r/Spore megathread dated 2024-09-30 reports that EA assigned a
  team to the servers, which will be "maintained for at least 3-5 years", and that a
  certificate update was planned like the one in 2017 (**[claimed]**: seen through a Reddit
  mirror, https://redlib.hackliberty.org/r/Spore; Reddit refused direct reads).
- **Community preservation.** The Spore Community Hub's stated goals include "ensuring that
  Spore's online features continue to work indefinitely". It has decoded the PNG format, built
  bulk-download tools, and points to a replacement server in development
  (https://spore-community.github.io/). Its GitHub organisation was active this week:
  SporeModder-FX pushed 2026-10-01 and Spore-ModAPI 2026-09-23. It also has a tool that saves
  published creations as WARC archives (https://github.com/Spore-Community, read via the GitHub
  API). Space-stage overhaul mods such as RattlerSPORE are built on the ModAPI
  (**[claimed]**: search summary of https://www.moddb.com/games/spore).

### 5.5 Where its ideas went

- **Procedural animation for bodies nobody has seen.** Hecker's retargeting is the precedent
  doc 10 builds on.
- **Asynchronous shared discovery.** *No Man's Sky* pools what players discover into a central
  catalogue that other players then see, without being an MMO (**[claimed]**: secondary
  descriptions only, e.g. https://giantbomb.com/wiki/Games/No_Mans_Sky). bit-tech credits
  Spore's galaxy as arriving "years before" Elite Dangerous and No Man's Sky (above).
- **Spore's original premise, done properly.** *Thrive* is an open-source game from a mostly
  volunteer team that aims for evolution "while remaining scientifically accurate". Its stages
  run Microbe, Multicellular, Aware, Awakening, Society, Industrial and Space, and only the
  first is playable (https://revolutionarygamesstudio.com/faq).
- **Wright's own next step is AI.** *Proxi* (Gallium Studios) builds a "proxy" from the
  player's typed memories. Once trained, proxies act on their own in a simulated world while
  the player watches. Its funding ran out in October 2024 and the 30-person team was laid off,
  and Wright has continued with an unpaid skeleton crew
  (https://creativebloq.com/3d/video-game-design/the-sims-designers-new-ai-game-is-giving-me-the-creeps;
  **[claimed]** for the 2026 status, from a search summary of
  https://www.notebookcheck.it/Il-creatore-di-The-Sims-continua-a-scommettere-sul-gioco-di-memoria-AI-Proxi-nonostante-il-calo-dei-finanziamenti.1261808.0.html).
  This is the nearest living relative of Sim's idea of an owned, autonomous inhabitant that you
  shape rather than drive.

## 6. Lessons for Sim

### 6.1 What Spore proved and what it disproved

**Proved:**

- Millions of ordinary people will make 3D beings if the editor is easy and the result comes
  alive at once.
- They will keep doing it for years after the game around it stops mattering.
- A tiny canonical recipe plus generated depiction scales to hundreds of millions of objects at
  almost no server cost.
- Other people's creations make a world feel inhabited, even when nobody else is present.

**Disproved:**

- That a series of shallow genres adds up to a deep game.
- That expression can be bolted on top of mechanics that ignore it.

Spore's designers named the fix as making the creation matter to play. They had no way to do it
in 2008 for open-ended shapes and behaviours. Sim can, because its verbs (cards) are themselves
open content, minted by a compiler and checked by a validator, and because depiction can lag
behind meaning (doc 18 §2).

### 6.2 Adaptations that 2008 could not do (proposals, not decisions)

Everything in this subsection is a **proposal** by Claude, not a decision. Each item is tied to
what exists in Sim today.

**A. Verbs from body shape.** Spore gave a dozen fixed verbs levels from part tags. Sim could go
further:

1. *The capability map at birth.* At birth (doc 10's pipeline, or the current body catalogue),
   derive a **capability map** from the rig and the description: feet, graspers, wings,
   coils, voice, size.
2. *A deck from the map.* Deal the Soul's deck from that map. A body without graspers is never
   dealt "hand over" or "set up the DJ kit". A serpent is dealt "coil around" and "bask".
3. *Minted body verbs.* The compiler may mint body-specific cards under the existing validator.
   The card's `when` would gain one condition kind, "actor has capability X", which the
   validator can check.
4. *Depiction can lag.* Missing animations go on the existing depiction backlog. Hecker-style
   retargeting fills them later.

Shape changes **what a Soul can do**, never **how well**. That avoids Spore's "parts that spoil
the look". The map is computed once and logged, so replay stays deterministic.

**B. Consequence traits from the ledger.** Spore stamped one trait per stage from how you
played. Sim could fold a Soul's plays into a handful of **traits**: "host" after it has hosted
many gatherings, "wanderer" from distance walked, "peacemaker" from agreements made. Traits
would be computed by deterministic code over the log, so they replay. They would be visible to
owners and agents, and each would add or remove a few cards or a manner. This lets idle life
build an identity without any model calls. Dials for `13`: thresholds and decay.

**C. A report from other people's lives.** Spore told you how your creature fared in other
players' galaxies. Sim's ledger already records every play with its card hash and every mint
with its author (doc 18 §4), so it can tell an owner two things for nothing. The first is
"while you were away", what the Soul did. The second is **the life of your cards**: "'ask to be
the DJ', which your wish minted, has been played 412 times by 37 Souls; the last time was at
Rob's fire". This answers the question every Spore creator wanted answered, and it gives owners
a reason to wish carefully.

**D. Lineage for cards and Souls.** Spore's `parent` field handles revision without rewriting:
39% of today's uploads point to what they came from. Doc 18 lists "retiring and revising cards"
as open. A revision would be a **new card with a `parent` link**, while the old hash stays valid
for the plays that used it, so the past never changes meaning. Retiring a card would stop it
being dealt, while it stays replayable. Owners' agents proposing cards would credit the parent's
author in the "life of your cards" report.

**E. Pollination for one shared world.** Spore filled private worlds with copies of others'
creations. Sim has one world, so the equivalent is **what the world draws on when it fills
itself**:

- *Natives at the frontier as "echoes".* Native Souls and things at the frontier could be
  generated from the shared card library and from descriptions that owners have **opted in** as
  templates, with credit shown.
- *Weighting by subscription.* What gets drawn would be weighted by subscriptions, the
  Sporecast equivalent, and by attention (the inertia rule in doc 04).

Unlike Spore, an owned Soul must never be copied without consent, because Sim's Souls are
property and identity, not toys thrown into a commons. Natives are paid for by the operator,
so echoes should run mostly on reflex (doc 18 §4 tiers).

**F. Per-viewer depiction filters over canonical meaning.** Spore's four-way content toggle is
clean in Sim because meaning and depiction are separate. One viewer may see only approved media
on facades while another sees everything. The kernel, the ledger and every other viewer are
unaffected. Moderation by geography (doc 05) then sets defaults, not hard truths, for most
content. The hard floor stays central.

**G. The world itself goes through stages.** Spore's stages were per player and switched games.
Sim's could be per **world**, and change vocabulary only:

- *Eras as vocabulary sets.* A village era, then a town era with new materials and kinds of
  link, and so on. Each era is a base-vocabulary set adopted by a logged `rules` event. That
  mechanism exists today as `adopt_vocabulary` (doc 18 §9 step 8).
- *Triggers.* An era would be triggered by world conditions, such as population or things made,
  and ratified at the daily ritual ("the day glass was invented").
- *Nothing discarded.* Old cards stay playable, so nothing the community built becomes obsolete.
  Every move from Cell to Creature to Tribe discarded verbs; Sim's eras would only add.

**H. Scenario authoring as card sequences.** The Adventure Creator was Spore's most successful
late feature (100,000 in a month). Sim's plans are already agendas of cards with `of`
placeholders. Owners could publish a plan as a **scenario** ("a dance-off at the fire") that
other owners hand to their Souls. This is the Galactic Adventures loop without a second editor.

**I. A shareable recipe image.** Spore's PNGs carried the creature. A Soul's or card's portrait
could carry its canonical record (description hash, capability map, deck hashes, or the card's
JSON and hash) in the image metadata. Pasting it into Sim, or handing it to an agent, would then
load or propose it. It would spread Sim through ordinary image sharing, with provenance built
in.

## 7. Ten things to steal, ranked

1. **Make creation the first product, and let it ship before the world is deep.** The Creature
   Creator had 3 million creatures before the game existed. Sim's equivalent is the Soul maker
   plus the card foundry: describe a being, watch it come alive, mint its first verb from a
   wish. Doc 18 notes that failed compiles currently sit in the `brain` tab, not a foundry view,
   so the foundry needs its own page. It should give Hecker's moment, the creature that "turns
   to look at its new limb", a Soul equivalent: the first thing a new Soul does is visibly
   *about* its description.
2. **Let the body decide the verbs** (§6.2 A). This is the fix Spore's own designers named.
   Shape should change which cards are dealt, never stat strength.
3. **A tiny canonical recipe and generated depiction everywhere.** Sim has this for meaning.
   Extend it to Souls (description plus hashes), made things, and media by hash (doc 05's
   "ingest and copy"). Spore's archive is recoverable today because of it.
4. **Lineage instead of mutation** (§6.2 D). Use `parent` links for cards, Souls and things. This
   answers "revise without changing what past plays meant".
5. **A report from other people's lives** (§6.2 C). It is cheap, it comes from the ledger, and it
   is Spore's most-loved social feature.
6. **Curation by subscription.** Buddies and Sporecasts let people choose whose work shapes
   their experience. In Sim, subscriptions could steer which native "echoes" (§6.2 E) and which
   news reach a Soul's knowledge layers (doc 18 §6). They are also how an owner's agent finds
   good cards in the library.
7. **Traits from how a life was lived** (§6.2 B). Spore's consequence traits, made
   deterministic and continuous rather than end-of-stage stamps.
8. **Viewer-side content filters over a canonical world** (§6.2 F). Spore proved players want
   the choice. Sim's architecture makes it free.
9. **A public read API and an exportable archive from day one.** Spore's 2009 API outlived the
   studio and is what preservationists use now. Sim already has REST and MCP for agents. Add a
   read-only public view of the library, plays and things, and a documented export of the log
   and assets. This serves "the artifact should be able to live alone" (doc 01).
10. **Moderation on day one, never gamified.** In 2008 the sequence ran: obscene content in days,
    warning emails the same day, warn, then suspend, then remove, then a personal filter, and an
    achievement for being banned that had to be withdrawn. Sim mints content from wishes (card
    names and summaries are public text) and will take media from the edges. It needs report,
    hide-for-me, and an owner-level sanction ladder before minting opens beyond invites.

Honourable mention: **creator videos and shareable moments**. Wright said Creature Creator videos
"almost brought down YouTube's servers" (Pocket Gamer, above). Sim's director already produces
camera shots as data. A one-click clip of "what my Soul did today" is the same lever.

## 8. Traps

- **Several games in one.** Spore made five shallow genres and argued every decision across all
  of them. Sim's vision lists building, economy, ritual, rooms, art, speech and politics. Keep
  them as vocabulary on one kernel, not as separate subsystems with separate rules. Doc 18's
  "grammar fixed, vocabulary open" is the defence. Treat any proposal for a special engine for
  one activity as a warning sign.
- **An editor deeper than the world.** "It doesn't react to you." If a Soul's description and
  manners do not visibly change what it does, owners will treat the Soul maker as a toy and
  leave. The test is whether two Souls with different descriptions, given the same wish, behave
  recognisably differently.
- **Mechanics that punish expression.** When parts determined survival, players had to choose
  between the creature they wanted and the one that worked. If capabilities ever affect power
  (manna yield, persuasion odds), the community will optimize bodies and descriptions. Keep
  capabilities about which verbs exist.
- **A tutorial dressed as a game.** Four stages to reach the real one. Sim has decided that
  newcomers enter at once (doc 06). Keep the first ten minutes in the real world, not in a
  separate onboarding mode.
- **Chores for absent owners.** Space-stage pirate raids and eco-disasters called the player
  back to defend what they had built. Sim's idle Souls must be **alive without you** (doc 01),
  which means the world should not generate obligations for owners. Notifications should be
  news ("your card was played at the ritual"), not alarms.
- **Marketing a promise the system cannot keep.** Spore was sold on evolution and science and
  graded F by scientists. Sim's claims ("alive", "remembers", "changes the world") must match
  what the kernel does. Memory beyond two minutes and layered knowing are not built yet
  (`STATUS.md`).
- **Ownership that feels like distrust.** Three activations and one screen name per copy drew
  a one-star wave before anyone judged the game. Sim already allows several Souls per account
  and hides wallets (doc 06). Keep NFTs and invite codes from reading as locks. Spore's own
  data showed the restriction hit very few people and still cost the most goodwill.
- **Death by server.** Darkspore was online-only and died when its servers went off. Spore
  survives because the game runs locally and creations travel as images. Sim is server-first by
  design, so its survival plan is the log plus content-addressed assets plus a public export
  (steal items 3 and 9, and doc 03's "what happens if Eden goes away").
- **Vastness without density.** Spore had 500,000 planets, most of them empty. Others' content
  made a few feel alive. Sim's rule that ground grows to stay ahead of a target density (doc 02)
  is the right instinct. Do not let the frontier outrun the population.
- **The cost asymmetry.** Spore's per-player cost was near zero because every player's machine
  ran their galaxy. Sim pays for every mind, at $0.50 a day today with about fifteen wishes a
  day of compiler budget (`STATUS.md`). Copying Spore's openness, where anyone makes anything,
  without its cost model means rationing will decide who gets to create. Push depiction to
  clients (decided, doc 06), keep reflexes free, and meter wishes per owner, as Sim already does.
- **Prototypes in place of a playable whole.** "Spore was not fully playable until, at best,
  the final year." Sim has the opposite strength: a live, replayable shell. The risk is that
  economy, building and ritual stay in documents for long while the shell runs a toy plane.
  Johnson's rule applies: "The only prototype that matters is the game."

## Not verified / not covered

*Not verified.*

- The exact pollination algorithm: priority among buddies, Sporecasts, ratings and Maxis picks,
  and when downloads happen.
- How consequence-trait colours map to archetypes. SporeWiki on Fandom refused direct reads, so
  this rests on search summaries.
- Local save paths. They come from forum posts.
- The r/Spore 2024 megathread about EA's server team. It was seen only through a mirror.
- Wright's 2022 Axios quotes. Only the headline and an excerpt were seen.
- No Man's Sky's discovery pooling. It comes from secondary descriptions.
- Proxi's 2026 status. It comes from a search summary.
- Galactic Adventures sales.
- Spore's lifetime sales. EA published none that I found.
- Whether the API's `parent` field always means "edited from". This is my reading.
- Whether the API's `dayUploads` counts a UTC day or a rolling 24 hours.

*Not found.* Any public telemetry on how many players finished each stage or reached the
galactic core. Steam has no Spore achievements, and the in-game achievements are EA's. HLTB's
"retired" count is a self-selected proxy.

*Not covered, judged less useful to Sim.* The DS, Wii and iPhone spin-offs in detail; Darkspore's
design; Spore's procedural music beyond a mention; the *Science* panel's full grades; the
creationism debate; Spore Origins; the Creepy & Cute and Bot parts packs; the legal outcome of
the 2008 class actions.
