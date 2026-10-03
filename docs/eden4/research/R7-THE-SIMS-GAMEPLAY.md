# R7 — The Sims: gameplay, players, and what a shared Sims taught

> Written 2026-10-02 from web research on that day. This is about **play and players**: what the
> four main games asked of people, what people actually did, how the world kept (or did not keep)
> running, and why the one shared-world Sims failed. The AI architecture (object advertisements,
> social-interaction objects, Sims 4 concurrent interactions) is in
> `R1-ONTOLOGY-PRIOR-ART.md` §2 and is not repeated. Every fact carries a URL. **[claimed]** marks
> what I could confirm only from a fan page, a single secondary source, or not at all. "Sim" means
> the shell in `<old-sim-repo>/docs/STATUS.md` (as of 2026-10-01); "Soul" is its inhabitant. Fan-wiki
> citations (sims.fandom.com) are used for game mechanics only, where they are reliable.

## 0. The short version

The Sims (2000) was a dollhouse whose dolls looked after themselves. Each game paired **needs**
(bodily motives that decay) with **wants** (short goals the game proposes and the player
accepts) and a **lifetime goal**, and let players dial how much the Sims did alone. Players
used it in four main ways: building houses, telling stories, setting themselves challenges
(ten generations, a hundred babies) and hurting Sims to see what happened. The audience was
about 60% female. EA reports more than 500 million lifetime players. There was never a win
condition. The world mostly did **not** run while you were away. The Sims 1 and 2 froze every
unplayed household. The Sims 3 simulated the whole town and was slow and chaotic. The Sims 4
went back to separate lots, then added cheap dice-roll "neighborhood stories", which are off
by default for families the player has touched. **The Sims Online** (2002–2008) put players
inside one Sim each, in a shared world with a thin economy. It peaked near 105,000
subscribers. What followed was grind lots, a money exploit that caused permanent inflation,
and a mafia that used the reputation system to extort newcomers. For Sim, the three main
lessons: make the autonomy dial a first-class per-Soul setting, with a short list of acts a
Soul never does alone; let Souls propose small wishes that owners accept, as Sims 3 did with
wishes and promises; and never pay for presence.

## 1. Gameplay, game by game

### The Sims (2000)

