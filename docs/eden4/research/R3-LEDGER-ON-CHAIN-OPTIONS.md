# R3 — Putting the ledger on chain: options, costs, and what to decide now

Research date: 2026-10-02. Prices were read on that date from primary pages, public APIs or chain RPC calls unless marked otherwise. Builds on [`03-SIMULATOR-CHAIN-AND-NEUTRALITY.md`](../03-SIMULATOR-CHAIN-AND-NEUTRALITY.md) (one simulator, versioned rules, the rollup analogy) and [`18-KERNEL-CARDS-AND-SELF-CHANGE.md`](../18-KERNEL-CARDS-AND-SELF-CHANGE.md) (plays and mints) without repeating them.

Terms used below. **Event log**: Sim's append-only record; the world state is whatever a deterministic **fold** (the kernel) computes by replaying it. **Play**: an event recording that someone used an action card (card hash, who, on what, manner). **Mint**: an event creating a new action card, a small content-hashed JSON program with a first author. **Anchor**: publishing a short digest of the log somewhere the operator cannot rewrite. **L1**: Ethereum mainnet. **L2**: a cheaper chain that settles to Ethereum (Base is used for prices). **Checkpoint**: a signed statement "after N events the log root is X and the state hash is Y".

## 1. Short answer

The goal is "a ledger which records actions over time, one that we can potentially put on chain … immutable". That sentence contains three properties with very different prices:

- **Immutable and publicly verifiable**: almost free. A hash-chained log, a signed daily checkpoint, a free Bitcoin timestamp, and a public copy of the log plus the replayer let anyone check that history was not rewritten. Under $15 a year at any scale considered here, plus storage.
- **Ownable** (a card as an object someone holds): about a tenth of a cent per card on an L2, and it can be added later without touching history, provided cards are identified today by a full-length content hash and a recorded first author.
- **Neutral execution** (nobody, including Eden, can cheat or stop the world): expensive. It requires a fully on-chain world, a fraud-proof or validity-proof system, or an appchain. Most teams that built this for games stopped in 2025–2026. Defer it; nothing in the cheap path blocks it.

Two things cannot be added later: proof that a record existed on a given date, and a signature by the person who originated an action. Those should start this month.

## 2. The log today and its growth

Read from the Sim repository on 2026-10-02 (`apps/server/src/migrations.ts`, `packages/engine-contract/src/hash.ts`, `packages/kernel/src/cards.ts`):

- Events are SQLite rows `(world_id, seq, tick, kind, author, payload JSON, at)`, replicated to object storage by Litestream. The kernel folds `birth`, `play`, `mint`, `deck`, `retire` and `rules`; there is also a `decision` kind.
- A canonical serialiser exists (`stableStringify`: sorted keys, `undefined` dropped, `-0` normalised, non-finite numbers rejected) and `hashOf = sha256(stableStringify(x))`.
- A card's hash is that digest **cut to 16 hex characters (64 bits)**; the kernel state hash is compared at the same length.
- Events carry no hash, no link to the previous event and no signature. `author` is a server-side identifier; the `users` table has a `wallet` column.
- `infra/verify-kernel.ts` replays the log without the engine and compares the result with the live hash.

**Measured volume** (live world, 2026-10-02): 50,970 events in about 2.5 days with 7 inhabitants, of which 30,952 are decisions and 19,609 plays. That is about 2,900 events per inhabitant per day (1,770 decisions, 1,120 plays, about 20 other). A play is 150–300 bytes of JSON and a minted card 0.5–2 KB; 250 bytes is used as the average below. Kernel-only replay of all 50,970 events took 2.8 s, about 18,000 events per second.

| Inhabitants | Events / year | Raw size / year | Without decisions | Full replay of one year |
|---|---|---|---|---|
| 7 (today) | 7.4 M | 1.9 GB | 2.9 M, 0.7 GB | 7 min |
| 25 | 27 M | 6.6 GB | 10 M, 2.6 GB | 25 min |
| 200 | 213 M | 53 GB | 84 M, 21 GB | 3.2 h |
| 2,000 | 2.1 B | 530 GB | 840 M, 210 GB | 32 h |

