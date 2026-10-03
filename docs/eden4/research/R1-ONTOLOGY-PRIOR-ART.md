# R1 — Prior art for the Sim kernel ontology

2026-10-02. Surveys systems that solved parts of the problem Sim's kernel addresses and says what each implies
for it. Facts about our own code were checked in `<old-sim-repo>/packages/kernel/src` (`types.ts`, `vocab.ts`,
`kernel.ts`, `cards.ts`) and `apps/server/src/fold.ts`. Section 10 lists what was not verified.

## 0. What is being compared

Sim's meaning layer (the **kernel**, `eden4/18-KERNEL-CARDS-AND-SELF-CHANGE.md`) holds **Things** (id, kind,
name, immutable traits, mutable states, `at` another Thing) and **Links** (kind, from, to, optional value, data
and lifetime). State changes in five ways only: appear/vanish, set, move, link/unlink, say. An action is a
**card**: a named operator with one target kind, conditions (`when`), a list of changes (`then`) and a
depiction (`approach`, `during`). **The one rule**: an actor changes only itself, what it controls and what it
made; shared outcomes come from separate single-actor plays (ask, agree, act). **Speech acts are state**
(`say` writes `said`, `asked`, `agreed` links); words are rendered afterwards and never replayed. An LLM
**compiler** writes new cards from a plain wish; a static validator checks them; valid ones are **minted** into a
shared library. An owner's plan is an **agenda** of cards. The **ledger** logs plays and mints and replays
without any model.

Five code facts recur below:

- **K1.** Links are keyed `kind|from|to`, so one link of a kind per ordered pair. One Soul can have one open
  question to another at a time.
- **K2.** `agree` writes an `agreed` link with no content, lasting 30 minutes. While it stands, the asker may take
  *any* control-flagged link on *anything* the answerer controls. It is not used up by acting on it, and nobody
  can withdraw it (speech links cannot be unlinked).
- **K3.** Control is a boolean per link kind. A controller may set any state on the thing or vanish it. A grantor
  cannot remove a grantee's control link, because only the link's holder can unlink it.
- **K4.** `vanish` removes the thing, things tied to it by `traits.with`, and every link to or from them. States
  on other things are untouched, so `host a gathering` leaves `hosting: true` on the host after the gathering
  vanishes, unless `end the gathering` was the card played.
- **K5.** A play is logged as (Soul, card name, card hash, target, manner); its changes are recomputed on replay.
  Each world's base vocabulary is pinned in its log. The validator refuses a different card under an existing
  name, so names are never reused, but a revised card needs a new name and nothing links it to the old one.
  Lapsed links become invisible without a logged event.

## 1. Planning operators

### STRIPS, ADL, PDDL

