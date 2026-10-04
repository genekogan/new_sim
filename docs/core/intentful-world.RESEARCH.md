# Evidence for the intentful-world proposal

Research record, October 3 EDT / October 4 UTC, 2026. Companion to
[the proposal](intentful-world.PLAN.md) and
[reproducible allowance arithmetic](intentful-world.BUDGET.json).
Core worktree base: `621af25689d50e1fd10ff9bd236d0d5c70e20e15`.

This is source inspection and primary-document research. No new paid model
comparison, physical benchmark, restart test or live privacy experiment was
performed. Provider documentation establishes advertised interfaces and rates,
not the quality of a model on Eden's tasks. The proposal's new schemas, outcomes,
workload volumes and delivery sequence are engineering hypotheses.

## 1. The preferences this design is trying to satisfy

Gene's current instruction asks for meaningful verbs, composition, richer
places/doing/intents, personal memory, contextual dialogue and negotiated group
activity. The ambition is organized emergence rather than many cosmetic build
choices. His standing preferences include dynamic reconsideration, purposes
that become more sophisticated as rules accumulate, stewardship, evolving
rituals and lasting changes built from raw material.

[Core's charter](<team>/CHARTER-core.md) makes several boundaries
binding: no timetable/routine object; one steering mechanism; human ownership;
model-free replay; keep simulation running when money runs out; no economy or
world ontology design. The proposed $2 ceiling comes from Gene's latest direct
instruction and has not changed the existing budget configuration or charter.

[World's design](<worktrees>/world/mars/docs/engineering/briefs/world-vocabulary-upgrade.PLAN.md)
provides concrete demand for surfaces, slopes, water, boats, expressive phases
and anatomy-appropriate participation. It targets the new Eden landscape. It
does not itself implement simulation authority. The proposed Core work supplies
that authority while World owns depiction and Game owns its screens/account
policy. [PM reconciliation](<team>/RECONCILIATION-20261003.md),
[W-001](<team>/CONTRACTS/W-001-baseline.md) and
[G-001](<team>/CONTRACTS/G-001-baseline.md) remain the baseline
checkpoint, not approval of this expansion.

## 2. What inspection of the current system establishes

All source links below refer to the Core worktree. Line numbers locate the
relevant definitions at the research base and may move during implementation.

| Evidence | Observation | Design implication |
|---|---|---|
| [Engine contract](<worktrees>/core/packages/engine-contract/src/engine.ts:43) | A Program has one actor and sequential steps. perform replaces its existing program; admission checks the first step. | More verbs alone do not provide general concurrent execution or guarantee a whole sequence remains feasible. |
| [Deck selection](<worktrees>/core/apps/server/src/deck.ts:94) | Default cap is 12, raised to 24 for living Souls. Ranked card/target candidates normally admit three targets per card. | The narrow menu is an exposure/ranking issue as well as a controller issue. The universal twelve-option description in older docs is stale. |
| [Mind context](<worktrees>/core/apps/server/src/brain.ts:182) | The mind gets nearby entries, recent actions, needs/journal and current social/rule context. | Richer experience must be selectively retrieved; dumping all histories into every decision is neither private nor affordable. |
| [Decision fingerprint](<worktrees>/core/packages/brain/src/mid.ts:162) | It includes option IDs and selected context fields, but not the full needs/journal/weather/time context. | Context invalidation needs explicit dependencies. This is a source finding, not a newly reproduced behavioral failure. |
| [Decision/reflection loop](<worktrees>/core/apps/server/src/brain.ts:148) | Eden minds wake for an agenda or active rules; asynchronous choices check intent version; daily reflection starts at phase 0.55. | Preserve idle Eden and event-driven purpose. New async results need relevant-fact checks in addition to intent version. |
| [Needs and fallback](<worktrees>/core/packages/brain/src/living.ts:4) | Four needs; several changes depend on activity-label regexes; fallback considers needs, mandate and journal words. Journal output is bounded to 1,200 characters. | Registered phase effects and evidenced episodic memory can deepen motivation without multiplying arbitrary meters. |
| [Compiler](<worktrees>/core/apps/server/src/brain.ts:423) | Current compilation is forced-tool Anthropic generation with an ephemeral system cache marker and bounded validation. | Retain one alignment path; extend its lowering and receipts, and measure whether the prefix actually caches. |
| [Generative client](<worktrees>/core/packages/brain/src/llm.ts:10) | Anthropic-specific request shape, optional system cache marker, fixed output cap and known-price assumptions. | A different model name is insufficient to integrate a provider. Usage, errors, reservations and structured outputs need adapters. |
| [Paid gate](<worktrees>/core/packages/brain/src/paid.ts) | Durable pre-contact reservations, explicit supported pricing, actual cache/token settlement and uncertain-failure accounting already exist. | Extend the hard cap; do not replace it with an optimistic average-cost calculation. |
| [Governor](<worktrees>/core/apps/server/src/governor.ts:8) | Five fixed tier shares and estimated call costs shape scheduling. | Adaptive, fair scheduling can allocate attention to novelty and consequential acts while preserving owner interpretation capacity. |
| [Budget configuration](<worktrees>/core/apps/server/src/config.ts:28) | Config, Brain setter and admin route clamp budget to $1. | The proposed $2 allowance needs an explicit coordinated implementation, not just a config value. |
| [Native registry](<worktrees>/core/mars/viewer/engine/api/registry.ts:53) | Versioned native activities greatly exceed the living vocabulary. | Expose and compose proven controllers first; semantics changes must change the physical rules version. |
| [Native action contract](<worktrees>/core/mars/viewer/engine/actions/types.ts:98) and [runtime](<worktrees>/core/mars/viewer/engine/runtime/runtime.ts) | Plans, reservations, child actions, safe exits and resumability exist; whole-actor claims dominate ordinary action admission. | Fine claims should be opt-in. Every concurrent physical writer must be accounted for; legacy claims remain exclusive. |
| [Paired walk](<worktrees>/core/mars/viewer/engine/activities/paired-walk.ts:55) | Ground-only authored corridors, free hands, bounded regrouping and explicit pause/resume. | Useful precedent for cooperation, not proof of general walk/talk, slope travel or durable active-state restoration. |
| [Spatial types](<worktrees>/core/mars/viewer/engine/spatial/types.ts:10) and [spatial service](<worktrees>/core/mars/viewer/engine/spatial/service.ts) | Horizontal surfaces and discrete levels, authored access links, clearance and deterministic navigation machinery. | Reuse pathing, but explicitly add continuous terrain/stacked support and water. A render mesh is not a navigation contract. |
| [World state](<worktrees>/core/mars/viewer/engine/world/types.ts:30) | Physical supports, human hands/activity/riding/levels already represent authoritative constraints. | Swimming and boat occupancy belong here or in a qualified successor representation, not solely in animation state. |
| [Vehicle profiles](<worktrees>/core/mars/viewer/engine/vehicles/profiles.ts:30) | EUC and bicycle are ground vehicles with rider offsets and movement restrictions. | Boats can reuse controller patterns, but water routes, draft, docking and passenger frames are new work. |
| [Body policy](<worktrees>/core/mars/viewer/engine/bodies/policy.ts:56) | Humanoid/floater roles distinguish supported, approximate and refused activity. | Duck and later families need tested equivalents and physical bounds, not human verbs pasted onto another rig. |
| [Kernel types](<worktrees>/core/packages/kernel/src/types.ts), [kernel](<worktrees>/core/packages/kernel/src/kernel.ts), [fold](<worktrees>/core/apps/server/src/fold.ts) | Things/Links/cards provide bounded meaning changes; the fold lowers accepted decisions into physical programs. | Grow symbolic recipes within this mechanism. Physical accomplishment requires controller evidence. |
| [Mandate protocol](<worktrees>/core/packages/protocol/src/mandate.ts) | Existing alignment, rule status and NOW/time/gathering semantics are established. | Richer objectives and event dependencies should extend this mechanism and preserve reporting semantics. |
| [Prompt route](<worktrees>/core/apps/server/src/http.ts:114) | Sign-in is checked, then the prompt is retrieved by hash without its Soul/world authorization association. | Correct and prove this locally before adding richer private memory. PM independently documented the same missing check; no unrelated live prompts were fetched. |

The detailed initial inventory, ownership map, qualified soaks, gate limitations
and known replay faults are retained in
[Core's survey](<team>/LOG-core.md). Existing proof establishes
the bounded merged engine; it does not establish the new proposal. Remaining
questions include mid-program recovery, quiet-barrier behavior and mint/reference
semantics. Preserve historical F9 agenda skipping for legacy events rather than
silently making new recipe prerequisites inherit it.

## 3. What primary research contributes

The useful synthesis is *personal evidence + bounded affordances + independent
choices + deterministic physical resolution*. No examined paper alone supplies
that complete Eden architecture.

| Primary work | Useful result or mechanism | Eden adaptation and limit |
|---|---|---|
| [Generative Agents](https://arxiv.org/html/2304.03442v2), Park et al., 2023 | Memory retrieval, reflection and planning supported social behavior among 25 agents, including propagated invitations. The authors also report memory/retrieval and fabrication failures. | Use source-backed memory and reflection. Do not import daily timetable generation. Embodied contacts, concurrent tasks, human authority and exact replay require additional mechanisms. |
| [Versu](https://cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf), Evans and Short, 2014 | Social practices offer role-sensitive affordances; agents choose among opportunities contributed by concurrent practices. | Finite scene offers and compatible participation are a stronger model than assigning everyone a scene script. Its social representation is inspiration, not a replacement physics engine. |
| [Concordia](https://deepmind.google/research/publications/64717/), Google DeepMind | Component-based agents use context/memory; a game-master layer resolves their interactions with an environment. | Separate actor perspective, proposed action and environmental resolution. In Eden the kernel/physical code resolves authority and effects; a world model may suggest opportunities above that boundary. |
| [Voyager](https://arxiv.org/html/2305.16291v2), Wang et al., 2023 | A reusable skill library and execution feedback improve open-ended Minecraft behavior. | Learn bounded, verified declarative recipes with provenance and quarantine. Generated arbitrary code is unsuitable as an unqualified physical capability in a replayable shared world. |
| [Behavior Trees in Robotics and AI](https://arxiv.org/abs/1709.00084), Colledanchise and Ögren | Modular execution and reactive switching make task controllers easier to compose and analyze. | Use finite execution recipes and guard-driven cancellation. A task controller is not the Soul's psychology, daily plan or global narrative script. |
| [SOTOPIA](https://arxiv.org/abs/2310.11667), Zhou et al., 2023 | Interactive social evaluation considers more than linguistic fluency. | Evaluate independent goals, responses and social consequences alongside physical/replay checks. A social benchmark score does not prove Eden emergence or embodied correctness. |

The proposal's ambition to exceed Smallville is a testable target. Compare fixed
situations and multiple seeds with affordance-only, composition, memory and
hybrid-generation variants. Record causal chains, actual participation, lasting
artifacts, refusals and useful recall. Novel-looking prose is insufficient.

## 4. Provider evidence and decisions

Rates and account availability are time-sensitive. These sources were inspected
for the October 4 UTC proposal. USD figures are standard text API prices per
million tokens; free tiers and batch tables are not the default runtime rate.

### Jev

[Models](https://docs.typesafe.ai/models),
[Choice](https://docs.typesafe.ai/primitives/choice),
[fan-out](https://docs.typesafe.ai/patterns/fan-out) and
[Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
support bounded typed selection and multiple questions against shared state.
Jev 1.13 input is $0.042/M and output free; Choice allows up to 255 options.
Its documented weaknesses reinforce doing numeric geometry/time checks in code,
filtering irrelevant context and testing option-order sensitivity. Multi-question
requests save duplicated state; extra questions are not free. No cache discount
was verified. These facts do not establish quality on a much larger menu.

### Cheap generative candidates

[OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano) and
[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna): nano is
$0.05 input/$0.40 output; Luna is $0.10/$0.50 and supports no-reasoning use.
Both document structured interfaces. Nano is the cheapest generator in this
comparison; Luna is a proposed trial, not a measured winner. Count billed
reasoning and repairs, not just visible words.

[Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing):
Haiku 4.5 is $1/$5 and Sonnet 5.5 $2/$10. Existing integration makes Haiku a
useful compiler baseline despite its higher cost. Stronger interpretation stays
exceptional; it is not the per-tick controller.

[Google pricing](https://ai.google.dev/gemini-api/docs/pricing),
[Gemini 2.5 Flash-Lite availability](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite)
and [3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite):
2.5 Flash-Lite's $0.10/$0.40 rate has an existing-user access restriction;
3.5 Flash-Lite is $0.30/$2.50. Do not prescribe the cheaper legacy endpoint to
a new account or rely on free-tier handling for private owner context.

### Caching and batching

[Claude cache documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
specifies Haiku 4.5's 4,096-token minimum. Five-minute writes cost 1.25 times
ordinary input, hits one tenth; reuse refreshes lifetime. Marking a smaller
prefix does not establish a hit. Speech/reflection currently lack the compiler's
cache marker. Test actual usage receipts before assigning savings.

[OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching)
documents different behavior across model generations. The proposed Luna
baseline uses uncached input, no reasoning and explicit-only caching without
breakpoints. If caching is later enabled, qualify prefix length, writes, hits,
lifetime and changing suffixes. This is a measured optimization, not the reason
the allowance sketch fits.

[Google caching](https://ai.google.dev/gemini-api/docs/caching) and pricing
include explicit-cache storage. Retention can exceed inference savings; cache
only a demonstrably useful scoped prefix. Verify the precise chosen model's
minimum rather than inferring Lite support from a different Flash model.

[OpenAI Batch](https://developers.openai.com/api/docs/guides/batch),
[Claude Batch](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
and [Gemini Batch](https://ai.google.dev/gemini-api/docs/batch-api) document
discounted asynchronous generation. A 24-real-hour response window is twenty-four
world days here. Use for offline comparisons and delayed consolidation, not
timely social or physical control. Google cached batch hits use standard cached
rates; discounts do not stack identically across providers. Delayed summaries
must preserve evidence cutoffs.

### Subscriptions

[Codex authentication](https://learn.chatgpt.com/docs/auth#sign-in-with-an-api-key)
documents API-key use for programmatic CLI workflows.
[Claude credential guidance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)
distinguishes native subscription access from product/service integrations and
requests on behalf of users. A noncommercial operator aggregating others' text
does not by itself establish a supported credential flow. Use subscriptions for
supervised development and personal steering assistance; qualify any proposed
native automated workflow separately. The runtime estimate requires no
subscription capacity or token extraction.

## 5. What is ready, and what remains empirical

Source, worktree and documentation access are ready. Jev/Anthropic key presence
is configured in the canonical local environment; credentials were not printed
and no paid authentication test was made. The checked process/canonical env did
not have configured OpenAI/Gemini keys. Optional provider comparison therefore
needs model access/billing later, through local secret setup. Nothing is needed
from Gene to review this proposal.

The allowance JSON assumes input lengths and call volumes, not measured outputs.
It explicitly includes compiler cache writes and a planning margin. Real input
growth, billed reasoning, failures and lower-than-expected useful output can
change feasibility. Actual rolling reservations remain the enforcement boundary.

Outstanding qualification: compositional writer claims; support/water/boat
restart codecs; independent recipient choices; prompt/memory isolation; current
model quality and latency; historical engine-epoch replay; 24/30-Soul physical
capacity; archive growth. These are commissioning gates for implementation,
not reasons to block the independent design work.