Two consequences. First, decisions are 61% of events. Whether they belong in the public, hashed record (they are model choices that lead to plays) is a decision with a 2.5× effect on every storage figure (section 8, decision 1). Second, at 200 inhabitants and above, replay from genesis stops being something every verifier does casually; verifiers would start from a checkpointed state, which is why checkpoints should carry a state hash from the start. Compression of JSON logs is typically several-fold but was not measured here.

## 3. Price snapshot (2026-10-02, about 18:30 UTC)

| Item | Value | Source |
|---|---|---|
| ETH; BTC; AR | $2,677.53; $84,566; $4.24 | CoinGecko `/simple/price` API |
| L1 gas price; blob base fee | 0.229 gwei; 0.0118 gwei per blob gas | `eth_gasPrice`, `eth_blobBaseFee` on a public RPC; [Etherscan](https://etherscan.io/gastracker) showed 0.21 gwei at 18:11 UTC |
| Base L2 gas price; L1 data fee | 0.006 gwei; under $0.00002 for a 200-byte transaction | `eth_gasPrice` on `mainnet.base.org`; `getL1FeeUpperBound(200)` on Base's gas price oracle (`0x42…0F`) |
| Bitcoin fee rate | 4–5 sat/vB | [mempool.space API](https://mempool.space/api/v1/fees/recommended) |
| Arweave | 13.40 AR per GiB → **$56.8/GiB, one payment** | `arweave.net/price/1073741824` |
| Arweave via Turbo (card payment) | **$88.67/GiB** | `payment.ardrive.io/v1/rates` |
| Cloudflare R2 | $0.015 per GB-month, egress free | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Celestia / EigenDA / Ethereum blobs, 30-day average | about $0.021 / $0.038 / $0.058 per MB | [growthepie](https://www.growthepie.com/data-availability) API, fees paid ÷ data posted (unit assumed GB) |

Derived costs (standard EVM gas figures, not measured deployments):

- **L1 anchor** (store a 32-byte root, emit an event, about 45,000 gas): **$0.028**. Gas has been 100× higher in past years; at 20 gwei it is $2.40.
- **Base anchor** (about 50,000 gas): **$0.0008** including the L1 data fee.
- **Direct Bitcoin anchor** (about 150 vB): $0.51. Through **OpenTimestamps** it is free: public calendars aggregate submissions into one Bitcoin transaction. All four default calendars returned HTTP 200 on 2026-10-02; the [server repository](https://github.com/opentimestamps/opentimestamps-server) was last updated 2026-08-15.
- **L1 calldata**: 40 gas per non-zero byte under EIP-7623, about 41.9M gas or **$26 per MiB**. One transaction is capped at 16,777,216 gas ([EIP-7825](https://eips.ethereum.org/EIPS/eip-7825), live since the Fusaka fork of 2025-12-03), about 400 KB. The next fork, Glamsterdam, is "testing on devnets", Sepolia fork 2026-10-06, mainnet "Q4 2026, date not yet confirmed"; a further calldata repricing (EIP-7976) is among the proposals under consideration ([ethereum.org](https://ethereum.org/roadmap/glamsterdam/)).
- **One blob** (128 KiB): $0.004, so about $0.03/MiB plus the carrying transaction. Nodes prune blobs after 4,096 epochs (about 18 days); blobs prove data was published, they do not store it.

## 4. The options

### (a) Anchoring: commit to the log, store the data elsewhere

Compute a Merkle root over event hashes, sign a checkpoint containing it, and publish the root where nobody can rewrite it. The data itself lives in ordinary or permanent storage.

- *Buys:* immutability from the first anchor onward (any later rewrite is provable) and public proof of when each record existed. It does not buy correct execution, neutrality or ownership.
- *Where to anchor:* OpenTimestamps (free, Bitcoin-backed, confirms within hours); an L2 contract (under a cent, readable by other contracts, depends on that L2 surviving); L1 (cents, the strongest EVM-readable option). They combine freely.
- *Where to keep the data:* object storage (already in place; under $1 a month at 200 inhabitants after a year; not credibly permanent); Arweave (one payment, built for permanence); Celestia, EigenDA or blobs (cheap, but retained for days to weeks, so they suit a rollup, not an archive); L1 calldata (permanent, about 450× the Arweave price).
- *Engineering:* days: a checkpoint job, a 30-line contract if an EVM anchor is wanted, an upload script. *Lock-in:* none.

A chain-free relative is the transparency log behind Certificate Transparency and the Go checksum database ([C2SP tlog-tiles](https://github.com/C2SP/C2SP/blob/main/tlog-tiles.md)): signed checkpoints that independent witnesses co-sign only if consistent, which catches an operator showing different histories to different people. A chain anchor is a witness nobody has to recruit. Publishing log segments in the tlog-tiles layout costs nothing and reuses existing verifiers.

### (b) Cards as on-chain objects

A minted card is already a content-hashed program with a first author. Three levels:

1. **Registry entry** `contentHash → (firstAuthor, mintSeq, checkpoint)`: about 65,000 gas, $0.04 on L1, $0.001 on Base. The Ethereum Attestation Service can record the same without a custom contract; no primary per-attestation gas figure was found.
2. **Full card bytes on chain** (0.5–2 KB): roughly $0.04 as L1 calldata, $0.13–0.40 in L1 contract storage, about a cent on Base.
3. **Token**: ERC-721 for a unique card, ERC-1155 if copies in decks are the unit.

**Lazy claiming** is cheaper still: the operator anchors a root covering all mints, and a card becomes a token only when someone pays to claim it with an inclusion proof. Cost is zero until there is demand.

*Royalties.* ERC-2981 only reports a royalty; nothing enforces it ([ERC-2981](https://eips.ethereum.org/EIPS/eip-2981)), and large marketplaces made creator fees optional from 2023 ([The Block](https://www.theblock.co/post/183518/opensea-creates-tool-to-help-nft-collections-enforce-royalties-on-chain)). ERC-721C enforces fees by restricting transfers to cooperating venues, a shrinking set: Magic Eden ended EVM marketplace support on 2026-03-09 ([crypto.news](https://crypto.news/nft-marketplace-magic-eden-exits-bitcoin-evm-trading/)). What works is paying creators at the point of use inside one's own system. For Sim that is convenient: every play passes through one sequencer, so "a play credits the card's first author" can be a kernel rule and a ledger entry with no chain. A chain is needed only to make that credit withdrawable or tradable. Attribution registries such as Story Protocol (IP registry plus a royalty module that splits revenue between parent and derived works, [docs](https://docs.story.foundation/docs/overview)) model the same idea on their own chain; their adoption was not assessed.

*Precedents for "valuable declarations".* **Loot** (2021, 8,000 free text lists of items) saw about $280M of secondary volume and 100-plus derivatives within a month, then a 95% fall in monthly volume a month later ([Decrypt, 2022](https://decrypt.co/108354/loot-one-year-later-nft-hype-dead-lootverse-hope-lives-on)); a builder community (Realms, Eternum) survived. **Nouns** auctions one token a day into a treasury its holders govern; on 2026-10-02 the contracts showed 2,011 Nouns and a treasury of 81 ETH, 2,249 wstETH and 163 rETH (read by RPC; other assets not counted). **On-chain item and recipe tables** (MUD worlds, Pirate Nation, Dojo games) were composable in principle; few outsiders built on them and most hosts have closed. Value followed scarcity by rule plus a treasury or continuing use, not being on chain.

*Buys:* ownership and composability. *Constrains:* a card's bytes become frozen public content (decision 6). *Engineering:* one to two weeks for registry and claim flow. *Lock-in:* low if the token only points at the content hash.

### (c) Fully on-chain "autonomous world" frameworks

These put state and rules in contracts so that the world runs without its makers.

- **MUD (Lattice)**: state in on-chain tables, logic in Systems behind a World contract, an indexer for clients ([mud.dev](https://mud.dev/introduction)). Lattice announced on 2026-04-15 that it was winding down; its chain Redstone stopped on 2026-05-15 at 23:59 UTC; after that, only plain-wallet withdrawals through L1 remained possible; MUD stays open source; the DUST world moved to its own chain supported by 0xPARC ([TechFlow](https://www.techflowpost.com/en-US/newsletter/119817), [ChainCatcher](https://www.chaincatcher.com/en/article/2258693); the original post on X was not read). MUD's main branch was last committed 2025-09-30.
- **Dojo (Cartridge, Starknet)**: Cairo models and systems, still maintained (core release 2026-05-06, Cartridge Controller 2026-09-08; Eternum and Loot Survivor repositories active in September–October 2026).
- **Others**: CCP's EVE Frontier left MUD/Redstone for Sui (announced 2025-10-08, [Decrypt](https://decrypt.co/343962/eve-frontier-jumps-ship-ethereum-sui-heres-why)); Proof of Play (Pirate Nation) announced its closure on 2026-08-05 and open-sourced its contracts ([Cointelegraph](https://cointelegraph.com/news/proof-of-play-shut-blockchain-gaming-thesis)).

For Sim this means the kernel rewritten in Solidity or Cairo, card programs interpreted on chain, and **every play a transaction**. At an assumed 300,000 gas per play on Base (about $0.005), plays alone cost about $14,000 a year today, $49,000 at 25 inhabitants, $390,000 at 200 and $3.9M at 2,000. Models cannot run on chain, so the mid-brain and card compiler stay off-chain actors submitting transactions.

*Buys:* the strongest neutrality and composability. *Costs:* a rewrite, the highest lock-in (language, chain, indexer), and dependence on a host that may shut, as Redstone did.

### (d) Verifiable replay without consensus

Publish the log, the rule versions and a deterministic replayer; anyone recomputes the state hash and compares it with the signed checkpoint.

- **Plain re-execution.** Already works internally. To make it public: pin the replayer by commit and lockfile hash, publish segments and checkpoints. A year of history replays in minutes today and hours at 200 inhabitants; verifiers can start from any checkpointed state. Cost: storage only. A dispute is social: someone shows a mismatch.
- **Optimistic challenge with a bond.** The operator posts state roots and a bond; a challenger who proves a wrong root, by bisecting to one event executed on chain, takes the bond. Cartesi's fraud-provable RISC-V machine could run the JavaScript replayer unchanged; its mainnet test deployment is Stage 2 on [L2BEAT](https://l2beat.com/scaling/projects/cartesi-prt-honeypot-v2) but secures about $1,500. Engineering: months.
- **Validity (zk) proof of the fold.** zkVMs (SP1, RISC Zero, ZisK, Jolt) prove Rust or C programs; [ethproofs.org](https://ethproofs.org/) shows about $0.006 per proof of a whole Ethereum block. No zkVM example running JavaScript was found, so this means a Rust port of the fold that must never diverge from the TypeScript one: months of work; proving cost unmeasured.

*Buys:* verifiability, rising to trust-minimised correctness. Not neutrality of ordering: the operator still chooses what enters the log. Merkleised state commitments can be added later, because state is derived from history.

### (e) Appchain or rollup as the ledger

Run a chain whose blocks are event batches: an OP Stack or Arbitrum Orbit rollup through a provider, or a sovereign rollup posting to Celestia (ev-node and the Sovereign SDK both had commits on 2026-09-30).

- *Cost:* [Conduit's](https://www.conduit.xyz/pricing) plans are "contact for pricing" plus 5% of sequencer profit; its last public price (2023) was $3,000 a month for mainnet. Caldera's pricing page returned 404. Self-run: a node, data-availability fees (about $1,100 a year for 53 GB at Celestia's 30-day average) and operations.
- *Why it is premature:* a chain adds consensus on ordering and a bridge for assets. Sim has one sequencer by design and no assets; forced inclusion and withdrawals matter only once cards carry money. The same log format can later become a rollup's input.

## 5. Comparison

Yearly cost at today's prices for 7 / 200 / 2,000 inhabitants (1.9 / 53 / 530 GB raw, all events).

| Option | Immutable | Neutral | Ownable | Cost per year | Effort | Lock-in |
|---|---|---|---|---|---|---|
| Daily anchor: OpenTimestamps + Base (+ L1) | yes | no | no | $0.30 (+ $10 for L1), flat | days | none |
| Log copies on R2 | no | no | no | under $1 / about $5 / about $50 in year one | done | none |
| Log on Arweave (Turbo is 1.56×) | yes | no | no | $100 / $2,800 / $28,000 raw; divide by the compression ratio | days | none |
| Log as L1 calldata | yes | no | no | $47,000 / $1.3M / $13M | days | low |
| Card registry on Base, lazy claim | cards | no | yes | near zero until claimed; $0.001 per claim | 1–2 weeks | low |
| Fully on-chain world on Base | yes | yes | yes | $14,000 / $390,000 / $3.9M | rewrite | high |
| Public log and replayer | detectable | no | no | storage only | days | none |
| Bonded challenge or zk proof | yes | partly | no | small compute plus contracts | months | moderate |
| Appchain | yes | partly | yes | provider fee or a self-run node | months | high |

## 6. What in the log format matters today

Ranked by how hard each is to fix later.

1. **Timestamps cannot be backdated.** History before the first anchor can only be proven to have existed by that anchor's date.
2. **Signatures cannot be added to the past.** Without them the ledger says "the operator states that X did Y". Actions chosen by server-side models can only ever carry the operator's signature; the record should say so.
3. **Short hashes become public identities.** A 64-bit hash can be collided with about 2^32 work, trivial on a laptop: harmless on a trusted server, unacceptable for something ownable. Full hashes of existing cards can be recomputed now at no cost; it gets awkward once anything external refers to the short form.
4. **Encoding must be byte-identical everywhere.** `stableStringify` is close to RFC 8785 (JSON Canonicalization Scheme); every later proof system or second implementation depends on it being frozen.
5. **Event hashes and ordering** can be back-filled over the existing log at any time, so they are cheap now and cheap later; an RFC 6962-style Merkle tree gives compact inclusion and consistency proofs and supports lazy card claims.
6. **What is inside the hash.** In: `seq`, `tick`, `kind`, `author`, `payload`, rules version. Out: rendered words and model transcripts (depiction). Wall-clock `at`: in and never read by the fold, or out.
7. **User-written text** inside hashed, published payloads becomes permanent (decision 6).

SHA-256 suits all of this: Bitcoin and OpenTimestamps use it, and the EVM has a cheap precompile for it.

## 7. Staged recommendation

**This month: near-zero cost, keeps every door open.** Roughly a week of engineering, under $15 a year in fees.

1. *Canonical serialisation.* Specify `stableStringify` as the canonical form, add cross-language test vectors, ban non-integer numbers in hashed payloads.
2. *Content addressing.* Switch card and state hashes to the full 32 bytes; recompute existing ones; keep the 16-character form for display only.
3. *Hash chaining.* Compute an event hash for every event (back-filled over the existing log) and maintain a Merkle tree over them; record the root in each snapshot.
4. *Author signatures.* Add an optional `sig` field to the event envelope; sign owner-originated events once the key type is chosen (decision 3); mark model-originated events as operator-attested.
5. *Periodic anchoring.* A daily checkpoint (event count, log root, state hash, rules version, replayer hash) signed by the operator, stamped with OpenTimestamps (free) and written to a minimal contract on Base (about $0.30 a year). Add an L1 write (about $10 a year) only if decision 5 favours Ethereum.
6. *Publication.* Publish checkpoints, proofs and log segments (tlog-tiles layout) at a public address, and turn `verify-kernel.ts` into a documented public verifier. Keep R2 as the store.

**Defer, with the trigger for each:**

- *Arweave archive* until outside parties depend on the record; at today's 7 inhabitants it would be about $100 a year raw.
- *Card registry with lazy claims* on one L2 until there is an audience that wants to hold cards. Before then, attribution credit per play lives in the kernel.
- *Bonded challenge or zk proof of the fold* until the world holds value someone would cheat for.
- *A rollup* only if neutrality of ordering becomes a requirement.
- *Not recommended:* porting the kernel to MUD or Dojo. The price is a rewrite, a per-play fee rising to hundreds of thousands of dollars a year at 200 inhabitants, and dependence on an ecosystem that contracted sharply in 2025–2026.

## 8. Decisions for the owner

Needed before this month's work:

1. **Do decisions belong in the public record?** They are 61% of events. Keeping them hashed and published preserves full auditability of model behaviour; keeping only plays, mints and other kernel events cuts storage 2.5×.
2. **Publish the full log, or only commitments?** Public replay requires public payloads; commitments alone give immutability without verifiability.
3. **Identity and key type for authors.** Wallet keys (secp256k1 with EIP-712 signatures; chain-friendly; the users table already has a wallet column) or Ed25519 keys held by owners' agents. Which event kinds must be signed.

Needed before any registry or token:

4. **Who is a card's first author** when the compiler model wrote it: the Soul, the owner whose wish triggered it, or both.
5. **Anchor venues.** OpenTimestamps only, or also an EVM chain, and which one. The choice signals where cards would later live.
6. **Free text in the permanent record:** accept permanence, or separate text from hashed payloads.
7. **Attribution versus ownership.** Attribution can be permanent and non-transferable while ownership is tradable; which one earns credit per play.
8. **Retiring an owned card** (open in doc 18) needs a rule.
9. **Succession** (open since doc 03): who may sequence if Eden stops. Publishing log, rules and replayer makes a fork possible; it does not say which fork is canonical.

## 9. Not verified

- Gas per anchor, registry entry and on-chain play are standard-cost estimates, not measured deployments; no primary figure for an EAS attestation on Base was found.
- growthepie's data unit was assumed to be GB.
- Lattice details come from two secondary reports (ChainCatcher's 2026-05-16 07:59 is probably the same instant in UTC+8); the original post was not read.
- JSON compression ratio and zk proving cost are unmeasured; the replay rate is one measurement on one machine.
- Rollup-provider prices are not public; the $3,000 a month figure is from 2023.
- Glamsterdam's mainnet date and scope are not fixed. Nouns figures exclude other treasury assets and staking-token exchange rates.

## Sources

- Ethereum: https://etherscan.io/gastracker ; https://ethereum.org/roadmap/glamsterdam/ ; https://eips.ethereum.org/EIPS/eip-7825 ; https://ethresear.ch/t/worst-case-block-size-and-calldata-repricing-for-glamsterdam/23895
- Storage: https://arweave.net/price/1073741824 ; https://payment.ardrive.io/v1/rates ; https://developers.cloudflare.com/r2/pricing/ ; https://www.growthepie.com/data-availability
- Anchoring: https://opentimestamps.org/ ; https://github.com/opentimestamps/opentimestamps-server ; https://mempool.space/api/v1/fees/recommended ; https://github.com/C2SP/C2SP/blob/main/tlog-tiles.md
- Cards and royalties: https://eips.ethereum.org/EIPS/eip-2981 ; https://www.theblock.co/post/183518/opensea-creates-tool-to-help-nft-collections-enforce-royalties-on-chain ; https://crypto.news/nft-marketplace-magic-eden-exits-bitcoin-evm-trading/ ; https://docs.story.foundation/docs/overview ; https://decrypt.co/108354/loot-one-year-later-nft-hype-dead-lootverse-hope-lives-on
- Autonomous worlds: https://www.techflowpost.com/en-US/newsletter/119817 ; https://www.chaincatcher.com/en/article/2258693 ; https://mud.dev/introduction ; https://github.com/dojoengine/dojo ; https://github.com/BibliothecaDAO/eternum ; https://docs.starknet.io/architecture/fees/ ; https://decrypt.co/343962/eve-frontier-jumps-ship-ethereum-sui-heres-why ; https://cointelegraph.com/news/proof-of-play-shut-blockchain-gaming-thesis
- Verification: https://l2beat.com/scaling/projects/cartesi-prt-honeypot-v2 ; https://github.com/cartesi/dave ; https://ethproofs.org/ ; https://docs.succinct.xyz/docs/sp1/prover-network/faq
- Rollups: https://www.conduit.xyz/pricing ; https://cointelegraph.com/news/conduit-launch-app-deploy-l3-rollup-50-dollars ; https://github.com/evstack/ev-node ; https://github.com/Sovereign-Labs/sovereign-sdk
