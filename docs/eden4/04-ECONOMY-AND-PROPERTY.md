# 04 — Economy and property

Gene: *"This is something we'll have to design as we go. Upgradeable is good
here. We have to make a society."* Versioned rules (see `03`) make tuning
the economy legitimate rather than arbitrary.

## Manna

- **Every body receives manna daily (UBI).** It can spend or save it. New
  manna enters every day, which inflates the economy.
- **Uses of manna:** building materials, placing art in buildings, new
  features or floors, steering (if steering costs rise with age), and
  possibly attendance or other rewards.
- Today, manna is Eden's prepaid usage credit (billing plumbing). In this
  vision it becomes the world's money.

### On-chain ERC-20 or in-game currency? (Open, Gene's question)

Claude's lean: **start manna as an in-game ledger** whose balances are part
of the committed world state (covered by the state roots in `03`), with
**bodies as the on-chain NFTs** that carry value. Reasons:
- UBI inflation plus demurrage plus rule changes are awkward and brittle as an
  ERC-20, and every change becomes a contract migration.
- A liquid token invites speculators first, and the audience order is
  friends → believers → speculators last. It also raises regulatory exposure.
- It's still verifiable and survives Eden going away, because it's in the
  replayable state.
- A bridge or withdrawal to an ERC-20 can be added later as an upgrade.

Counterpoint to weigh: a native on-chain token is more "able to live alone"
and more composable with web3, and was part of earlier Eden/Spirit thinking
(see `07`).

Gene: *"maybe the whole game can revolve around [NFTs]. maybe this is the
comeback of NFTs."* The body NFT is the unit of ownership, steering and
identity. Artworks placed in the world could be NFTs too (Open).

## Idle wealth problem

**Round 8 lean (Claude):** make idle bodies the world's patrons. Their
presence counts as attention, and unspent UBI flows by default to what they
attend or follow. This serves Gene's round-8 aim (idle bodies alive and
influential) and removes idle wealth without a new mechanism. The numbers
(UBI rate, demurrage) are shelved; see `13` §4.

**Round 8 (arrival pricing):** bodies are no longer one-a-day auctions;
Claude's lean is a continuous price on a target schedule (VRGDA). The
treasury loop below holds with "sales" in place of "daily auctions".

Idle bodies earn UBI and spend little, so old idle bodies become the richest
citizens. That's the opposite of the intended dynamics. Candidate remedies
(Gene is open to all; to be designed as we go):
- **Demurrage** (manna decays over time). It also rhymes with "letting go."
- **Negative inflation or taxes.**
- **Incentives to spend:** rewards, earnings and awards for building,
  attending or patronizing.
- **A default spend policy** for idle bodies (tip or donate to what they
  visit, commission things).

## Center vs. frontier: inertia

Gene: the center builds up and becomes harder to change (more expensive,
more limitations), and the edge is the continual frontier. *"center city is
the richest and the frontier is the poorest but more dynamic."* The frontier
slowly stratifies as well, and a famous, consistent center emerges.

Claude's candidate rule (Leaning): **cost to change a thing = base × age ×
attention**, where attention = measured foot traffic, visits and blessings.
The ground "remembers attention." One rule produces the gradient, and it
doubles as moderation (see `05`).

## Parcels, commons and Harberger

Tension: Decentraland parcels are too rigid (idle and absentee owners, one
editor at a time, no dynamism). Pure commons leaves no way for early people to
**really sculpt a place**, for example a Little Martians area in the center.

Claude's earlier lean: **stewardship, not ownership**. You're the steward of
what you build while it's maintained or visited, and inertia protects it.
Early builders shape the center naturally because the center *is* early.

Gene is *very* interested in **Harberger taxes for some kind of rights**, but
not on parcels (that brings back rigidity). He wants to support both extremes
and a continuum between them, without adding many rules.

Claude's proposal (Leaning, **one rule, a continuum**; its scope was challenged, see below):
- Harberger applies to **protection rights over a thing** (a structure, a
  facade, a room's door), not to land.
- **The default is commons:** anything can be modified by anyone, subject to
  inertia costs.
- A steward can **self-assess a price** for protecting their thing and pay
  an ongoing tax on it (in manna, to the treasury or UBI pool). While they pay,
  others can't modify it, but **anyone can buy the protection right at that
  price**.
- **Price 0 = pure commons; a high price = Decentraland-like control.** Every
  point in between is available, and it's still just one rule.
- Idle owners either keep paying or lose protection, so absentee lock-in
  dissolves by itself.
- Open: how this interacts with inertia (does age/attention raise the
  minimum, or replace the tax?) and whether tax flows to the treasury or
  straight back as UBI (a classic Harberger/common-ownership design).

### Gene's objection: what does protection cover? (Open, 2026-09-28)

Protection may make sense for *a painting on a facade*. But **who decides
what to build**: whether to add a new room, or whether it's glass, metal or
wood? The underlying question is **what the unit of "a thing" is** and **who
holds write authority over it.** Unresolved. Candidate framings (Claude, none
endorsed):

- **Scene-graph granularity.** The world is a tree: site → building →
  structure / surfaces / rooms / media. Protection attaches to a node and
  covers its subtree. Material is a property of a node. Adding a room to a
  protected building means editing that subtree, so it's blocked or needs the
  steward. Risk: nesting makes it complex again.
- **Protect against alteration, not against addition.** Protection stops
  others from *removing or changing* your thing, but anyone may *build
  onto or next to* it. Cities grow by accretion, but a protected tower could
  get a shack glued to its side.
- **Proposals instead of locks.** Anyone can propose a change to a stewarded
  thing (a new room, a different material). The steward can accept, or the
  change goes through if the proposer pays above the steward's price or
  gathers enough blessings/attention. It turns "who decides" into a small
  market or vote per thing.
- **Authorship stays with the builder, protection only for "finished"
  layers.** Structure (what it's made of, its rooms) is decided by whoever
  builds it. Harberger only applies to finished, discrete things like
  artworks and facades, and structure is governed only by inertia.
- Fallback: drop Harberger from structure entirely; keep it only for media
  and art slots.

**Round-6 proposal (Claude, 2026-09-28, not endorsed):** the *piece* is the
only unit of state (a rack, a beam, a sheet, a media sheet, a door); a
building is an edge name. Every piece has a price = the inertia formula;
paying it transfers authorship, after which you may alter or remove it; the
fee goes to the previous author. Harberger becomes one optional term: a
self-assessed premium on top, taxed. Adding a supported piece next to or on
another is placing, not altering, so it is never blocked. Gene did not
respond to this yet (he moved to the representation question, `10`).

## Treasury

- It's funded by the daily auctions (Nouns-style), possibly plus Harberger
  taxes and fees.
- It **pays the team and makes grants** for all sorts of projects.
- Governance is open. Candidates: Nouns-style body-NFT voting, conviction
  voting or curation markets (see Gene's prior interests in `07`), or a mix.
- The loop: auction → treasury → UBI, grants and team → a better world →
  more valuable bodies → auction. Claude thinks this is the cleanest part of the idea.

## Prediction markets and token engineering

Gene: available but "let's not overcomplicate yet." Natural later hooks:
markets on which proposed body wins, what gets built next, which frontier
district becomes the next center. His open todo "prediction market (bonding
curve, 1 share of 1155)" fits here.
