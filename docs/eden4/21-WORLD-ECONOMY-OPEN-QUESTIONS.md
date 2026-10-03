# 21 — The economy of many worlds: open questions

> Status (2026-10-03, round 19): **nothing here is decided.** Gene: "the
> economic model is premature." "for now the worlds are going to be just held
> and modulated through code manually through me and some enthusiasts until i
> see this has sticking power." This note saves the discussion so the next round
> starts from it. Earlier economy notes for a single world: [`04`](04-ECONOMY-AND-PROPERTY.md).
> Dials: [`13`](13-PARAMETERS-AND-TRADEOFFS.md).

## 1. Gene's ideas, in his words

- "anyone can mint a world. world's have one birth a day (each is a mini Nouns
  DAO) -- this maybe lets me have both scalability but maintain the one birth a
  day sacred ritual across all worlds."
- "worlds are owned separately and owners pay against a harberger tax or
  something to cultivate the world over time?"
- "at most 1 birth a day (or we can allow birth rate to be a parameter that
  owner can set? world owner sets own fertility? pretty weird. is there death
  built into the system? that could be interesting if sad). maybe thats it --
  you have to pay rent as the player. the rent goes to owner? they set rent?"
- "birth rate could be changeable could make sense if the owner was the one
  collecting taxes from the tenants and it wasnt a birthrate it was a harberger
  type mechanism where the sims bid to be part of that world. is that another
  model?"
- On configuration: "the way they configure them… maybe sets the constants of
  that world in a way. Maybe it sets the limits of it. The laws."

## 2. Why per-world births matter

In round 8 Gene withdrew "one body a day" because it "artificially constrains
growth in a very fundamental way, persistently and forever." One birth a day
**per world** answers that: growth comes from the number of worlds, and each
world keeps the ritual. All worlds could hold the birth at one shared moment.

## 3. Two models (Claude's analysis)

| | **A. Births per world** (Nouns style) | **B. Residency under Harberger** |
|---|---|---|
| Who makes Souls | each world births its own | Souls exist apart from worlds |
| What is scarce | Souls of that world | residency slots in that world |
| How a Soul joins | born there | bids for a slot |
| Owner's income | auction income (to the world's DAO) | a continuous tax on residents' self-assessed slot values |
| Owner's lever | birth rate (dilutes existing Souls) | number of slots (residents can sell and leave) |
| Leaving | unclear | sell the slot, or be bought out at your own price |
| Soul travel | must be designed | built in: Souls are global, residency is local |

- B aligns the owner with the world: income grows when slots are worth more.
- B makes a changeable slot count safe, which is Gene's "changeable birth rate".
- B stacks: residents pay tax on slots to the owner; the owner pays tax on the
  world to Eden.
- Both can coexist: a world may have **natives** (born there) and **residents**
  (slot holders). Claude's lean: B as the default, native births as an optional
  constant per world.

**The weak point of B is Harberger on a home.** Anyone can force a sale at the
resident's price. Mitigations: a grace period to match a bid; a minimum
residency; automatic compensation at the stated price; a tax rate matched to
how often slots change hands (Weyl and Posner). Earlier crypto Harberger
experiments (This Artwork Is Always On Sale, Wildcards, Geo Web) had thin
markets: few bidders, low prices, little tax.

## 4. Rent, and who checks the owner

```
residents --rent--> owner --Harberger tax--> world DAO (= the residents)
owner's profit = rent − tax − compute bill
```

- High rent makes the world worth more, so the owner assesses higher and pays
  more tax back to residents, or risks a buyout.
- Rent covers what a Soul really costs: model spend is per Soul; Sim's governor
  already meters it.
- **The main check on rent is the right of exit.** Minimum rule proposed: a Soul
  may always leave a world.
- Rent changes are laws: they take effect after a notice period.
- **Harberger on a whole world conflicts with its residents**: a stranger could
  buy the laws and code of a world where others live. Remedies: the tax goes to
  the world's DAO; the DAO's treasury can always buy the world back.
- Who owns a world? Proposed split: the **operator** holds the right to run it
  (laws, code, curation), under Harberger; the **DAO** holds the treasury and
  the right to buy the operator out.

## 5. Birth and death as constants

- Split a world's settings into **constants** (set at genesis; changed only with
  residents' consent) and **laws** (changed by the owner, logged, with notice).
- Birth rate as an owner setting is safe only as a constant: changing it dilutes
  existing Souls.
- **Death as an optional constant: lifespan.** With b births a day and a
  lifespan of L days the population settles at b × L. No cap is needed. It
  returns to the Abraham covenant's arc that ends in release (`01`).
- A dead Soul's history stays in the log. Open: what happens to its things.
- Keep **death** (natural, a constant) apart from **eviction** (rent unpaid:
  the Soul leaves and goes dormant; it does not die).

## 6. Eden's income, and failure

- A share of every world's auction or tax income.
- The cost of running each world (compute, models), billed to that world.
- A world that cannot pay lapses: frozen and archived, never deleted. Its log
  stays replayable. Residents keep their Souls.
- An empty world must not make births nobody wants (Nouns burns a token when an
  auction gets no bid).

## 7. Prior art to check before deciding

- **Nouns Builder** (Zora, 2022): anyone launches a Nouns-style DAO with daily
  auctions; over 200 launched; some pay a share to Nouns DAO. Not checked: how
  many are still active.
- Second Life land rent and absentee owners (`research/R8`).
- The Sims Online and why the one shared world failed (`research/R7`).
- Ledger and chain options (`research/R3`).
- Legal review is needed before any auction that funds a treasury that pays a team.

## 8. Open questions

1. Model A, model B, or both?
2. Can a Soul travel between worlds? At least: may it always leave?
3. Which settings are constants and which are laws?
4. Is there death? Per world? What happens to a dead Soul's things?
5. Who owns a world: an operator, a DAO, or the split in §4?
6. Who sets rent, and what stops extraction?
7. Does a daily birth ritual exist at the Eden level, the world level, or both?
8. What does Eden charge a world?
9. What happens to an empty or unpaid world?
10. When, if ever, does any of this go on a chain?