STRIPS (Fikes and Nilsson, 1971) describes an action by preconditions, an add list and a delete list, and
assumes that anything unlisted is unchanged; this is its answer to the frame problem (saying what an action
does not change). ADL (Pednault, 1989) added conditional effects and quantifiers. PDDL standardised both; PDDL
2.1 added numeric state and durative actions whose conditions hold at the start, at the end or throughout; PDDL
2.2 added derived predicates (facts computed from other facts) and timed initial literals (facts that switch at
a set time). Sources: [STRIPS](https://en.wikipedia.org/wiki/Stanford_Research_Institute_Problem_Solver),
[ADL](https://en.wikipedia.org/wiki/Action_description_language),
[PDDL 2.1](https://jair.org/index.php/jair/article/view/10352),
[PDDL 2.2](https://planning.wiki/_citedpapers/pddl222004.pdf).

- **Maps as:** a card is a STRIPS operator: `when` the precondition, `then` the effects, `target` and `derive`
  the typed parameters. `set` and `move` are single-valued and need no delete list. A link's `until` is a timed
  literal.
- **Does better:** conditional and quantified effects ("everyone attending leaves"); disjunction, counting and
  numeric comparison in conditions; derived predicates; conditions that must hold for an action's whole
  duration. Our condition grammar has ten fixed forms and none of these.
- **We add:** an authority rule on effects; depiction kept apart from meaning; operators that are data, minted
  at run time and addressed by hash.
- **Warning:** indirect effects must be listed in every card or derived (the ramification problem). K4 is an
  instance: one fact (who hosts) is stored twice, once as a state and once as a link.

Because cards are STRIPS-shaped, standard planning machinery applies. A delete-relaxed reachability check could
tell the validator whether a new card can ever be played, and extend the present one-step lookahead to several
steps cheaply. (Our inference, not a cited result.)

### HTN planning and GOAP

Hierarchical task network planning decomposes a task into subtasks by stored **methods** until only primitive
actions remain; SHOP2 plans in execution order, so it always knows the full state
([Nau et al. 2003](https://jair.org/index.php/jair/article/view/10362)). Goal-oriented action planning, used in
F.E.A.R., gives each character actions with preconditions and effects and searches for a sequence reaching a
goal, behind a state machine of three states
([Orkin 2006](https://pages.cs.wisc.edu/~dyer/cs540/handouts/gdc2006_orkin_jeff_fear.pdf)).

- **Maps as:** the wish compiler performs HTN decomposition with an LLM but keeps no methods; a deck is a GOAP
  action set; our lookahead is a search of depth one.
- **Does better:** stored, reusable decompositions; real multi-step search.
- **Warning:** F.E.A.R. keeps one description of effects for the planner and another for the game. Evans and
  Short name that gap as the reason agents repeat an action that cannot succeed
  ([Versu, p. 122](https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf)). Sim evaluates and applies
  the same card; keep it so.
- **Mechanism:** mint methods (wish pattern → agenda template) beside cards and try them before calling the
  compiler. This addresses doc 18's open problem "cost of wishes". Methods cover only foreseen cases, so the
  compiler stays as fallback.

## 2. Social simulation engines

### Versu and Praxis (Evans and Short, 2014)

Versu is an interactive drama whose autonomous characters are coordinated by **social practices**. A practice
describes a recurring situation (a greeting, a meal, a game of whist), names its roles, holds its own state and
offers actions to whoever fills each role. Practices "never control the agents directly; they merely provide
suggestions": each character chooses. Several practices run at once; a character's options are the union of
their offers. The world is a set of sentences in **exclusion logic**: `a.b` means b is one of the ways a is,
`a!b` that b is the only way, so asserting `brown.in!study` removes `brown.in!dining_room` and everything stored
under it. Practices are written without knowing which roles players will fill.
Source: [Versu](https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf) (read in full); open
reconstruction of its logic: [Praxish, 2023](https://ojs.aaai.org/index.php/AIIDE/article/view/27537).

- **Maps as:** a practice instance is a Thing with role links; "an affordance exists only inside its practice"
  is a card whose `when` requires a link to that Thing (as `dance` requires `attends`). `!` is the
  single-valuedness of `set` and `move`.
- **Does better:** practices have phases and state; data stored under a practice dies with it (our `vanish`
  does the same for links, K4); uniqueness is declared once and type-checked, where we repeat `noneLinkedTo` in
  each card; norm violations are allowed, marked and answered by other characters, where our kernel can only
  forbid; characters judge an action by applying it, scoring the result and undoing it; an inspector explains
  why a precondition failed.
- **Warning:** more than 300 desires, whose tuning the authors call difficult and unrewarding; concurrent
  practices complicated authoring and the mechanism for one practice to suppress others was too crude; all
  characters share one view of each practice's state; a twenty-minute episode took one to two months until a
  higher-level authoring tool cut it to under a week.
- **Agrees with the one rule:** "Relationship state changes should require active choice from both characters."

### Comme il Faut, Prom Week and Ensemble

Comme il Faut (CiF) models social life as **social exchanges**: an initiator proposes an exchange with an
intent (start dating, become allies), a responder accepts or rejects, and effects follow. Weighted influence
rules decide what the initiator wants and how the responder answers. A social facts database keeps history that
rules query over time windows. **Trigger rules** fire after any exchange whose condition holds (dating two
people marks a character a "two-timer"). Prom Week used over 5,000 rules. Ensemble repackaged CiF as a general
engine whose schema declares, per kind of social fact, whether it is boolean or numeric; undirected, directed or
reciprocal; its default; and a `duration` after which it reverts.
Sources: [CiF 2011](https://ojs.aaai.org/index.php/AIIDE/article/view/12454),
[CiF 2014](https://cs.uky.edu/~sgware/reading/papers/mccoy2014cif.pdf),
[Ensemble schema](https://github.com/ensemble-engine/ensemble/wiki/Schema).

- **Maps as:** one exchange is our ask, answer and effect in one unit; influence rules are our `good_when` /
  `not_for` hints scored by a small model; the schema is our link-kind table.
- **Does better:** lifetime, direction and reciprocity are declared per kind (ours are constants in code);
  conditions can ask about history; trigger rules keep definitions true without every card repeating them.
- **Warning:** the rule count. And Evans and Short's criticism: an exchange is isolated, with nothing giving a
  sequence of acts continuity. That is the scenes gap (section 7).

### City of Gangsters

A commercial strategy game with about 1,200 NPCs
([Zubek, Horswill et al. 2021](https://ojs.aaai.org/index.php/AIIDE/article/view/18912)). A relationship is a
directed edge whose valence is the sum of **history elements**; each element carries a valence change, an
optional actor and target (so a dyadic edge can record what a third party did), an optional expiry, and text
explaining it to the player ("−10: they heard that you beat up their family member"). Logic-programming rules
query the graph after actions and add history elements, which is how news of an extortion turned the victim's
brother hostile before the player had met him. The authors relate their argument to entity-component systems
(Bilas 2002), which put all game objects behind a general query interface.

- **Maps as:** a relationship computed from dated, expiring, explained events, where our links hold one current
  value and no reason.
- **Does better:** every number can say why it is what it is; expiry is per event, so relationships fade
  naturally.
- **Warning:** the explanations are hand-written per rule.

### Talk of the Town

A town simulated over decades before play, whose characters observe, tell, misremember, forget and lie
([Ryan et al. 2015](https://ojs.aaai.org/index.php/AIIDE/article/view/12825), text read). Each character holds a
**mental model** per person or place it knows, made of **belief facets** (one per attribute: workplace, hair
colour, whereabouts). A facet records its value, whether it is accurate, the facet it replaced, and a list of
**evidence**; its strength is the sum of its evidence. Evidence has nine types in four groups: origination
(reflection, observation, transference, confabulation, lie), propagation (statement, eavesdropping),
deterioration (mutation) and termination (forgetting). Each piece records source, location, time and a strength
that decays with time. A lie is received as a statement.

- **Maps as:** doc 18 section 6 ("Knowing") and the open memory problem: a belief is a link from a Soul to a
  Thing whose data holds value, evidence and strength; `said` is a statement event.
- **Does better:** knowledge has provenance, so it can be wrong, stale, second-hand or a lie.
- **Warning:** per-character belief stores grow fast; decide what is forgotten before what is kept.

### The Sims

In The Sims the knowledge of what can be done lives in objects. Each object's behaviours carry a test of
whether they are possible and **advertisements** of which needs they satisfy; a Sim picks the best advertised
behaviour, attenuated by distance. When two Sims interact, an invisible social-interaction object is created
and both Sims' threads run inside it
([Forbus and Wright 2001](https://qrg.northwestern.edu/papers/Files/Programming_Objects_in_The_Sims.pdf)). The
Sims 4 defines interactions by constraints so that compatible ones run at once
([GDC 2014](https://gdcvault.com/play/1020190/Concurrent-Interactions-in-The-Sims)).

- **Maps as:** advertisements are cards offered by Things rather than held by Souls; the interaction object is a
  minimal scene Thing.
- **Does better:** locality comes free, since only things in reach advertise; new content is a new object and no
  agent changes.
- **Warning:** Sims estimate an action's effect more simply than its real effect and so retry a blocked action
  indefinitely (Versu, p. 122). Doc 18 met the same behaviour and patched it with a cooldown.

### Dwarf Fortress, Kismet

Tarn Adams's published principles are about method: do not overplan; model underlying elements and let results
emerge; work at the level the player sees or one below
([Game AI Pro 2, ch. 41](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter41_Simulation_Principles_from_Dwarf_Fortress.pdf)).
It says nothing about social representation. Community reverse-engineering
([DFHack](https://github.com/DFHack/df-structures/blob/master/df.activity.xml), read only through a summary)
shows joint activities stored as records, each a tree of events (conversation, prayer, sparring, teaching) with a
participant list, every type hand-coded: the closed-vocabulary route to scenes.

Kismet is a small social-simulation language with near-English rules. Its authors' follow-up reports that
natural phrasing "enhances readability, but it hurts writability", citing whether "doesn't like" equals
"dislikes"; a professional designer wanted no syntax at all
([Summerville et al. 2021](https://ceur-ws.org/Vol-3217/paper15.pdf)). Lesson: a near-natural vocabulary breeds
synonyms. Keep card JSON canonical and generate a plain-language rendering for Gene rather than a second syntax.

## 3. Multi-agent systems theory

### Speech acts, KQML and FIPA-ACL

Austin separated what is said from the act performed in saying it. Searle's 1975 classification has five classes:
assertives, directives, commissives, expressives, and declarations, which change reality by being said (naming,
appointing) ([summary](https://en.wikipedia.org/wiki/Illocutionary_act); original in *Language in Society* 5).
KQML defined an extensible set of message types ("performatives") and facilitator agents that route them
([Finin et al. 1994](https://research.cs.umbc.edu/kqml/papers/kqml-acl-html/root2.html)). FIPA-ACL standardised a
catalogue of acts ([spec](http://www.fipa.org/specs/fipa00037/SC00037J.html)) and protocols; in the request
protocol the participant refuses or agrees, then reports failure or completion
([spec](http://www.fipa.org/specs/fipa00026/SC00026H.html)). FIPA defined each act by the speaker's beliefs and
intentions. Singh (1998) argued that private mental states cannot be checked among independent agents, that
"communication is inherently public", and that acts should be defined by the public commitments they create
([Singh 1998](https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/computer-acl-98.pdf)).

- **Maps as:** `say` is (act, about); "acts are state" is Singh's public semantics.
- **Does better:** the request protocol closes the loop with a completion or failure report; the taxonomy names
  two classes our base acts lack: declarations, and commissives with content (a promise to do X), which is doc
  18's open question about saying something new.
- **Warning:** never let a rule depend on what a Soul's model "believes".

### Social commitments

A commitment `C(debtor, creditor, condition)` is a public fact that one agent owes another an outcome; a
conditional commitment takes effect when its condition is met. Yolum and Singh define who may perform each
operation: the debtor creates, discharges (by performing) and cancels (usually with a compensating commitment);
the creditor releases or assigns; the debtor delegates. A protocol is then any sequence of acts that resolves the
commitments, not a fixed script. They formalise this in the event calculus, where events start and stop
time-varying facts ([Yolum and Singh 2002](https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/aamas-02-protocols.pdf)).

- **Maps as:** `agreed` is a commitment from answerer to asker; links with `since` and `until` are
  event-calculus facts.
- **Does better:** commitments have content and a full life: created, discharged, released, cancelled,
  reassigned.
- **Warning:** our `agreed` has only two of these moves, create and expire, and no content (K2). Combined with
  K1 this is the weakest point found in the kernel.

### Institutions, powers and norms

Jones and Sergot formalised **institutional power**: within an institution an agent's act *counts as* creating
an institutional fact, which differs from being permitted or physically able
([J. IGPL 4(3), 1996](https://www.ida.liu.se/ext/brs/A/Sergot/webpapers.html)). Normative-systems work
distinguishes **regimentation** (violations are made impossible) from **enforcement** (violations happen and are
sanctioned) ([survey](https://arxiv.org/pdf/1810.10591)); Shoham and Tennenholtz's social laws are the
regimented kind, designed off-line to guarantee coexistence
([1995](https://moshet.net.technion.ac.il/files/2022/08/social-laws-for-artificial-intelligence.pdf)).
**Electronic institutions** specify agent societies as scenes, each a role-based protocol with access and exit
states per role and a minimum and maximum count per role, linked by a performative structure that says how agents
move between scenes and whether a scene may run several times at once; norms turn acts into obligations, and
middleware mediates every utterance ([Esteva et al., AMELI 2004](https://iiia.csic.es/media/filer_public/b8/a0/b8a0f2a8-6ab7-49af-a6b8-597b95af9c18/iiia-2004-896.pdf), text read).

- **Maps as:** the one rule is regimentation; `control: true` is one hard-coded counts-as rule; "take the role
  only if a controller agreed" is empowerment.
- **Does better:** powers are specific to a role; roles have quotas; entry and exit are explicit; norms can be
  broken and answered.
- **Warning:** our control is all or nothing (K3). A compiled `dj of` marked as control lets the DJ rename or
  remove the gathering, and the host cannot remove the DJ. Electronic institutions, for their part, are rigid,
  closed and heavy to specify.

## 4. LLM-agent worlds

### Generative Agents and AI Town

Generative Agents (Park et al., 2023) gave 25 characters a memory stream, reflection and planning; the model
decides at run time what an action does to an object's state. A party spread by invitation and five agents
came. The authors report agents breaking location norms that are hard to convey in natural language (several
using a one-person bathroom, entering shops after closing) ([paper](https://arxiv.org/abs/2304.03442)). AI Town,
an open-source descendant, lets only the engine change game state: outside components "can only mutate them by
sending inputs". Its conversation members are invited, walking over, or participating
([architecture](https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md)).

- **Maps as:** AI Town draws doc 18's line (models propose, the kernel disposes); its conversation is a small
  scene with consent.
- **Does better:** memory retrieval and reflection (our open memory problem); an explicit state for "agreed but
  not there yet".
- **Warning:** norms that exist only in prose are not followed. AI Town's one joint activity is hand-coded.

### Project Sid

Altera ran 10 to over 1,000 agents in Minecraft, routing decisions through one "Cognitive Controller" so that
outputs agree; without it an agent "may respond with 'Sure thing!'" while choosing a different action. Agents
voted on amendments to a tax constitution ([paper](https://arxiv.org/abs/2411.00114)). The authors report weak
collaborative building and no truly new inventions.

- **Maps as:** the constitution process is doc 18's level-2 change by public decision.
- **Warning:** saying and doing diverge when produced separately. Sim renders words from the act; keep that
  order.

### Voyager and LLM-written skill libraries

Voyager writes code skills for Minecraft, indexes each by an embedding of its description, retrieves the five
most relevant, and keeps a skill only after a critic model confirms the task succeeded. The authors report the
critic missing successes, invented game facts and calls to functions that do not exist
([paper](https://arxiv.org/abs/2305.16291)); in the code a skill with an existing name replaces the old index
entry ([skill.py](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/skill.py)). Berlot-Attwell et al.
found that in two library-learning systems function reuse is "extremely infrequent" and gains came from retrying
([2024](https://arxiv.org/abs/2410.20274)). TroVE reports toolboxes 79–98% smaller than baselines
([2024](https://arxiv.org/abs/2401.12869)); SkillWeaver tests and debugs each new skill against the environment
before keeping it ([2025](https://arxiv.org/abs/2504.07079)). Guan et al. have an LLM write PDDL actions, repair
them with validator and human feedback, and translate them back to plain language for review
([2023](https://arxiv.org/abs/2305.14909)); this is the closest published analogue of our compiler.

- **Maps as:** minting is committing to the library; a deck is per-agent retrieval.
- **Does better:** skills are run before they are kept; retrieval finds an existing skill before a new one is
  written; back-translation lets a non-expert check what was written.
- **Warning:** expect most minted cards to be played once. Measure plays per card before assuming the library
  compounds.

### Concordia and Infinite Craft

In DeepMind's Concordia agents state actions in natural language and a Game Master model decides the outcome,
tracks chosen "grounded variables" (such as money) and resolves conflicting simultaneous actions
([paper](https://arxiv.org/abs/2312.03664)). Infinite Craft has a language model name the result of combining two
elements, stores it, and serves the stored result to everyone thereafter, crediting the first finder
([Wikipedia summary of press reports](https://en.wikipedia.org/wiki/Infinite_Craft); no primary source).

- **Maps as:** Concordia judges each action at run time; Sim compiles the judgement once into a card. Infinite
  Craft is mint-once-then-look-up.
- **Does better:** Concordia resolves any new action at once. Infinite Craft keys the cache by the question (the
  pair), so the same question never mints twice; our cards are keyed by content, so one wish can mint many
  near-identical cards.
- **Warning:** Concordia is not deterministic or replayable and costs a model call per action. A poor Infinite
  Craft result is permanent.

### Inform 7, TextWorld and Ceptre

Inform 7 runs every action through rulebooks in order (before, instead, check, carry out, after, report); check,
carry out and report belong to the action, while before, instead and after can be written by any place or object
([handbook](https://inform-7-handbook.readthedocs.io/en/v2.0/chapter_4_actions/action_processing/)). Relations
declare their shape ("various people to one person",
[ch. 13](https://ganelson.github.io/inform-website/book/WI_13_5.html)); scenes are spans of time with cues to start
and end ([ch. 10](https://ganelson.github.io/inform-website/book/WI_10_1.html)). TextWorld
([2018](https://arxiv.org/abs/1806.11532)) and Ceptre
([2015](https://ojs.aaai.org/index.php/AIIDE/article/view/12784)) use linear-logic rules that consume and produce
facts, and generate quests by chaining rules.

- **Maps as:** check is `when`, carry out is `then`, report is depiction.
- **Does better:** a place or host can intercept others' actions in its domain ("house rules"); relation shape is
  declared once; consuming rules conserve things by construction; chaining can build a state in which a new card
  is playable, which is a test case.
- **Warning:** interacting rulebooks become hard to predict.

## 5. Data models

**Triples and property graphs.** RDF stores subject–predicate–object triples; a statement about a statement
needs reification, which RDF 1.2 adds as "triple terms" ([RDF 1.2](https://www.w3.org/TR/rdf12-concepts/)). Our
Link is a triple plus value, data and lifetime. The standard remedy when a relation needs identity, content or
several instances is to promote it to a node. K1 says requests and agreements have reached that point.

**Datomic** stores immutable facts `[entity, attribute, value, transaction, added?]`; a retraction is another
fact and the database can be read as of any past transaction
([data model](https://docs.datomic.com/whatis/data-model.html)). Its schema guidance is to grow and never break,
never remove or reuse names, and annotate superseded ones ([best practices](https://docs.datomic.com/reference/best.html)).
Our validator already never reuses a card name (K5); what is missing is the annotation that says which card
supersedes which, and retraction of a card from use.

**Datalog with time.** Dedalus adds an explicit time argument to Datalog, so persistence and change between
steps are themselves rules ([Alvaro et al. 2009](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2009/EECS-2009-173.html)).
Our `derive` and link conditions are a small fixed-shape query; derived predicates would be named rules of this
kind.

**Event sourcing** keeps an append-only log as the truth and computes state from it; practitioners separate a
command (a request that may be refused) from an event (what happened). Our ledger logs plays, which are commands,
and recomputes their changes (K5). Replay is therefore correct only under the code that first ran them; doc 18
section 8 relies on the code hash for that. Logging each play's resulting changes as well would make replay depend
only on the five-change applier, and would make lapses explicit events.

## 6. The most actionable ideas, ranked

Ranked by expected value for the kernel as it stands.

| # | Idea | Source | What changes in kernel or cards | Cost |
|---|---|---|---|---|
| 1 | Requests and agreements with identity, content and a lifecycle | Yolum and Singh; FIPA request protocol | `ask` creates a request (a Thing, or a link keyed by id) holding what was asked; `agree` attaches to it; consent permits only what was asked, is used up when acted on, and can be released by the asker or withdrawn by the answerer; several questions may be open at once. Fixes K1 and K2 | Medium: speech handling, control check, base cards |
| 2 | Specific, revocable powers in place of boolean control | Jones and Sergot; electronic institutions | A link kind lists what it permits on its target (which states, vanish, grant). A granted role holds only while the grant link stands, so the grantor revokes by removing its own link. Fixes K3 within the one rule | Medium: validator and apply check |
| 3 | Log each play's resulting changes | Event sourcing | Ledger entry gains its change list; replay applies changes; lapses become logged events | Low; larger ledger |
| 4 | Schema on link kinds | Ensemble; Versu `!`; Inform relations | Declare per kind: cardinality (one per target, one per actor), default lifetime, reciprocity; the kernel enforces them, replacing repeated `noneLinkedTo` guards | Low |
| 5 | Scenes as practices | Versu; electronic institutions | See section 7: role link kinds with quotas, a phase state, cards per role and phase, one counting condition | Medium to high |
| 6 | Test a card before minting | Voyager; SkillWeaver; Guan et al. | Play it on a forked state; check it can ever be played; generate a plain-language gloss from its logic and compare it with its summary | Low to medium |
| 7 | Library lifecycle | Datomic; Infinite Craft; TroVE | Mark a card superseded by another or retired (decks drop it, past plays keep their meaning by hash); near-duplicate check before minting; key repeated wishes to their card; count plays per card | Low |
| 8 | Derived predicates | PDDL 2.2; Dedalus; CiF trigger rules | Named queries in the vocabulary (e.g. "hosting" = has a `hosts` link); remove duplicated state (K4) | Low to medium |
| 9 | Explained, dated evidence on social links | City of Gangsters; Talk of the Town | A relationship or belief link carries entries (change, source event, time, expiry); its value is computed from them. Gives memory provenance and lets the UI say why | Medium |
| 10 | Cards offered by Things in reach | The Sims; Versu | Default locality rule: a Soul may play its own cards and those offered by Things where it is (doc 18 open problem "locality") | Medium |
| 11 | Conditions that must keep holding | PDDL 2.1 | A `while` list on long cards; the kernel ends the activity when it breaks | Medium |
| 12 | Minted methods | HTN | Store wish → agenda templates; match before compiling | Low to medium |

Deferred: Inform-style house rules (a controller's rules intercepting plays in its domain) would be powerful but
make outcomes hard to predict; revisit after ideas 2 and 5.

## 7. Scenes and joint activities

The problem: several bodies in one coordinated activity (a class, a meal, carrying a beam) when each actor may
change only itself.

Prior art, in order of fit:

1. **Versu's social practices.** A practice instance with role bindings, its own state and per-role
   affordances, which never acts on anyone. The authors compare it directly with isolated speech acts (The Sims,
   Prom Week) and with joint behaviours that take control (Façade).
2. **Electronic-institution scenes.** Role quotas, access and exit states per role, several concurrent
   instances of one scene kind.
3. **ABL joint behaviours and STEAM.** Entry and exit by a three-phase commit among team members; members owe
   the team notice when they leave
   ([ABL](https://www.qrg.northwestern.edu/Resources/aigames.org/papers2002/MMateas02.pdf),
   [STEAM](https://arxiv.org/abs/cs/9709101)). Useful for the protocol, not for where control sits.
4. **AI Town's membership states** (invited, on the way, participating) and **The Sims' interaction object.**
5. **Event-centric behaviour** (Shoulson et al.): one structure drives several bodies
   ([paper](https://people.cs.rutgers.edu/~mk1353/pdfs/2013-mig-event-planning.pdf)). This is what a Mars
   coordinator already is; it belongs in depiction.

**Recommendation.** Define the meaning of a scene as a Versu-style practice built from kernel parts, and keep doc
19's proposal (one coordinator stages a scene Thing and is re-staged from the kernel) as its depiction.

- A **scene kind** is vocabulary: its role link kinds with minimum and maximum counts (idea 4), its phases, and
  which cards each role may play in each phase.
- **Joining, readying and leaving** are single-actor plays that write or remove the actor's own role link.
  A role that needs permission uses the request lifecycle (idea 1). Leaving needs no notice protocol: the
  removed link is visible to everyone, and they re-plan.
- **Phase changes** are cards played by a role with that power (idea 2), conditioned on the role links ("at
  least four carriers are ready"). This needs one new condition form that counts links to a Thing.
- The scene Thing **never changes a Soul**. The coordinator runs while quotas are met. When the scene vanishes,
  its role links go with it (K4); per-scene data should be stored on the scene so it dies too.
- First test: carrying a beam (tight coupling, four roles, one phase change), then a class (asymmetric roles).

Avoid scenes that take control of members (Façade's joint behaviours, drama managers), which break the one rule,
and a model judging joint outcomes at run time (Concordia), which breaks replay.

## 8. Failure modes of open, LLM-extended vocabularies

| Failure | Seen in | Mitigation others used | Sim today |
|---|---|---|---|
| Synonyms and near-duplicates | Kismet ("doesn't like" / "dislikes"); Voyager name collisions | Show the writer the existing vocabulary; nearest-neighbour check; a canonical key per question (Infinite Craft) | Names unique; near-duplicates unchecked |
| Items written once, never reused | LEGO-Prover and TroVE, per Berlot-Attwell et al. | Measure reuse; retrieve before writing; trim unused items (TroVE) | Play counts exist in the fold; not yet used |
| Valid but wrong | Voyager's critic passing failures; LLM-written PDDL needing repair | Run before keeping (Voyager, SkillWeaver); validator and human feedback with back-translation (Guan et al.) | Static validation only |
| Invented primitives | Voyager calling absent functions | Closed primitive set and strict schema | Has this |
| Bad entries made permanent | Infinite Craft's stored results | Quarantine before sharing; supersede by annotation, never edit (Datomic) | No retirement yet (doc 18 open problem 2) |
| Norms that exist only in prose | Generative Agents (bathroom, closed shops) | Put the norm in state the engine checks | Has this, via `when` |
| Loops from a wrong model of effects | The Sims; F.E.A.R. | Judge actions by their real effects (Versu) | Has this; cooldown as backstop |
| Rule and tuning explosion | CiF (5,000 rules); Versu (300 desires) | Declarative schema; reusable rule sets | A small model scores choices instead, moving cost to run time |
| Saying one thing, doing another | Project Sid without its controller | One decision point | Words rendered from the act |
| Drift in what the compiler considers normal | Named as a risk in doc 18 section 8; no prior measurement found | Fixed test set of wishes, rerun on every compiler change | Planned |

## 9. Reading list for Gene, in order

1. Evans and Short, "Versu—A Simulationist Storytelling System" (2014), sections on practices, norms and
   limitations. https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf
2. Singh, "Agent Communication Languages: Rethinking the Principles" (1998), eight pages.
   https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/computer-acl-98.pdf
3. Yolum and Singh, "Flexible Protocol Specification and Execution" (2002), sections 2–3.
   https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/aamas-02-protocols.pdf
4. Esteva et al., "AMELI: An Agent-based Middleware for Electronic Institutions" (2004), section 2 (scenes,
   quotas, norms). https://iiia.csic.es/media/filer_public/b8/a0/b8a0f2a8-6ab7-49af-a6b8-597b95af9c18/iiia-2004-896.pdf
5. Zubek et al., "Social Modeling via Logic Programming in City of Gangsters" (2021).
   https://ojs.aaai.org/index.php/AIIDE/article/view/18912
6. Ryan et al., "Toward Characters Who Observe, Tell, Misremember, and Lie" (2015).
   https://ojs.aaai.org/index.php/AIIDE/article/view/12825
7. McCoy et al., "Social Story Worlds With Comme il Faut" (2014), with the Ensemble schema page.
   https://cs.uky.edu/~sgware/reading/papers/mccoy2014cif.pdf
8. Guan et al., "Leveraging Pre-trained LLMs to Construct and Utilize World Models" (2023).
   https://arxiv.org/abs/2305.14909
9. Wang et al., "Voyager" (2023), read with Berlot-Attwell et al., "Library Learning Doesn't" (2024).
   https://arxiv.org/abs/2305.16291 and https://arxiv.org/abs/2410.20274
10. Datomic, "Best Practices" (schema growth, names). https://docs.datomic.com/reference/best.html

## 10. Not verified / not covered

- **From secondary sources only:** Searle's taxonomy (Wikipedia summary); the regimentation/enforcement
  distinction and its attribution to Jones and Sergot 1993 (survey and search snippets); Infinite Craft
  (press via Wikipedia); Dwarf Fortress activity structures (third-party reverse engineering, read through a
  summary); the FIPA act catalogue (the spec page refused the fetch; no act count is claimed).
- **Abstract or snippet only:** PDDL 2.1/2.2, SHOP2, GOAP, Sims 4 concurrency, KQML, Shoham and Tennenholtz,
  TroVE's mechanism, SkillWeaver, Guan et al., Dedalus, Kismet's original 2020 paper (not located).
- **Not checked:** independent replication of Project Sid; Greg Young's rules for versioning events; Sims 4
  "situations" with role "jobs" (only modding sources exist, so omitted).
- **Not covered:** bitemporal stores (valid time vs transaction time, e.g. XTDB); RDF named graphs for
  provenance; deontic logic beyond the institutional-power line; Crusader Kings' opinion system.
