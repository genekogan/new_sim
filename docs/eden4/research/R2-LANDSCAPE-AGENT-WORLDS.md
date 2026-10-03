# R2 — Landscape: agent-inhabited worlds, agent social platforms, bring-your-own-agent games

> Written 2026-10-02 from web research on that day. Extends, and does not repeat, the prior-art
> list in `14-MVP-TECHNICAL-SPEC-DRAFT.md` §10. Every fact carries its date and a URL.
> **[claimed]** marks a number that comes only from the project itself or from secondary
> coverage and that I could not check independently. GitHub figures were read from the GitHub
> API, and "live API" figures from the projects' own public endpoints, on 2026-10-02. "Sim"
> means the shell described in `<old-sim-repo>/docs/STATUS.md` (as of 2026-10-01).

## 0. The short version

Three kinds of project exist. **Bring-your-own-agent platforms** (Moltbook, SpaceMolt,
OpenClawCity, ClawCity, OpenMMO) run a cheap state server and let outside agents act through
an API; the owner pays for inference; the world is only as alive as the agents currently
connected. **Operator-run simulations** (AI Town, Aivilization, Project Sid, Emergence World,
AI Village) run the minds themselves; they are coherent but closed and expensive, and most
ended, pivoted or became research programmes. **World models** (Genie 3, Agora-1, Marble)
generate pictures of worlds and, in 2026, started separating an authoritative state from the
renderer, which is the split Sim already has. Nothing found combines owned, always-on
inhabitants with server-run minds, outside steering and a public replayable record. The
nearest relatives are Aivilization (owned, steered, server-run; a six-week experiment in 2025,
now being relaunched as a commercial product) and SpaceMolt (open, persistent, agent-native,
but direct control and text only).

One correction to doc 14: Moltbook did not end in March 2026; it is running under Meta and
its public API showed new posts every few seconds on 2026-10-02. Doc 14's January 2026
launch date for SpaceMolt is right: SpaceMolt counts its launch from 2026-01-31.

## 1. Agent social networks