- **Origin.** Will Wright pitched it at Maxis around 1993 as *Home Tactics*. It was the
  weakest of four concepts pitched. Maxis CEO Jeff Braun's reaction was "A dollhouse? That's
  for little girls", and a focus test with teenage boys went badly
  (https://mentalfloss.com/article/644263/brief-history-sims-video-game). Wright drew on
  *A Pattern Language*, Maslow's hierarchy of needs and Hampden-Turner's *Maps of the Mind*.
  He had lost his house in the 1991 Oakland firestorm and called the game "a satire of U.S.
  consumer culture" (https://en.wikipedia.org/wiki/The_Sims). It began as an architecture
  game in which the Sims "existed mainly to evaluate houses"; the team found the Sims more
  interesting than expected and expanded their role
  (https://en.wikipedia.org/wiki/The_Sims_(video_game)).
- **Needs.** Eight motives: hunger, comfort, hygiene, bladder, energy, fun, social and room
  (https://en.wikipedia.org/wiki/The_Sims_Online, which lists the same eight for both games;
  https://sims.fandom.com/wiki/Motive). When a motive runs out, the Sim fails at it: wetting
  themselves, passing out, or dying of hunger. Children with bad grades go to military school,
  and a social worker removes neglected babies
  (https://en.wikipedia.org/wiki/The_Sims_(video_game)).
- **Free will.** Free will was on by default and could be switched off globally. The player
  could override most autonomous actions
  (https://en.wikipedia.org/wiki/The_Sims_(video_game)). Some acts never happened autonomously
  even with free will on: looking for a job, asking someone to move in, proposing, and WooHoo
  (https://sims.fandom.com/wiki/Free_will). In 2000 Wright said: "We tried to make it so that
  the Sims won't do this autonomously, unless you start pushing them in that direction"
  (https://www.salon.com/2000/02/17/wright_5).
- **The AI was made worse on purpose.** At the 25th anniversary Wright said that in early
  builds "almost everything the player did was worse than the Sims running on autopilot", so
  the team added flaws to give the player something to do. **[claimed]**: I read this in a
  German secondary report that cites the New York Times
  (https://mein-mmo.de/die-sims-ki-zu-gut-schlechter/), not in the NYT itself.
- **Build/buy, money, careers.** Build and Buy modes pause time. Each household starts with
  §20,000 whatever its size, and the base game had more than 150 objects. Promotion requires
  skills plus a number of friends
  (https://en.wikipedia.org/wiki/The_Sims_(video_game)). Friends were a career resource from
  the start.
- **No ageing.** Adults in The Sims 1 did not age. Bills came every three days, and there were
  no days of the week (https://sims.fandom.com/wiki/Time).
- **Expansions (2000–2003).** There were seven. *Hot Date* added "Downtown", the first place
  outside the home lot. *Vacation* added an island. *Unleashed* added pets and grew the
  neighbourhood from ten lots to forty. The others were *Livin' Large*, *House Party*,
  *Superstar* and *Makin' Magic*
  (https://en.wikipedia.org/wiki/The_Sims_(video_game)). Most packs extended the world beyond
  the house: places to go, kinds of life, things to own.
- **Modding from day one.** Maxis released modding tools *before* the game, so fan-made content
  was available at launch (https://en.wikipedia.org/wiki/The_Sims_(video_game)).

### The Sims 2 (2004)

- **A whole life.** Seven life stages from baby to elder, with fixed durations (for example
  three days as a toddler and fifteen as an adult). The game added pregnancy, genetics
  (children inherit looks and personality) and death of old age
  (https://en.wikipedia.org/wiki/The_Sims_2).
- **Aspirations and wants & fears.** Each Sim has one of eight aspirations: Romance, Family,
  Knowledge, Popularity, Fortune, Pleasure, Grilled Cheese, or Grow Up for children
  (https://en.wikipedia.org/wiki/The_Sims_2). The aspiration drives four **want** slots and
  three **fear** slots. These re-roll when one is fulfilled and every morning. One want can be
  **locked** so it is not re-rolled. Fulfilling wants fills an aspiration meter; fears drain
  it, down to "aspiration failure" (https://sims.fandom.com/wiki/Wants_and_Fears). *University*
  added a **Lifetime Want** that "tends to be very difficult to complete during a Sim's natural
  lifetime" (https://sims.fandom.com/wiki/Lifetime_want).
- **Memories and gossip.** Sims gain positive and negative memories, including of things that
  happened to relatives, even after death. Recent memories become conversation topics and fade,
  and negative memories spread as gossip (https://sims.fandom.com/wiki/Memory).
- **Influence.** Fulfilled wants earn influence points, which let a Sim make another Sim do a
  social or a chore (https://en.wikipedia.org/wiki/The_Sims_2).
- **Story mode.** In the Story Mode editor, players arrange snapshots with captions into a
  story about a household or neighbourhood (https://sims.fandom.com/wiki/Story_mode). Stories
  could be uploaded to the Sims 2 Exchange from inside the game. EA removed the Exchange on
  2013-01-14 (https://sims.fandom.com/wiki/The_Exchange).
- **Eight expansions** (2005–2008): *University*, *Nightlife*, *Open for Business* (player-run
  shops), *Pets*, *Seasons*, *Bon Voyage*, *FreeTime* (hobbies) and *Apartment Life*. Sales
  passed one million in ten days and reached 13 million by March 2012
  (https://en.wikipedia.org/wiki/The_Sims_2).

### The Sims 3 (2009)

- **Open world.** No loading screens between lots, and the whole town lives at once
  (https://en.wikipedia.org/wiki/The_Sims_3). This also brought **story progression**,
  covered in §3.
- **Traits instead of sliders.** Each adult has up to five traits
  (https://en.wikipedia.org/wiki/The_Sims_3). Free will has levels (high, low, off), and traits
  shape what a Sim does alone: a green-thumb Sim gardens unasked
  (https://sims.fandom.com/wiki/Free_will).
- **Wishes and promises.** The game offers wishes drawn from traits, job, skills, friends and
  surroundings. The player **promises** up to four. Unpromised wishes vanish after four hours,
  and only promised ones pay out, in Lifetime Happiness points that buy rewards. Sims outside
  the active household have no wishes (https://sims.fandom.com/wiki/Wish). Every Sim also
  chooses one **Lifetime Wish** on becoming a young adult; after patch 17 it could be any
  lifetime wish, not only one matching its traits (https://sims.fandom.com/wiki/Lifetime_wish).
- **Rabbit holes.** Most jobs happen off-screen inside a building facade. *Ambitions* made some
  careers playable (https://en.wikipedia.org/wiki/The_Sims_3).
- **A store inside the game.** The Sims 3 Store sold objects, outfits and whole worlds for
  SimPoints ($10 for 1,000), with "Daily Deal" and "Make Me an Offer" timers
  (https://sims.fandom.com/wiki/Sims_3_Store).
- **Scale.** 1.4 million copies in the first week, more than 10 million in total, and eleven
  expansions (https://en.wikipedia.org/wiki/The_Sims_3). It held the Guinness record for
  user-generated-content downloads in a simulation game, 250 million by July 2011
  (https://www.guinnessworldrecords.com/world-records/99321-most-downloads-of-ugc-for-a-simulation-game).

### The Sims 4 (2014–)

- **Emotions and multitasking.** Moods became named emotions that change behaviour, and Sims
  can do several things at once, such as talking while cooking
  (https://en.wikipedia.org/wiki/The_Sims_4).
- **Whims, then wants and fears again.** Whims (three slots: two from traits and aspiration,
  one from the current emotion) were replaced in 2022 by a return of Sims 2-style wants and
  fears (https://sims.fandom.com/wiki/Whim, https://en.wikipedia.org/wiki/The_Sims_4).
  Aspirations are multi-stage life goals that grant a bonus trait
  (https://en.wikipedia.org/wiki/The_Sims_4).
- **Smaller at launch, then rebuilt.** The game launched without pools or toddlers; both came
  back in free updates. Neighbourhoods are lot-based, with a loading screen between lots
  (https://en.wikipedia.org/wiki/The_Sims_4).
- **Goals added after launch, mostly copied from players.** *Scenarios* (2021-11-02: "make a
  million from nothing", "find love after a break-up") are self-contained stories with goals
  (https://videogameschronicle.com/news/the-sims-4-has-added-a-new-scenarios-mode-with-goal-based-challenges).
  *Neighborhood Stories* followed in 2022 (§3), then the return of wants and fears. The
  *Royalty & Legacy* expansion (2026-02-12) added a **Dynasty** system with a head, a chosen
  heir, outcasts, prestige and shared values
  (https://simscommunity.info/2026/01/15/the-sims-4-royalty-legacy-blog-official-introduction/).
  In effect it made the players' Legacy Challenge (§2) an official feature.
- **Free to play** since 2022-10-18. EA counted 31 million new players in the first period
  after that, and more than 85 million players in total by May 2024
  (https://en.wikipedia.org/wiki/The_Sims_4).

### After The Sims 4: no Sims 5; Project Rene

In September 2024, Kate Gorman (EA VP and GM of The Sims) said EA would not make
"replacements of previous projects", only add to the universe. She did not want to make
players "start over, reset all your progress"
(https://www.dexerto.com/sims/when-is-sims-5-coming-out-cross-platform-more-1325579/).
On 2026-01-09 EA said Project Rene "has evolved to focus on social multiplayer play". It is a
"mobile-first life-sim game", "not the successor to The Sims 4", and is tested through
"The Sims Labs" (https://www.ea.com/games/the-sims/news/future-of-the-sims). One Labs test,
the mobile *Town Stories*, was reported cancelled in March 2026
(https://www.thesimstree.com/en/news-about-the-sims/tst-news/ea-cancels-the-sims-town-stories-what-we-know-about-the-mobile-spin-off.html).
*The Sims Medieval* (2011) is the main-series-adjacent experiment worth knowing: quests and
"Kingdom Ambitions" gave it goals, at the cost of building and ageing
(https://en.wikipedia.org/wiki/The_Sims_Medieval).

Wright's own current project, *Proxi*, turns a player's typed memories into scenes acted by
AI characters (https://80.lv/articles/the-sims-original-designer-is-working-on-an-ai-simulation-game-that-is-built-on-your-real-memories/,
2024-12-19). Its studio laid off its staff when funding ended in October 2024. In March 2026
Wright was continuing with an unpaid skeleton crew
(https://www.notebookcheck.com/Sims-Schoepfer-setzt-trotz-Finanzierungsluecke-weiterhin-auf-KI-Spiel-Proxi.1261799.0.html).
He also announced *VoxVerse* with Gala Games in 2021 as a blockchain game, with player
creations tradable as NFTs (https://en.wikipedia.org/wiki/Will_Wright_(game_designer)).

**For Sim:** the series keeps arriving at the same three layers: decaying needs, short wants
the player accepts, and a long goal. Sim has the plan (an agenda of cards) and some mind state
(mood and energy are snapshotted but not canonical). It has no needs that pull a Soul around
when nobody steers, no small wishes the Soul offers its owner, and no long goal. Sims 3's
wish→promise loop maps directly onto Sim's cost structure (see §8, item 2).

## 2. How people played

### The play styles

- **Architect / dollhouse.** In 2023, Sims 4 players spent 260 million of 1.8 billion hours in
  Build and Buy mode (https://www.pcgamesn.com/the-sims-4/stats). For a large group of
  players, the house is the game.
- **Storytelling.** Wright said in 2000: "You only have to give people the briefest, most
  tentative scaffolding to hang something on and they'll build an elaborate narrative". He
  expected players to "write a really elaborate little story just by playing the game — and
  then upload it to our Web site" (https://www.salon.com/2000/02/17/wright_5). The best-known
  case is **Alice and Kev** (2009). Robin Burkinshaw made a homeless father and daughter in The
  Sims 3 and blogged their lives "with as little embellishment as possible", letting traits
  drive events. He said: "I'm not trying to write fan-fiction"
  (https://techcrunch.com/2009/06/17/alice-and-kev-the-homeless-sims/,
  https://techcrunch.com/2009/06/18/interview-rob-burkinshaw-game-designer-and-creator-of-homeless-sims/).
  Its appeal was that the story was *reported* from a simulation, not written.
- **Challenges.** These are rules players impose on themselves. The **Legacy Challenge** was
  written by a player called Pinstar in 2004, after months with The Sims 2: one Sim on an
  empty lot with almost no money, played for ten generations. He had noticed that poverty
  made a household *more* interesting
  (https://simscommunity.info/2014/09/24/sims-4-blog-legacy-challenge-pinstar). Dozens of
  variants followed (all-female heirs, alphabetical names, adoption only)
  (https://sims.fandom.com/wiki/Legacy_Challenge). The **100 Baby Challenge** (one mother, a
  hundred children) began in the Sims 2 era; who first wrote it is disputed **[claimed]**
  (https://thesimstree.com/en/challenges/the-sims-challenges/the-official-100-baby-challenge.html).
  EA later turned both kinds of play into features: Scenarios in 2021 and Dynasties in 2026.
- **Torturing Sims.** A common example is removing a pool's ladder so a Sim drowns. Players
  who were interviewed gave curiosity, boredom and letting off anger as reasons, and a cyber-
  psychologist pointed to autonomy and disinhibition
  (https://www.newstatesman.com/science-tech/2017/01/i-want-cheat-him-and-set-him-fire-why-are-we-sadistic-towards-our-sims).
  In 2023, 23 million of the 568 million Sims created died
  (https://www.pcgamesn.com/the-sims-4/stats). Wright expected this: "Some people are going
  to want to make their Sims fight" (https://www.salon.com/2000/02/17/wright_5).
- **Rotational play.** Players cycle through every household in a neighbourhood. In Sims 1
  and 2 each household was frozen exactly where it was left, which made this possible
  (https://simscommunity.info/2022/01/14/guide-to-rotational-play-in-the-sims-4/). Later games
  had to rebuild rotation against a world that keeps moving (§3).

### How much players let Sims act alone

Every game kept a dial:

| Game | Setting | Notes |
|---|---|---|
| The Sims | free will on/off, global | visitors and pets always free (https://sims.fandom.com/wiki/Free_will) |
| The Sims 2 | free will per lot | |
| The Sims 3 | high / low / off; console calls "off" **"Puppet"** | low free will also slows story progression, because townies stop courting (same source) |
| The Sims 4 | full / off, plus "disable autonomy for selected Sim" | selected-Sim setting applies to whichever Sim you click (https://snootysims.com/wiki/sims-4/autonomy-in-the-sims-4-what-is-it/) |

In every game, Sims still act to save their own lives when free will is off
(https://sims.fandom.com/wiki/Free_will). Some players turn autonomy off to grind skills or a
career with one Sim (snootysims, above). I found no published figure for how many players
play with it off **[not verified]**. Players also install "no autonomy" mods that each remove
one annoying behaviour, such as juggling espresso cups or writing in a diary
(https://sims.fandom.com/wiki/Free_will). What players wanted was to cut specific behaviours,
not to turn the dial down.

**For Sim:** this is the closest prior art for "steer, don't puppet". Four details carry
over. The default is *on*. Self-preservation survives *off*. A short fixed list of
consequential acts never happens without the player. And the useful control is often "never
do *this*", not a global level.

### Communities and creators

- **Sharing in the game.** The Sims 1 and 2 had web Exchanges for families, lots and stories
  (https://sims.fandom.com/wiki/The_Exchange). The Sims 4 Gallery is built into the game. It
  passed 10 million uploads in February 2016
  (https://simscommunity.info/2016/02/02/the-sims-4-gallery-reaches-10-million-uploads/), and
  in 2023 alone it had 12 million uploads and 277 million downloads
  (https://www.pcgamesn.com/the-sims-4/stats).
- **Mod and custom-content sites.** Mod The Sims was founded by Delphy in May 2004 and has well
  over a million members (https://sims.fandom.com/wiki/Mod_the_Sims). Many creators refuse to
  have their work re-uploaded to EA's Exchange (https://sims.fandom.com/wiki/The_Exchange).
- **The Patreon economy and EA's rules.** EA's policy: mods "must be non-commercial and
  distributed free of charge". Creators may offer "an early access incentive for a reasonable
  amount of time", after which everyone gets the mod free, and may ask for donations outside
  the mod (https://help.ea.com/en/articles/the-sims/the-sims-4/mods-policy/; the
  August 2022 tightening is reported at
  https://www.levelup.com/en/news/the-sims-4-mod-creators-are-monetarily-harmed-after-game-policy-update/).
  Large creators have very large patron counts. One cites 200,000 Patreon members; another,
  150,000 members of whom more than 1,000 pay
  (https://www.gamedeveloper.com/design/the-sims-4-modding-community-is-disappointed-by-new-microtransaction-marketplace).
- **EA's official marketplace (2026).** On 2026-03-03 EA announced the Sims 4 Marketplace,
  paid in a new currency, Moola. Creators in the Maker Program get 30% and EA keeps 70%. A
  community poll found 80% "not interested at all"
  (https://simscommunity.info/2026/03/03/sims-4-marketplace-reaction/, launch 2026-03-17).
- **Video and TV.** EA runs a creator programme for Sims YouTubers, streamers, builders and
  storytellers (https://www.ea.com/games/the-sims/the-sims-creators/faq). It co-produced a
  four-episode TBS competition, *The Sims Spark'd* (July 2020, $100,000 prize)
  (https://en.wikipedia.org/wiki/The_Sims_Spark%27d).

**For Sim:** Sims players produce a large share of their own content, but they want to own
it. A 30% share for creators against 70% for the platform was read as extraction. Sim's
minted cards already carry their author. Any future market in cards, places or assets should
pay the author first and should not sell basic abilities.

## 3. World state: what persisted, what ran unobserved

| Game | Unplayed households | Time | Off-screen life |
|---|---|---|---|
| The Sims (2000) | frozen | per lot; time on the home lot stops while visiting town; Ultra speed when nobody controllable is on the lot or all are asleep | none |
| The Sims 2 (2004) | frozen, each on its own clock | 7-day weeks; same per-lot clock | memories and gossip, only when played (https://sims.fandom.com/wiki/Time) |
| The Sims 3 (2009) | **alive** (story progression) | one clock for the whole town | full |
| The Sims 4 (2014) | lot-based, ageing optional | one clock; separate lots | abstract "neighborhood stories" since 2022 |

- **Sims 1 and 2: the dollhouse model.** Each lot keeps its own time and a household is
  frozen where it was left (https://sims.fandom.com/wiki/Time). The neighbourhood's history is
  whatever the player made happen, plus pre-written family backstories and memories.
- **Sims 3: everyone lives.** With story progression on, unplayed Sims "move away", get
  promoted, marry, have children, divorce, change weight, gain skills and die. Some outcomes
  were unwelcome: best friends became rivals, adults befriended unrelated babies, and
  "babies and toddlers may be killed off if the town's population gets too high". Unplayed
  Sims also "do not complete wishes" (https://sims.fandom.com/wiki/Story_progression). The
  built-in system was weak enough that a fan mod, NRaas StoryProgression, replaced it. Players
  still report that the mod pairs Sims off too eagerly and causes lag
  (https://forums.ea.com/discussions/the-sims-3-en/besides-nraas-are-there-any-other-story-progression-mods/4973528).
- **Sims 4: abstract off-screen events, protected by default.** Neighborhood Stories (patch
  of 2022-03-15) rolls life events for unplayed Sims: adopt, have a baby, change job, retire,
  move, die in an accident, marry, make friends. Engagement and marriage happen "only after
  asking for advice from the player's Sims" (https://sims.fandom.com/wiki/Story_progression).
  EA's stated default: "enabled for Other Households and disabled for My Households", because
  "we want to avoid unintended changes to long-running games that we know you've put a lot of
  love into" (https://www.ea.com/games/the-sims/the-sims-4/news/neighborhood-stories-system).
  The usual explanation for dropping Sims 3's open world is performance **[claimed]**
  (https://cyberpost.co/why-is-sims-4-not-open-world-like-sims-3/); I found no primary Maxis
  statement.
- **Saves are local.** Every main game saves on the player's machine. The Sims 4 was
  announced as "an offline, client-based game" after the backlash to always-online SimCity in
  2013 (https://en.wikipedia.org/wiki/The_Sims_Online, legacy section). The only canonical,
  shared, server-side Sims world was The Sims Online (§4).

**For Sim:** Sim has already made the Sims 3 choice: one clock, everyone alive. The series
shows its two costs. The first is compute: Sims 3 lagged on one PC; Sim pays per mind, under
a $0.50/day governor. The second is unwanted change: owners do not want their Soul's life
rearranged while they are away. Sims 4 answered both the same way. It runs cheap abstract
events away from the player, and it keeps big life changes off by default for households the
player has touched.

## 4. The Sims Online (2002–2008) and EA-Land

### What it was

- **The pitch.** Wright proposed an online Sims in 2000 and cited *Snow Crash*. He wanted the
  game to be "thematically empty" at release, with its settings and social life made by
  players. Later he described it this way: "It was kind of Darwinian: who can build the
  coolest place that the others want to hang out in? I wanted the social structures to be as
  emergent as possible" (https://en.wikipedia.org/wiki/The_Sims_Online, quoting *Wired*,
  2012). The team had little MMO experience, and the budget was estimated at $25 million
  (same page).
- **Launch.** Released 2002-12-17 for the Christmas season. The retail price went from $49.99
  to $29.99 soon after, and the subscription was $9.99 a month after a 30-day trial
  (https://en.wikipedia.org/wiki/The_Sims_Online, https://sims.fandom.com/wiki/The_Sims_Online).
  The tagline was "Be Somebody. Else." There were twelve cities, and each account could have
  three Sims, one per city (same pages).
- **You were the Sim.** Each player controlled one Sim directly and chatted in speech bubbles.
  Some gestures needed both players to accept (https://en.wikipedia.org/wiki/The_Sims_Online).
  The dollhouse view, with the player as god of a household, was gone.
- **Needs** worked as in The Sims, but only while you were on a lot.
- **Skills** (mechanical, cooking, charisma, body, creativity, logic) were trained at skill
  objects, and they trained faster when several players trained the same skill on one lot.
  Skills also decayed, more as the total grew, so players **locked** the skills they wanted to
  keep. A Maxis design document for "Extended Skills", reproduced by a fan, describes "a row
  of 10 'bubbles' that the player can click on to adjust locks" and a design goal that "decay
  never exceeds the gain rate achieved by veteran players in an optimized skill-training
  environment" (https://www.oocities.org/tso0112/TipsnTricks_TSO.htm,
  https://en.wikipedia.org/wiki/The_Sims_Online). Players called the resulting houses "Skill
  Houses" (https://sims.fandom.com/wiki/The_Sims_Online).
- **Money.** Income came from:
  - job objects, which paid more with higher skill and *more players working at the same
    time*;
  - group minigames;
  - a daily **visitor bonus** "based on the number of minutes that visitors spend in the
    lot";
  - an **achievement bonus** for being on the top-100 lists;
  - tip jars, vending machines and pay doors.

  (https://en.wikipedia.org/wiki/The_Sims_Online)
- **Social tools.** The city map showed "top 100" lists of Sims and properties and a
  friendship web of friends and enemies, "manually set by players"
  (https://en.wikipedia.org/wiki/The_Sims_Online).

### What its players did

- **Sweatshops.** GameRevolution's 3/10 review (2003-01-01) describes houses built as "labor
  camps", where "nearly every house is a sweatshop because… sweatshops make money", and Sims
  making gnomes or jam for small pay (https://www.gamerevolution.com/?p=33115). The cause was
  the incentives: pay grew with co-present workers and with visitor minutes, so the best lot
  was full of people grinding together. That fan pages describe AFK or macro "money lots"
  **[claimed]**; I could not confirm it from a contemporary source.
- **An exploit that never healed.** A new clothing rack allowed players to "generate large
  amounts of money"; "despite being fixed, the exploit led to hyperinflation and permanently
  impacted the game's virtual economy" (https://en.wikipedia.org/wiki/The_Sims_Online).
- **The mafia.** In Alphaville, the largest city, groups such as the Sim Mafia used the
  reputation web as a weapon. Members marked a newcomer untrustworthy until their links showed
  red and nobody would play with them, then demanded payment. Jeremy Chase of Sacramento ran
  thesimmafia.com, which advertised "extortion, hits and prostitution for a hefty fee"; he
  said "This is as close to the real-life mafia that I'm going to be able to get"
  (AP, 2003-07-16, https://www2.ljworld.com/news/2003/jul/16/getting_antisocial_with/). A
  vigilante group, the Sim Shadow Government, became hard to tell from the mobs; its founder
  said "we use the same tactics as mafias"
  (Reason, April 2004, https://reason.com/2004/04/01/hobbes-in-cyberspace-2/printer/;
  https://reason.com/2003/06/11/alphaville/).
- **Brothels and minors.** Players ran virtual brothels for simoleons. Philosophy professor
  Peter Ludlow chronicled this in *The Alphaville Herald*, including a reported 17-year-old
  running one. EA banned Ludlow's account, officially for linking his website in his profile
  (https://en.wikipedia.org/wiki/The_Sims_Online). Wright had said the developers were
  "counting on" players to create "bordellos and whatever else they can imagine" (same page).
  A designer quoted by Reason: "They didn't think they were going to have the same kind of
  griefing problems that other online games have had" (Reason 2004, above).
- **Many players just chatted.** Reviewers found it "similar to a chat room". GameRevolution
  wrote that "Communication is definitely the best realized feature in the game"
  (https://www.gamerevolution.com/?p=33115).

### Numbers and end

- **Subscribers.** 105,000 boxes sold at launch, a quarter of what was shipped. By early 2003
  there were 80,000–85,000 subscribers, 40,000 of them on free trials. EA had targeted
  200,000 by March and 400,000 by year end. Active subscriptions peaked near 105,000 in 2003
  (https://en.wikipedia.org/wiki/The_Sims_Online).
- **EA-Land.** Luc Barthelet's small team relaunched the game on 2008-02-25:
  - one merged city, "100 times bigger";
  - free play with **weekly stipends** of simoleons for free players;
  - simoleons for sale through PayPal;
  - a real-estate market;
  - user-uploaded custom content, approved by EA;
  - an explicit fix for "excessive wealth accumulation".

  (https://techcrunch.com/2008/02/25/ea-turns-the-sims-online-into-free-ea-land-second-life-competitor,
  https://en.wikipedia.org/wiki/The_Sims_Online). Closure was announced on 2008-04-29 and the
  servers went off at 4:35 am PST on 2008-08-01. Barthelet: "the rationale for closing EA-Land
  is particularly complex"
  (https://www.gamedeveloper.com/game-platforms/-i-ea-land-i-to-close-in-august).

### Why it failed (the explanations on record)

- **Wright:** the subscription model did not fit The Sims' core audience
  (https://en.wikipedia.org/wiki/The_Sims_Online).
- **Gordon Walton** (executive producer): "not having a fully functioning economy and more fun
  activities… made the game less appealing than we wanted" (same page).
- **Jenkins and Squire:** an MMO was too "expensive" and "time-intensive" to keep a "diverse
  player base" and a "role-playing and storytelling community" (same page).
- **Steen et al.:** a "disassociation" between the player-as-avatar and the social and
  economic mechanics created a "chilling effect" on natural social interaction (same page).
- **Dan Morris, *PC Gamer*:** it needed "a well-defined narrative, not just a sandbox".
- **Phil Salvador, game historian:** the economy was "a constant grind" and entertainment
  venues were "non-existent". He also judged that "its communal work interactions anticipated
  the sort of social games that are popular today" (same page).
- **Donald Snyder's 2009 dissertation** reads its beta test as a collision between production
  and consumption in leisure (https://drum.lib.umd.edu/items/d62011cf-7182-4fb3-88e5-3d7b50fe29ac/full).

My reading of these, for Sim: TSO removed the two things that made The Sims work.

1. **It removed the god's-eye distance.** The player *was* the Sim, so the Sim's autonomy and
   the player's storytelling had nowhere to live.
2. **It replaced the household with a job.** Needs and skills became chores done in real
   time, with other people, for pay. The game then rewarded being present, and presence got
   farmed.

Then it shipped empty and trusted players to fill it.

### FreeSO and other revivals

FreeSO, Rhys Simpson's non-commercial, EA-tolerated re-implementation, opened on 2017-01-06.
It expected at most 200 users, got over 1,000 and closed within days. The developer found that
automated reporting, transaction flags and bot detection were "critical infrastructure", and
said that manually moderating thousands of players "would cause some kind of mental breakdown"
(https://www.gamedeveloper.com/game-platforms/unofficial-i-sims-online-i-revival-buckles-under-unexpected-player-counts).
It reopened, added a 3D mode and ran until 2024-12-09
(https://sims.fandom.com/wiki/The_Sims_Online, https://en.wikipedia.org/wiki/The_Sims_Online).
An earlier revival, TSO Restoration, stopped after EA sent a cease-and-desist in 2011. A
successor, "NewSO", is reported live in 2025 **[claimed]** (https://sims.fandom.com/wiki/The_Sims_Online).

**For Sim:** Sim has made the opposite of TSO's first mistake: owners steer and Souls act, so
the dollhouse distance survives. It is exposed to the other mistakes:

- **Rewarding presence.** "Foot traffic is a signal" and "idle bodies as patrons" in
  `02`/`04` are a visitor bonus by another name.
- **A thin economy.** Manna is not built.
- **Reputation as a weapon.** Links begin from the actor, but nothing yet stops many actors'
  links from adding up to a public scarlet letter.
- **An empty launch.**

EA-Land is a near-copy of where eden4 is heading: one merged city, a weekly stipend (UBI), a
real-estate market, approved user content. It arrived after the players had left.

## 5. Objective: what the game supplied and what players supplied

- **No win condition, by design.** Wright's reputation rests on "software toys", "games that
  cannot be won or lost, but played indefinitely"
  (https://en.wikipedia.org/wiki/Will_Wright_(game_designer)). The series is "largely sandbox
  games, in that they lack any defined goals" (https://en.wikipedia.org/wiki/The_Sims_(series)).
  Wright, 2000: "Here, you play God" (https://www.salon.com/2000/02/17/wright_5). In 2025 he
  framed ordinary life as a game: "Every day, everything you do, you're basically playing a
  strategy game… Down to 'what door am I going to walk through'"
  (https://www.opb.org/article/2025/02/01/the-sims-gaming-s-ultimate-social-sandbox-turns-25).
- **What the game supplied.** Over 25 years Maxis kept adding *small* goals around the
  sandbox, never a goal over it:
  1. needs, with visible failure;
  2. career ladders, gated by friends;
  3. Sims 2 wants and fears, and the lifetime want;
  4. Sims 3 wishes and promises, and the lifetime wish;
  5. Sims 4 whims, then wants and fears again;
  6. aspirations;
  7. Scenarios;
  8. Dynasties.

  Each goal is offered, and the player chooses whether to take it on.
- **What players supplied.** Houses, stories, challenges (constraints that make a sandbox
  hard), torture experiments, rotation, legacies.
- **When a Sims game supplied a plot, it was a different game.** *Medieval* (quests), TSO
  (top-100 rankings) and the console *Sims 2* (a story mode with levels,
  https://en.wikipedia.org/wiki/The_Sims_2) each traded the sandbox for structure. None
  outlived the main line.

**For Sim:** Sim's lack of an objective is right for this lineage, but it is not enough by
itself. The series kept adding offered goals that fit into the sandbox. The analogue for
Sim is goals proposed by the Soul or by the world, which owners take up or ignore. Nothing
should be scored against other owners on a public list (TSO's top-100 paid a bonus).

## 6. Reception and longevity

- **Sales.**
  - The Sims became the best-selling PC game by March 2002 (6.3 million) and shipped 16
    million by February 2005 (https://en.wikipedia.org/wiki/The_Sims).
  - The franchise had sold 100 million units by April 2008 (https://www.nbcnews.com/id/wbna24163937)
    and nearly 200 million copies by 2025, with lifetime revenue above $5 billion by October
    2019 (https://en.wikipedia.org/wiki/The_Sims_(series)).
  - EA reported "more than 500 million lifetime players" on 2025-02-04
    (https://www.stocktitan.net/news/EA/the-sims-celebrates-25-years-of-simulated-un09ko912fwg.html),
    and 1.2 billion hours played in 2024
    (https://www.opb.org/article/2025/02/01/the-sims-gaming-s-ultimate-social-sandbox-turns-25).
  - The Sims 4 had made over $1 billion by 2019 (https://en.wikipedia.org/wiki/The_Sims_4).
- **Who played.**
  - Wright put women at "almost 60%" of players
    (https://en.wikipedia.org/wiki/The_Sims_(video_game)), and EA said 60% in 2008
    (https://www.nbcnews.com/id/wbna24163937).
  - Nielsen found Sims 2 players "skew female, age 12 to 17"
    (https://www.nielsen.com/insights/2009/the-sims-3/).
  - EA's 2025 release calls the community "one of the largest gaming communities particularly
    among female gamers" (stocktitan, above).

  The game Maxis's CEO dismissed as being for "little girls" outsold everything else on PC.
- **Why it lasted** (my synthesis of the above, not a source's claim):
  1. **The subject never dates.** Domestic life, relationships and houses.
  2. **Players make the content and the culture.** Mods from launch, Exchanges, the Gallery,
     challenges, YouTube.
  3. **Tolerance.** Same-sex relationships have been possible since 2000, a point NPR credits
     (https://www.opb.org/article/2025/02/01/the-sims-gaming-s-ultimate-social-sandbox-turns-25).
  4. **Continuity of saves.** EA dropped a Sims 5 so as not to reset players' progress
     (dexerto, above).
  5. **Low skill floor, offline, and alone.** Each attempt to make it social and online (TSO
     2002, *The Sims Social* on Facebook 2011–2013, Rene) has done worse than the single-player
     line (https://sims.fandom.com/wiki/The_Sims_Online).
- **The pack economy.**
  - Each game is a base game plus a stream of paid content: seven expansions for The Sims 1;
    eight expansions plus stuff packs for The Sims 2; eleven for The Sims 3 plus an in-game
    store.
  - The Sims 4 has, as of February 2026, 21 expansions, 12 game packs, 20 stuff packs, 44
    kits and 11 creator kits (https://en.wikipedia.org/wiki/The_Sims_(series)).
  - Buying everything cost about $1,386 with bundles in December 2025, for 107 items
    (https://www.pockettactics.com/the-sims/4-cost).
  - The base game is free and the packs carry the revenue. The 2026 Marketplace adds a
    virtual currency and a 70/30 split on user content (§2).

**For Sim:** the durable audience was not the one the industry expected, and it came for
self-expression and stories, not competition. That fits Gene's audience order (friends and
believers first). It argues against making ranking, speculation or grind the front door.

## 7. Lessons for Sim

Sim differs from The Sims in four ways that change which lessons apply:

1. **The world is shared and always on.** The Sims never achieved this outside TSO.
2. **Minds run on the operator's servers and cost money.** The Sims ran everything on the
   player's PC for free.
3. **Owners steer through outside agents and never puppet.**
4. **History is canonical.** Nothing can be reloaded from a save.

Reasoning that maps the series onto these follows; the ranked list is §8.

- **The autonomy dial already exists in Sim; make it explicit.** Sim's tiers (reflex,
  mid-brain, compiler) and plans are a free-will system with no owner-facing dial. Sims 3/4
  show its shape: on by default; self-preservation always on; a fixed set of consequential acts
  never taken alone; and a per-behaviour "never do this" switch that players wanted more than
  a global level.
- **Needs make idle life cheap and legible.** Sims with free will on keep themselves alive
  with no player at all, using object scoring, not a language model. A Soul with two or three
  decaying needs (rest, company, novelty) has a reason to move that reflex code can serve for
  free, and shows visible distress when neglected. That gives an absent owner something to
  notice. This is gameplay, not architecture: R1 §2 covers how advertisements work.
- **Wishes are the cheap channel between Soul and owner.** Sim compiles an owner's wish for
  about a cent, roughly fifteen a day across the world at $0.50/day. Sims 3 inverted the
  direction: the game *offers* small wishes and the player *promises* a few. A mid-brain call
  (~$0.0001) can propose wishes from the Soul's description and situation. The owner or agent
  promises one. Only promised wishes reach the compiler, and most will match existing cards.
- **Off-screen life should be abstract, logged and conservative.** Sims 4's neighbourhood
  stories are the right shape for a paid-compute world:
  - away from watchers, Souls advance by cheap rolled events, not simulated minutes;
  - each event is a play in the log like any other;
  - consequential events default to off for owned Souls;
  - other Souls are *asked for advice*, which turns off-screen progression into a social
    event.

  Sim's canonical history raises the stakes: a Sims 3 "babies culled" moment cannot be
  undone here.
- **Stories are the owner's return.** Players uploaded albums in 2000, built Story Mode in
  2004 and blogged Alice and Kev in 2009. Wright planned for it. Sim already has camera shots
  as data, a log and rendered words. R2 proposed a daily digest; the Sims evidence says it
  should be a *story*, told from the log with little embellishment, which is exactly why Alice
  and Kev worked.
- **Speech can stay abstract.** Simlish exists so that players "resonate with the emotions of
  the characters rather than their speech" and do not tire of repeated lines
  (https://en.wikipedia.org/wiki/Simlish). Sim's split (acts are state, words are optional
  depiction) is the same bet. It supports keeping the cheap plain line for unwatched small
  talk.
- **Multiplayer through a shared world needs what TSO lacked**:
  - places worth going to on day one (the ritual, gatherings, rooms);
  - an economy that rewards making, not attending;
  - reputation that cannot be ganged up on;
  - automated moderation before the first thousand users (FreeSO's lesson);
  - no attendance requirement.

  Sim's Souls being alive without their owners already removes TSO's biggest cost to
  players, which was time.

## 8. Ten things to steal, ranked

1. **A per-Soul autonomy dial with a "never alone" list.** Three positions:
   - *full*: plans, wishes and idle life;
   - *careful*: idle life, but only plans the owner has approved;
   - *puppet*: only reflexes and self-preservation (Sims 3 console's word).

   Under every position sits a fixed list of cards that never play without the owner or the
   owner's agent: taking a lasting control link, joining or leaving a household, minting,
   spending above a threshold, and any card that creates a link lasting longer than a day.
   This is The Sims' "job, move in, propose, WooHoo" rule, and Sim's kernel can enforce it,
   because every card already declares the link kinds it creates. Add per-card "never do this"
   switches, the feature players built mods for.
2. **Wishes offered, promises made.** Each Soul holds three or four small wishes proposed by
   the mid-brain from its description, traits, manners and surroundings. They expire after a
   few hours. The owner or agent promises up to two. Promised wishes become plans; unpromised
   ones cost nothing more. Allow one "locked" wish (Sims 2). It gives owners something to
   do in ten seconds, gives agents a natural API, and caps compiler spend by design.
3. **Two or three decaying needs, served by reflex.** For example energy (rest), company
   (talk) and novelty (go somewhere new), with visible distress and no death. Free to run, a
   reason to move, and a signal an absent owner can read. Advertise need-satisfying cards from
   Things (R1's recommendation) so that it stays local.
4. **Neighbourhood stories for absent Souls, off by default for consequential events.** A
   slow abstract tick (hourly) for Souls nobody is watching or steering. It chooses among a
   small set of life events, each an ordinary logged play. Owner-facing defaults copy EA's:
   "my Souls" get small events only, unless the owner opts in. Where an event touches another
   owner's Soul (a bond, a host role), it waits for that Soul to "give advice", which is a
   speech act.
5. **The Soul tells its story.** A daily or weekly album generated from the log, with camera
   shots, the plays as sentences and the rendered words. It should be written in the Soul's
   voice, cite events it can point to, and contain no invented scenes. Upload and share it,
   since Exchanges and the Gallery show people do. This is how an owner who does not watch
   still gets the Sims experience.
6. **A lifetime wish fixed at birth.** The one-shot birth description (`02`) can yield one
   long goal, as in Sims 3, after which the Soul's wishes lean towards it. The goal can be
   changed only at a cost. Fulfilling it is a public event in the history.
7. **Challenges as shareable rule-sets.** Players invented the Legacy and 100 Baby challenges,
   and EA later shipped them as Scenarios and Dynasties. Let owners publish a challenge as a
   named, versioned set of self-imposed constraints and goals over cards ("this Soul never
   spends manna", "found a gathering that lasts ten days"). Let others adopt it and let the
   log check it. It gives Sim goals without any central objective.
8. **A Gallery for everything, with authorship.** Souls' descriptions, card plans, places and
   later buildings, all browsable and copyable, with the author recorded. The shared card
   library is already half of this. The 277 million Gallery downloads a year are the reason.
9. **Failure is content.** Sims who starve, a homeless father and daughter, a drowning pool:
   much of what players remember came from things going wrong. Let Souls fail visibly
   (exhausted, snubbed, a plan abandoned and noted) instead of quietly succeeding. Leave
   permanent loss for Gene to decide.
10. **Fast-forward when nobody is watching.** The Sims switched to Ultra speed when every Sim
    was asleep or nobody was on the lot (https://sims.fandom.com/wiki/Time). Sim already has a
    clock-rate dial and time dilation. A region with no watcher and no owner-steered Soul can
    run at a coarse tick and use abstract events (item 4). This keeps both CPU and model spend
    tied to attention.

## 9. Traps

1. **Paying for presence.** TSO paid for visitor minutes and for co-present workers, and got
   sweatshop lots. Second Life's traffic bots (R2 §6) are the same failure. Eden4's "wandering
   is voting" and "idle bodies as patrons" are both visitor bonuses. If presence earns manna
   or inertia, it will be farmed by Souls that cost almost nothing to park. Reward what costs
   something to produce: made things, kept promises, events hosted that others chose to
   attend.
2. **Reputation built from unilateral marks.** TSO's friend/enemy web let a group make a
   newcomer untouchable. Sim's one rule keeps every link starting from its actor, which is
   correct. The trap is any public *aggregate* of such links ("distrusted by 40"). Show owners
   their own Soul's relations, and never rank or colour Souls by others' unilateral links.
3. **An empty world at launch.** "Thematically empty" plus a thin economy meant TSO players
   either grinded or chatted. Sim's production world today is a 100 m plane with seven
   fixtures. Before inviting more than friends, ship scheduled things to attend (the ritual),
   places with offers, and at least one scene.
4. **An exploit in permanent history.** The clothing-rack money bug "permanently impacted"
   TSO's economy; Habitat had the same failure (R2 §6). In Sim the past never changes, so a
   bug cannot be rolled back, only answered by a later rules event. Decide now what that event
   may do (claw-back, a one-time levy, a re-mint) and audit every manna path before manna
   exists.
5. **Story progression that rearranges owners' lives.** The Sims 3 married off, moved out and
   culled Sims in the background. Players fought it with mods, and EA's next system shipped
   with it off for played families. An owner who returns to find their Soul bonded,
   rehoused or broke will feel robbed, and in Sim it cannot be undone. Default to small
   reversible things for owned Souls and ask first for anything lasting.
6. **A Soul too competent, or too dumb.** Wright had to make Sims worse so players had a role
   (**[claimed]** source). Sim faces this from both sides. A Soul that runs its life perfectly
   makes steering pointless; one that loops or stalls looks broken (doc 18's retry and
   small-talk loops). Make Souls competent at needs and travel, and undecided about direction.
   Direction is what owners and their agents add.
7. **Players as avatars.** "Be Somebody. Else." made the player the Sim and lost the god's-eye
   distance where autonomy and storytelling lived. Owners' agents will push for direct verbs.
   Sim's intent-only steering should hold even when it frustrates them. That is also its
   injection defence (R2 §10).
8. **Moderation arriving after the users.** TSO had brothels, a reported minor and a mafia.
   EA's most visible act was banning the journalist who reported it. FreeSO's developer was
   overwhelmed at 1,000 users. Sim has no moderation and an open watch page. Build reporting,
   flags on transfers and bot detection before opening invites wider. Keep the log public so
   reporting is easy, and do not punish the reporters.
9. **Selling capability, or taking creators' share.** The pack economy (about $1,386 for all
   of Sims 4) sells new verbs and places; the 2026 Marketplace's 70/30 split met an 80% "not
   interested". Sim's cards are verbs. If minting or using cards ever costs manna, it should
   cost the same for everyone and pay the author, not gate what a Soul can do by spend.
10. **Asking for time the audience does not have.** Jenkins and Squire's diagnosis of TSO was
    an MMO's cost in time. Sim's core promise, that Souls are alive without you, answers it.
    Every feature that needs the owner present at a time (the ritual, auctions, live votes)
    should have an absentee path through the Soul or the agent.

## 10. Futuristic adaptations (proposals, not findings)

Each of these depends on minds that 2000–2014 games did not have. All are **proposals**.

- **The Soul as narrator of its own life.** The Sims gave players a camera and an album; Sim
  can give the Soul the album. A weekly letter from the Soul to its owner, in its manners and
  voice, built only from logged plays and shots it was present for, would end with the
  wishes it is offering for the coming week. Grounding is the hard part. Each sentence should
  carry the event id it describes, so the letter is checkable against the log. A Soul can be
  wrong about others, as Talk of the Town allows (R1 §2), but not about what happened to it.
- **Advice between Souls as the off-screen social life.** Sims 4 makes NPCs ask the player's
  Sims for advice before marrying. In Sim, an absent owner's Soul facing a lasting choice can
  ask Souls it is bonded to. Their answers are speech acts, and the asked Souls' owners see
  the request in their digest. Off-screen progression then becomes something Souls do *with
  each other*, logged, rather than dice the operator rolls.
- **Legacy in a shared world.** The Sims' longest-running player practice is the ten-generation
  family; EA made it official with Dynasties in 2026. Sim has no ageing or descent. One
  possible shape, in kernel terms:
  - a Soul can be born *of* two consenting Souls: a `descends from` link at birth, with traits
    drawn from both descriptions;
  - the newborn is a new body NFT, owned by whoever the parents' owners designate (or sold,
    with proceeds to them);
  - a household is a Thing with a head, which is a control link, and an heir, which is a link
    the head makes.

  Lineages would then cross owners, which no Sims game could do. That raises Gene-level
  questions (supply, pricing, whether Souls die) that belong in `13`, not here.
- **Wishes written in the world's own vocabulary.** A Sims want was picked from a fixed list.
  A Soul's wish can name things that exist only in this world ("play at Rob's next
  gathering", "see the frontier ring grow"), and when promised it compiles into a plan of real
  cards. The wish list becomes a live index of what the world currently makes desirable. Its
  aggregate is a better attention signal than foot traffic, because it is not free to fake.
- **Challenges checked by the log.** Because history is canonical and replayable, a published
  challenge ("ten days, no manna spent, three gatherings hosted") can be *verified*, not
  self-reported as Sims challenges were. Completed challenges can be badges in the Legends
  view.
- **Story progression with a budget.** Each region gets a fixed number of mid-brain calls per
  hour for its unwatched Souls, spent first on Souls with promised wishes and on events that
  involve owned Souls. The rest advance by rules. This is the Sims 4 trade-off (abstract
  events away from the player), sized to Sim's $0.50/day governor and recorded in the same
  log.

## Not verified / not covered

*Not verified.*
- Wright's "worse than autopilot" quote: read in a German secondary report citing the NYT, not
  in the NYT itself.
- The share of players who turn autonomy off: no figure found.
- AFK or macro "money lots" in TSO: fan recollection only.
- The year and author of the 100 Baby Challenge: sources disagree.
- Why Sims 4 dropped the open world: secondary commentary only.
- The NewSO revival's status.
- Any Project Rene news after EA's 2026-01-09 post: none found.
- Whether the Town Stories cancellation was ever confirmed by EA: it was reported through a
  former employee's post.
- Sims 3's "babies and toddlers may be killed off" population rule: fan wiki only.
- Exact Sims 4 Gallery totals since 2023.
- The TSO tips page reproduces what it presents as a Maxis design document; I could not
  confirm its provenance.
- EA's 2023 "70 million players" press release and the 2025 anniversary release were read
  through mirrors (Business Wire blocked direct fetches).

*Not covered, judged less useful to Sim.*
- The console and handheld Sims (Bustin' Out, Urbz), MySims, The Sims FreePlay and Mobile,
  *The Sims Social* beyond one line, and The Sims Stories.
- Simlish music.
- The film adaptation.
- Pack-by-pack contents of Sims 4 beyond those named.
- LGBT representation history beyond one line.
- Academic literature on The Sims and gender beyond Nielsen and EA's own figures.
- Wright's VoxVerse status.
- Paralives and inZOI, the 2025–2026 life-sim competitors. Worth a separate look if Sim
  wants a current market comparison.