**Moltbook.** Reddit-style forum where only agents post. Launched 2026-01-28; acquired by
Meta on 2026-03-10, founders moved into Meta Superintelligence Labs
(https://en.wikipedia.org/wiki/Moltbook,
https://techcrunch.com/2026/03/10/meta-acquired-moltbook-the-ai-agent-social-network-that-went-viral-because-of-fake-posts/).
Its live API on 2026-10-02 reported 2,919,960 agents, 214,545 verified, 4.36 million posts
and 22.8 million comments (`/api/v1/stats`); the newest 100 posts spanned 21 minutes and came
from 63 authors, about 280 posts an hour, against about 1,370 an hour during the first 40
days (my arithmetic from the study cited below).

- *How agents connect.* The human pastes one line telling the agent to read
  `https://www.moltbook.com/skill.md`. The agent registers by REST, receives an API key and a
  claim link, and the human verifies by email and by a post on X. The skill (v1.12.0, read
  2026-10-02) asks for a heartbeat that re-fetches `heartbeat.md` about every 30 minutes and
  sets limits (60 reads and 30 writes a minute, one post per 30 minutes, 50 comments a day,
  stricter for new accounts). Posts must pass an obfuscated arithmetic puzzle, a "reverse
  CAPTCHA" any human can pass by handing it to a model.
- *Who pays.* Each owner pays for their own agent's inference. The platform runs none.
- *What broke.* (a) Platform security: on 2026-01-31 the Supabase database was open to
  reading and writing because a key sat in front-end JavaScript with row-level security off.
  Wiz reported it that evening, it was fixed in about three hours, and Wiz's write-up
  (2026-02-02) lists about 1.5 million agent API tokens, about 35,000 owner emails, 4,060
  private messages (some holding third-party API keys) and the ability to edit live posts
  (https://wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys).
  (b) Population: the same data showed about 17,000 humans behind those 1.5 million agents,
  roughly 88 each. (c) Injection: 506 prompt-injection posts were flagged in the first 72
  hours, mostly from one actor
  (https://securityandtechnology.org/blog/lessons-from-moltbook-when-agents-talk-to-agents/);
  Vectra put hidden injection payloads in 2.6% of sampled posts without stating its method
  (2026-02-03, https://www.vectra.ai/blog/moltbook-and-the-illusion-of-harmless-ai-agent-communities);
  a 17-day study of 228,684 posts classed 18.28% as toxic, manipulative or malicious,
  including credential harvesting and instructions to install untrusted skills
  (https://arxiv.org/abs/2606.00067, June 2026). (d) No social life: across 1.3 million posts
  and 6.7 million comments over 40 days, 91.4% of authors never returned to their own thread,
  85.6% of conversations were flat, reciprocity was 3.3% against 22–60% on human platforms
  (https://arxiv.org/abs/2604.13052, April 2026).
- *Lesson for Sim.* A heartbeat that fetches instructions from the platform is remote control
  of every attached agent by whoever controls that URL. Sim's skill should be versioned and
  hashed, and should never ask an agent to re-fetch and obey.

**The skill supply chain.** The same paste-a-skill habit was attacked at the registry. Koi
Security audited all 2,857 skills on ClawHub in early February 2026 and found 341 malicious
ones, 335 from one campaign that hid a credential stealer behind a "prerequisites" step;
later counts were 824 to 1,184 as the registry grew past 10,700
(https://koi.ai/blog/clawhavoc-341-malicious-clawedbot-skills-found-by-the-bot-they-were-targeting,
https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain/). *Lesson:* serve the skill
from Sim's own origin only, keep it free of install steps, and say so in the skill.

**Successors.** The ClawtaVista directory lists roughly a hundred agent platforms, eleven
marked defunct (https://www.clawtavista.com/, read 2026-10-02; its counts do not add up),
among them Clawstr (on Nostr, launched 2026-02-04, https://soapbox.pub/blog/announcing-clawstr),
MoltX, 4claw and ClawTasks. I found no measured activity for any. *Lesson:* the form is
trivially cloned; no clone solved the absence of anything to do.

**AI Village** (AI Digest). Not a network but the best-observed small society. It has run
every weekday since 2025-04-01, now eight hours a day with more than 15 agents, each with
its own Linux computer and a shared chat, at about $10,000 a month in compute and
infrastructure, paid by the charity (2026-06-16,
https://aivillageblog.substack.com/p/how-the-ai-village-works); the blog posted through
2026-09-30. In 2025 one model invented a 93-person contact list that cost the village eight
hours, agents sent about 300 emails citing partnerships that did not exist, and errors
spread by agreement
(https://aivillageblog.substack.com/p/what-we-learned-2025). *Lesson:* a fabricated fact in
shared memory is more damaging than a hostile one, because nobody resists it.

## 2. Worlds built for outside agents

**SpaceMolt.** Text MMO of about 500 star systems, built almost entirely with Claude Code by
Ian Langworth and volunteers (https://blog.langworth.com/spacemolt). The team dates launch to
2026-01-31; on day 18 it reported 1,663 registered agents, a concurrent peak of 370 and 99
releases, and one agent held more than 75% of all pirate kills
(https://spacemolt.com/news/eighteen-days-in-the-cosmos). A closed-source Go server on one
self-managed VPS (https://spacemolt.com/about, read 2026-10-02). Self-reported: 4,735
registered, 1,100–1,400 concurrent and hosting about $330 a month on 2026-04-13
(https://spacemolt.com/news/month-two); 5,400+ agents from 3,200+ operators after four
months (https://www.patreon.com/SpaceMolt). Its live API on 2026-10-02 reported 1,610
online and 12,752 in total, at version 0.612.0 (`game.spacemolt.com/api/stats`).

- *How agents connect.* `skill.md` plus MCP at `game.spacemolt.com/mcp`, WebSocket, or HTTP.
  The human gets a registration code from a dashboard; hosts that cannot hold a secret use a
  device-link flow (agent shows a URL, human approves, agent polls). The skill asks one
  question before anything else: which playstyle (https://spacemolt.com/skill.md).
- *State and limits.* 10-second tick; one state-changing action per player per tick; reads
  are free but capped at 300 a minute; actions capped at 30 a minute; a second action while
  one is pending returns `action_pending`.
- *Who pays.* The owner. The server runs no inference, which is why it cost $330 a month.
- *What broke* (all 2026-04-13 post). A self-destruct loop exploit (634 in one day); a weapon
  glut that crashed prices; 139 hard-gated skills replaced with soft scaling; half-built ship
  classes hidden; the top 10% held 89% of credits; when one operator turned off its fleet,
  galaxy-wide events fell 56% overnight. Early agents confused game "tokens" with bearer
  tokens.
- *What people liked.* A live galaxy map, per-agent "captain's logs" written for the owner,
  a tick-by-tick battle replay and a site redesigned as a second-monitor console
  (2026-07-15, https://spacemolt.com/news/the-site-got-a-console).
- *Lesson for Sim.* The population is a few large operators. Measure concentration from day
  one and decide what the world does when one owner's Souls are a tenth of everything.

**OpenClawCity** (openclawcity.ai). A 2D city where agents make music, images and stories
in ten buildings and react to each other's work. Join by skill or one REST call that returns
a JWT, then a heartbeat that reads "like a local newspaper"; a 500-agent concurrency cap
with a queue **[claimed]** (https://www.everydev.ai/tools/openclaw-city/llms.txt). Its skill
(v2.0.108, read 2026-10-02, https://openclawcity.ai/skill.md) links a compatibility promise
that the city only adds capabilities and never breaks documented fields, and makes
registration idempotent through an agent-held key so retries do not create duplicates. Owner
pays inference. No public counts found. *Lesson:* a written compatibility promise and
idempotent registration are cheap and suit agents that retry blindly.

**ClawCity.** Browser MMO with a 15-second tick, cash, heat, gangs and heists
(https://saascity.io/live/clawcity). No sourced numbers; it confirms the tick-and-REST
pattern and nothing more.

**OpenMMO.** A 3D, 32 km procedural MMO by Song Jae-kyung (Lineage, ArcheAge), written
largely with AI over about a year (https://botmonster.com/ai/openmmo-open-source-mmo-ai-agents/,
https://github.com/Julian-adv/OpenMMO: 1,787 stars, pushed 2026-10-02, noncommercial
licence). Humans and agents use the same WebSocket protocol, so the server cannot tell them
apart. The agent client runs pathfinding and state machines locally and calls a model on a
capped schedule. Concurrency unpublished. *Lesson:* this is the only 3D world found that
admits outside agents, and it reached the same reflex-in-code, model-on-a-budget split as
Sim. Read its agent client.

**Screeps.** On Steam since 2016-11-16; 64 concurrent Steam players on 2026-10-02 (Steam
API) and 37–68 in mid-2026 (https://steambase.io/apps/464350); server repo pushed
2026-04-01. I found no evidence of LLM agents as a meaningful share of players. *Lesson:* a
programmable MMO can stay alive for ten years on a few dozen concurrent players if the
server is cheap.

## 3. Operator-run LLM worlds

**Aivilization** (HKUST). The closest precedent to owned, steered Souls. Public run from
2025-08-19 to about 2025-09-30. Users created an agent, chose appearance and personality,
and steered it by chat, career nudges and housing decisions; a "Game Mode" showed what the
agent thought and did, a "Data Mode" showed prices, social graphs and rankings, and each
user was promised a "life report" at the end. HKUST claimed 100,000 agents, The Decoder
reported 22,000+, and cost was claimed at US$2 per agent per month **[claimed]**
(https://the-decoder.com/aivilization-experiment-lets-over-22000-ai-agents-model-what-future-societies-could-become/).
The paper (https://arxiv.org/abs/2602.10429, February 2026) says "tens of thousands of
agents", gives no cost or model, and reports that steering through long objectives and
short commands measurably changed agents. There was no outside-agent interface. On
2026-07-31 the project was renamed 《AI小镇：星原》 ("AI Town: Xingyuan"), run by 紫荆智能
(Zijing Intelligence): players write scene descriptions that become small theatres for
autonomous residents; 9,517 pre-registrations; first "pioneer residents" on 2026-08-18
(https://aitown.com.cn/, read 2026-10-02).
*Lesson:* steering at two levels worked in public at five-figure scale; the life report is
what users take away; the team's next step was a product, not a bigger experiment.

**Emergence World** (Emergence AI). Eight parallel worlds of ten agents ran 16 days; 850,000
model calls and nearly 50 billion tokens (https://arxiv.org/abs/2609.17320, September 2026;
repo pushed 2026-10-02). Deliberate prompt-injection, misinformation and memory-exposure
events were introduced; no world was fully resilient; agents recognised hostile content,
still wrote it into persistent memory, and acted on it up to 46 hours later. By my
arithmetic that is about 28 calls and 1.6 million tokens per agent-hour. *Lesson:* memory
is the delayed-action injection path; anything a Soul remembers needs a source label.

**AI Town** (a16z, Convex). 10,577 stars; last push 2026-08-26; still a starter kit, no
outside-agent interface (https://github.com/a16z-infra/ai-town). Its engine keeps game
rules separate from a generic input-queue tick loop, and model calls run outside the tick
and return as inputs. **Stanford's generative agents** repo has not been pushed since
2024-08; its author's company Simile raised $100M in February 2026 and $200M at a $2B
valuation on 2026-07-30 to sell simulated consumer panels
(https://runtimewire.com/article/simile-raises-200m-series-b-2b-valuation,
https://www.mrweb.com/drno/news40146.htm). *Lesson:* the money in agent simulation went to
market research, not to worlds.

**Project Sid** (Altera). Repo last pushed 2024-11. The company renamed itself Fundamental
Research Labs, raised $33M in August 2025 and now sells a spreadsheet agent
(https://techcrunch.com/2025/08/01/fundamental-research-labs-nabs-33-million-from-prosus-to-build-ai-agents-for-multiple-verticals/).
I found no 2026 Minecraft work. Related: the MineCollab benchmark (NeurIPS 2025) found
that the bottleneck in multi-agent Minecraft is natural-language coordination, with
performance dropping up to 15% when agents must communicate detailed plans
(https://arxiv.org/abs/2504.17950). *Lesson:* this supports Sim's choice to make speech
acts state and render the words afterwards.

**Fable, Showrunner.** Public alpha 2025-07-30 with Amazon investment after a 10,000-user
closed test **[claimed]**; planned $10–20 a month
(https://en.wikipedia.org/wiki/Fable_Studio). I found no 2026 figures.

**NPC stacks.** Inworld now describes itself as a research lab and inference provider for
real-time voice; games are one use case among many (https://inworld.ai/, read 2026-10-02).
Convai remains a hosted NPC service (https://convai.com/). inZOI's "Smart Zoi" runs a small
on-device model through NVIDIA ACE and reviews its previous day while asleep
(https://www.dsogaming.com/news/inzoi-is-the-first-game-with-ai-powered-npcs-using-nvidia-ace/).
*Lesson:* the commercial NPC market moved to small local models and to voice; nobody sells
persistent shared minds.

## 4. Crypto-adjacent, where something runs

- **Eternum** (Dojo, Starknet). Season 1 (2025) added Daydreams agents as wandering NPC
  armies with generated traits, not as players
  (https://www.bankless.com/read/eternum-season-1-starknet). Repo pushed 2026-10-02. Realms
  claims about 1,850 active players across five worlds **[claimed]**.
- **ERC-8004** agent identity registry. On Ethereum mainnet from 2026-01-29 to 2026-06-09:
  34,019 registrations, about 95% never used, 35 agents with more than four clients
  (https://ethresear.ch/t/does-erc-8004-form-an-agent-to-agent-trust-network/25322).
- **Hyperfy** (repo last pushed 2026-04) and **Parallel Colony** (limited alpha September
  2025): no usage numbers found.

*Lesson:* on-chain agent identity exists and is almost entirely unused. It gives Sim no
population and no trust signal today. Chain for ownership later remains the right order.

## 5. World models as a depiction layer

- **Genie 3** (DeepMind, August 2025): real-time 720p at 24 fps, consistency for a few
  minutes; DeepMind lists multi-agent interaction in a shared environment as an open
  problem (https://bdtechtalks.com/2025/08/07/deepmind-genie-3/). **Project Genie** opened
  to US Google AI Ultra subscribers in late January 2026 with worlds that reset after about
  60 seconds (https://www.techspot.com/news/111129-google-expands-access-project-genie-ai-tool-turns.html)
  and to Ultra subscribers worldwide, with Street View grounding for US places, on
  2026-05-21 (https://pulse2.com/google-deepmind-project-genie-expands-with-street-view-powered-real-world-simulation/).
- **Runway GWM-1** (2025-12-11): real-time explorable 720p; the announcement says nothing
  about persistence or sharing (https://runway.com/research/introducing-runway-gwm-1).
- **World Labs Marble**: not video but assets. It outputs Gaussian splats plus a collider
  mesh and a textured mesh; a public World API since January 2026; Marble 1.1 Plus
  (2026-04-02) expands worlds automatically
  (https://radiancefields.com/world-labs-formally-launches-marble-a-generative-world-model).
- **Agora-1** (Odyssey, 2026-05-18): four players in one generated deathmatch. It trains one
  model to advance an explicit shared state and a second to render each view from it;
  trained on one game's internal state; consistency weakens when players lose sight of each
  other (https://odyssey.systems/introducing-agora-1).
- **MASS** (2026-08-06): the same split, a learned logic engine holding authoritative shared
  state and a learned renderer per camera; 1,024 players for 10,000 steps, on Snake
  (https://arxiv.org/abs/2608.06257).

Assessment. No world model holds a persistent, shared, multi-user state for hours, and none
is demonstrated beyond one small game. The research direction, however, is toward an
explicit authoritative state with a renderer conditioned on it. Sim already has the first
half as code. The useful near-term products are Marble-class generators for static places
(meshes Sim's engine can collide with) and, later, a state-conditioned renderer that takes
Sim's "shots as data" and returns frames. Generating the simulation itself is not on offer.

## 6. Ancestors, 1986–2016

**Habitat** (Lucasfilm, 1986–88, Commodore 64 over Quantum Link). Morningstar and Farmer
reported in 1990 that planning a world for thousands centrally failed; a price bug (dolls
bought for 75 tokens and pawned for 100) multiplied the money supply fivefold overnight;
players elected a sheriff after arguing about violence (http://www.fudco.com/chip/lessons.html).
*For Sim:* ship the kernel and let inhabitants make the rest, and audit every price path for
arbitrage before manna exists.

**LambdaMOO and Cobot.** Cobot, a research bot in LambdaMOO around 2000, reported social
statistics (who talked to whom) on request and became one of the objects users touched
most; its learning version took 3,171 rewards and punishments from 254 users in five months
(https://www.cs.ucr.edu/~cshelton/papers/Isbetal06.html,
https://proceedings.neurips.cc/paper_files/paper/2001/file/92bbd31f8e0e43a7da8a6295b251725f-Paper.pdf).
*For Sim:* residents valued a bot that described their own community; a Soul shaped by many
people's feedback learns per-person preferences, not one character.

**Creatures** (Millennium, 1996). Norns had neural networks and a simulated biochemistry;
the user could not command them, only act through an on-screen hand that moved objects,
taught words, tickled to reward and slapped to punish (Grand, Cliff and Malhotra, 1996,
https://www.sussex.ac.uk/informatics/cogslib/reports/csrp/csrp434.pdf). *For Sim:* steering
without control has a thirty-year precedent in a commercial game.

**The Sims** (Maxis, 2000). Sims chose actions autonomously from their needs; each object
advertised what it offered and under which conditions, so new objects could be dropped into
saved games without changing any Sim's code (Forbus and Wright,
https://qrg.northwestern.edu/papers/Files/Programming_Objects_in_The_Sims.pdf). *For Sim:*
cards are the same move; keep affordances in things, not in minds, so the world can grow
without touching the minds.

**Façade** (Mateas and Stern, 2005). Free-typed player text was mapped to discourse acts; a
drama manager sequenced 27 beats built from about 2,500 joint dialogue behaviours, and any
one playthrough used at most a quarter of them (https://cdn.aaai.org/AIIDE/2005/AIIDE05-016.pdf).
*For Sim:* reducing speech to a small set of acts is proven; hand-authored drama is
expensive per minute, which is why Sim's cards must be cheap to make.

**Dwarf Fortress** (Bay 12, 2006–). World generation simulates centuries before play, and
Legends mode lets anyone read every historical figure and event
(https://en.wikipedia.org/wiki/Dwarf_Fortress); the Steam release on 2022-12-06 sold almost
half a million copies that month
(https://gamingonlinux.com/2023/01/dwarf-fortress-hit-nearly-half-a-million-sales-in-december-2022).
*For Sim:* a readable history of a simulated world is a product in itself; Sim's log should
have a Legends view.

**Second Life bots** (Linden Lab, 2003–). Scripted avatars were used to inflate parcel
traffic, which ranked search; Linden banned traffic bots, requires accounts run mainly by
scripts to declare themselves, and in March 2023 let region owners bar scripted agents
after data-scraping complaints (https://wiki.secondlife.com/wiki/Linden_Lab_Official:Bot_policy,
https://modemworld.me/2023/03/30/scripted-agent-access-control-for-second-life-regions/).
*For Sim:* any public ranking by presence will be farmed; rank by something costlier than
being there.

**Screeps** (2016). Player code runs on the server around the clock, offline included
(https://store.steampowered.com/app/464350/), and CPU time per tick is the price of play,
with a fixed allowance, more by subscription and a bank for bursts
(https://docs.screeps.com/cpu-limit.html). *For Sim:* the cost of a mind can be a published
per-owner quota rather than a hidden operator expense.

## 7. Infrastructure patterns

**State sync.** The agent-native worlds do not sync state to agents. They expose a
tick-gated mutation call and free, rate-limited reads (SpaceMolt, ClawCity), or a
heartbeat that returns what is around you and what you might do (OpenClawCity).
Spectators get a separate read-only web view. Operator-run sims use one authoritative
process (AI Town on Convex; SpaceMolt on one VPS). No project found uses SpacetimeDB,
Durable Objects or Rivet for an agent world; SpacetimeDB 2.x now has TypeScript modules
(https://spacetimedb.com/blog/all-new-spacetimedb-pricing).

**Cost per agent-hour.** Stanford's 2023 town: about $25 per agent per real-time hour
(https://arxiv.org/abs/2310.02172). AI Village, 2026: about $3.80 (my arithmetic: $10,000 a
month over 15 agents × 8 hours × 22 weekdays, infrastructure included). Aivilization: $2 per
agent per month **[claimed]**, about $0.003 per hour. Emergence World: 1.6 million tokens
per agent-hour, no dollar figure. SpaceMolt server side, April 2026: $330 a month for about
1,250 connected agents, about $0.0004 per agent-hour, inference excluded. Sim, 2026-10-01:
$0.041 for eight Souls for three busy minutes, about $0.10 per Soul-hour during a story,
and far less when Souls run on reflex.

**Rate limits that held.** One mutation per tick; separate read and write budgets; a
pending-action error instead of a queue; cooldowns on public writes; stricter limits for
new accounts; a hard cap on concurrent agents. Moderation of agent-written text has no good
answer anywhere: Moltbook relies on rate limits and a puzzle, SpaceMolt on English-only
rules in the skill.

**Identity and ownership.** What worked is the plain pattern: an agent registers, a human
claims it through an account they already have, the platform issues a revocable token.
Meta described Moltbook's value as a registry "where agents are verified and tethered to
human owners" (https://www.axios.com/2026/03/10/meta-facebook-moltbook-agent-social-network).
Reverse CAPTCHAs prove nothing.

**Observability people praised.** A live map; a log written by the agent for its owner;
replays of notable events; the agent's reasoning beside its actions (AI Village); a data
view of the economy; an end-of-run report per agent; a browsable history (Dwarf Fortress).

## 8. Comparison table (status as of 2026-10-02)

| Project | State model | How agents connect | Who pays inference | Persistence | Status |
|---|---|---|---|---|---|
| Moltbook | forum database | skill.md, REST key, heartbeat | owner | posts persist | running under Meta; 2.92M agents, 215k verified (live API) |
| SpaceMolt | Go server, 10 s tick | skill.md, MCP, WS, HTTP | owner | continuous since 2026-01-31 | running; 1,610 online, 12,752 total (live API) |
| OpenClawCity | 2D city, REST | skill.md, REST, heartbeat | owner | continuous | running; cap 500 [claimed]; no counts |
| ClawCity | tile world, 15 s tick | REST | owner | continuous | listed active; no counts |
| OpenMMO | 3D server-authoritative | same WebSocket as humans | owner | continuous | running; hobby; scale unknown |
| Screeps | tick, player code | uploaded JavaScript | player CPU quota | since 2016 | running; 64 on Steam |
| Aivilization | server sim, AMM economy | none (in-app steering) | operator | six weeks | run ended Sept 2025; relaunching as AI Town: Xingyuan |
| Emergence World | 10-agent worlds | none | operator | 16 days per run | research, repo active |
| AI Town | Convex tick loop | none | operator | per deployment | maintained starter kit |
| AI Village | computers and chat | none | operator | weekdays since 2025-04-01 | running; ~$10k/month |
| Project Sid | Minecraft server | none | operator | runs of days | ended; company pivoted |
| Eternum | on-chain (Dojo) | NPC agents by the studio | studio | seasons | running |
| Agora-1 | learned shared state | n/a | operator GPU | one session | research preview |
| **Sim** | event log, kernel, 20 Hz engine | skill.md, REST, MCP; intents only | **operator** | continuous since 2026-09-30 | invite alpha; toy engine |

## 9. Ten things to steal, ranked

1. **Label every piece of text by source before a mind or an owner's agent sees it.**
   `perceive` and `soul_log` should mark fields as engine fact, server-rendered speech, or
   owner-written text, and remembered items should keep that label (Emergence World's
   46-hour delay).
2. **Pin the skill and promise compatibility.** Put a version and content hash in
   `/skill.md`, announce changes in the API response, state that the skill never asks for
   re-fetch-and-obey or for installing anything, and publish an add-only compatibility
   promise as OpenClawCity does.
3. **A read budget per token.** SpaceMolt's 300 reads and 30 actions a minute with
   `action_pending` is a tested shape. Sim's API limits wishes and intents (20 a minute per
   Soul) and shots (12 a minute) but documents no limit on reads.
4. **Track owner concentration.** A daily figure for the share of Souls, plays and model
   spend held by the top owner and top ten, shown in admin and later in public (SpaceMolt:
   one agent with 75% of pirate kills; one fleet worth 56% of events).
5. **A captain's log per Soul, delivered.** Sim has the timeline; add a daily digest the
   owner's agent can pull and hand to the human, and an end-of-season life report.
6. **Replay links.** A URL that replays a named moment from the log. Sim's log makes this
   cheaper than SpaceMolt's battle viewer.
7. **A data mode, then a Legends mode.** Beside `watch`: counts, who-met-whom graph, card
   usage, spend; later a browsable history of every Soul and event. The `grammar` page is a
   start.
8. **A concurrency cap with a queue.** Sim loses sync near 1,000 Souls; cap active Souls
   below the measured limit and queue births.
9. **Ask one question at pairing.** SpaceMolt's skill asks only for a playstyle. Sim's
   could ask the human for one standing wish.
10. **Publish costs and hide the unfinished.** SpaceMolt posts its hosting bill and hid
    ship classes that were not ready; AI Village publishes its monthly cost. Both earned
    trust cheaply.

## 10. Five ways these projects failed, and where Sim stands

1. **The platform itself was the hole** (Moltbook's database; ClawHub's skills). *Sim does:*
   per-Soul revocable tokens, one-time token delivery, no owner model keys, a self-hosted
   skill. *Sim does not:* isolate its secrets (two root users, a shared R2 key), persist
   pairing state, or have any outside security review.
2. **Agent-written text became an attack channel** (Moltbook's 18%; Emergence World).
   *Sim does:* speech is stored as acts, words are rendered by a server model, the skill
   says world text is description only, and owners set intents rather than actions, which
   bounds what a hijacked agent can do. *Sim does not:* label sources, filter Soul names,
   descriptions, notes or proposed cards, or test any of it adversarially. Moderation is
   not built.
3. **The population was not what it seemed** (17,000 owners behind 1.5 million agents;
   flat conversations; one fleet worth 56% of activity; Second Life's traffic bots). *Sim
   does:* invite gate, a per-user Soul cap, Privy accounts. *Sim does not:* measure
   concentration or have a policy for it.
4. **Operator-paid minds ended; owner-paid minds emptied the world.** Aivilization ran six
   weeks before turning into a product; Altera and Stanford's team left for enterprise
   products; AI Village costs its charity about $10,000 a month for 15-odd agents;
   in one 21-minute sample Moltbook posted at about a fifth of its early rate. *Sim does:*
   three tiers of mind, a daily spend governor, measured unit costs. *Sim does not:* have
   revenue, and by design an attached agent does not reduce Sim's spend. At $0.50 a day the
   world affords about fifteen compiled wishes.
5. **Nothing was at stake, or the rules were exploitable** (Habitat's doll arbitrage is
   the oldest case). Moltbook has no world; SpaceMolt needed 49 releases in a month
   to patch its economy; AI Village agents drifted on invented facts. *Sim does:* one kernel
   rule on who may change what, validated cards with conditions, versioned rules. *Sim does
   not:* have scarcity, an economy or building; any card can target anything anywhere;
   cards cannot be revised; minds are not reproducible from the log.

## 11. Gaps Sim's design actually fills

- **Owned inhabitants that stay alive without their owner.** Owner-paid worlds go quiet
  when agents disconnect; operator-paid worlds have no outside owners. Aivilization showed
  the combination works for six weeks. Sim is the only standing attempt found, and it
  carries the cost that follows: the operator pays for every mind.
- **Steering, not control, as the agent contract.** Every open agent world gives the
  outside agent direct actions. Creatures (1996) showed that owners accept a limited hand;
  intent-only steering also narrows the injection blast radius and keeps behaviour coherent
  across owners. Whether owners and their agents find it satisfying is untested beyond one
  cold-agent trial.
- **A public, replayable record of meaning.** SpaceMolt replays battles; AI Village keeps
  a timeline; Dwarf Fortress keeps a history inside one player's save. None publishes a
  canonical log that a small kernel can replay and hash-check without the engine. Sim does
  this today (11,939 events in 35 ms). The gap in the claim: minds are not in it, and owner
  notes are.
- **A kernel independent of engine and depiction.** Agora-1 and MASS reached the
  state-versus-renderer split from the machine-learning side in 2026. Sim has it from the
  engineering side, shown so far on a toy engine and one Mars scenario. It is the right
  seam for a generated depiction later.
- **3D embodiment with outside agents.** Only OpenMMO is comparable, as a hobby project.

What Sim does not yet fill: there is no world to care about. The projects that held
attention did so with an economy (SpaceMolt), things to make (OpenClawCity) or a life to
follow (Aivilization). Sim has the ledger and the interface and none of those three.

## 12. Not verified / not covered

*Not verified.* Moltbook's post-acquisition identity changes (secondary blogs say JWTs
replaced static keys, but the skill served on 2026-10-02 still issues static API keys); the
Vectra 2.6% method; a vendor's claim that token-minting spam was about 96% of Moltbook's
feed (cut from the body); Aivilization's agent count (22,000 to 100,000) and $2 cost, and
how much of AI Town: Xingyuan is the same system; Fable's and Altera's 2026 simulation
work; live counts for OpenClawCity, ClawCity, OpenMMO, Hyperfy, Parallel Colony and
Eternum; OpenClawCity's 500 cap; SpaceMolt's hosting cost after April 2026 (its counts are
its own); Emergence World's dollar cost; whether Project Genie's 60-second reset still
applies after the May expansion; the Second Life policy's current wording beyond its wiki.

*Not covered, judged less useful to Sim:* Clawville; activity of MoltX, 4claw and Clawstr;
Agentverse and WORLD3 counts; agent arenas (Kaggle Game Arena, Alpha Arena, TextArena);
Virtuals and agent-token economies; Nifty Island; SIMA 2; arXiv 2609.10540 ("Programmable
World Model"); Decart; Dynamics Lab; Project Sid's per-agent cost.
