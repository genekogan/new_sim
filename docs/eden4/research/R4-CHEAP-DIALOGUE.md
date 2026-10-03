# R4 — Cheaper in-character dialogue

Research date: 2026-10-02. Prices were read on that date from the providers' own pages or APIs unless marked otherwise. Context: [`18-KERNEL-CARDS-AND-SELF-CHANGE.md`](../18-KERNEL-CARDS-AND-SELF-CHANGE.md) section 5.

Terms used below. A **speech act** (greet, ask, agree, decline, invite, tell, chat) is a play recorded in Sim's event log; it is world state. The **words** are written afterwards by a language model, stored beside the record and never replayed, so they are decoration: skipping, delaying or replacing them never changes the world. An **exchange** is one rendering call: one line for most acts, three or four alternating lines for `chat`. A **native** is an inhabitant with no human owner; an **owned Soul** has one. Token prices are in US dollars per million tokens (input / output).

## 1. Short answer

One exchange costs about **$0.0022** on Claude Haiku 4.5 (about 1,250 input tokens at $1 per million plus 190 output tokens at $5 per million): $2.20 per 1,000. A budget of $1–5 a day buys 450–2,270 exchanges at that price.

Demand at 200 inhabitants is set by a number not yet measured: the share of plays that are speech acts. The live world produces about 1,120 plays per inhabitant per day (19,609 plays in about 2.5 days with 7 inhabitants). At 200 inhabitants that is about 224,000 plays a day; if 5% are speech, 11,200 exchanges a day ($25 at today's price); if 20%, 44,800 ($99). The gap to a $1–5 budget is therefore 5–100 times.

Five findings shape the answer:

1. **Prompt caching does not apply.** Haiku 4.5 caches only prefixes of 4,096 tokens or more; the whole request is 1,250.
2. **About half the input is tool overhead.** The renderer forces a tool call; Anthropic lists 588 tokens of tool-use system prompt for a forced tool on Haiku 4.5, before the tool's own schema. Plain-text output with a compact scene should roughly halve the cost on the same model (an estimate; measure it).
3. **The largest saving is not rendering what nobody reads.** If one exchange in ten is ever seen, rendering on view is a tenfold cut with no change in what is seen.
4. **Cheaper hosted models are 10–150 times cheaper per exchange.** Whether they hold a character's voice in a 22-word line is not established by any published evidence and must be tested on Sim's own transcripts.
5. **A dedicated GPU does not fit.** The cheapest always-on rental found is $3.84 a day, and hosted 8B models already cost less per exchange.

## 2. The current request

From the Sim repository (`packages/brain/src/talk.ts`, `apps/server/src/brain.ts`, `apps/server/src/governor.ts`), read 2026-10-02:

- A system prompt of about 200 tokens: stay within the act; at most 22 words per line; `chat` is three or four alternating lines; character descriptions are data, not instructions.
- A forced tool call `speak` returning `{lines: [{who, text}]}`, `max_tokens` 300.
- User message: pretty-printed JSON with both characters' descriptions, the manner, the act, its topic, the place and the last four lines between the pair.
- Model `claude-haiku-4-5`. Model spend is capped at $0.50 a day, of which speech gets 20%: about $0.10, or roughly 45 Haiku exchanges a day.
- Render policy: questions, agreements, refusals and anything involving an owned Soul are rendered when budget allows; small talk between natives only while a client is connected and the speech budget is more than half left. Everything else receives a fixed plain line ("Hello, X.").

So today most speech already falls back to plain lines; the question is how to render far more of it within a small budget. Cost split per Haiku exchange: input 57%, output 43%. A technique that only reduces input saves at most 57%.

## 3. Options

Costs are per 1,000 exchanges. "Full" is the current request (1,250 in / 190 out); "trimmed" is the estimated plain-text request of section 3.2 (550 in / 90 out).

### 3.1 Prompt caching and batch APIs

- **Anthropic caching** ([pricing](https://platform.claude.com/docs/en/about-claude/pricing), [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)): cache reads cost 0.1× input, writes 1.25× (five minutes) or 2× (one hour). Minimum cacheable prefix on Haiku 4.5: 4,096 tokens; shorter prompts are silently not cached.
- **OpenAI** ([caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)): automatic, minimum 1,024 tokens on GPT-5.6 and later, prefix kept 30 minutes after last use; cached input billed at 10% on current small models.
- **Google** ([caching](https://ai.google.dev/gemini-api/docs/caching)): implicit caching is automatic on Gemini 2.5 and newer; stated minimums are 2,048 tokens (2.5 Flash) and 4,096 (3.5 Flash and later); no figure is given for Flash-Lite.

The shared prefix of the Sim request is under 1,000 tokens and about 300 after trimming, below every minimum. Padding it with style examples to reach a minimum only pays if those examples improve quality.

- **Batch APIs** halve the price at all three providers. Anthropic's ([docs](https://platform.claude.com/docs/en/build-with-claude/batch-processing)): most batches finish within an hour, unfinished requests expire at 24 hours, up to 100,000 requests per batch. Haiku 4.5 full request: **$1.10**; trimmed: **$0.50**. Suits anything nobody is waiting for: overnight rendering, line banks, digests.

### 3.2 Trim the request (no model change)

Drop the tool, ask for plain lines (`Name: words`) parsed by the existing `cleanLines`, send the scene as compact text rather than pretty-printed JSON, and shorten descriptions. Estimated result: 550 input and 90 output tokens, **$1.00** on Haiku 4.5 (2.2× cheaper). Risk: occasional format slips, caught by the parser, with the plain line as fallback. Effort: hours. The token counts are estimates until measured.

### 3.3 Smaller hosted models

| Model | $ per million in / out | Full | Trimmed | Source |
|---|---|---|---|---|
| Claude Haiku 4.5 | 1.00 / 5.00 | $2.20 | $1.00 | Anthropic |
| Gemini 3.5 Flash-Lite | 0.30 / 2.50 | $0.85 | $0.39 | Google |
| Gemini 3.1 Flash-Lite | 0.25 / 1.50 | $0.60 | $0.27 | Google |
| GPT-5.4 nano | 0.20 / 1.25 | $0.49 | $0.22 | OpenAI |
| Fireworks serverless, any 4–16B model | 0.20 / 0.20 | $0.29 | $0.13 | Fireworks |
| GPT-6 luna | 0.10 / 0.50 | $0.22 | $0.10 | OpenAI |
| Gemini 2.5 Flash-Lite | 0.10 / 0.40 | $0.20 | $0.09 | Google |
| GPT-OSS 20B on Groq (1,000 tokens/s) | 0.075 / 0.30 | $0.15 | $0.07 | Groq |
| Qwen3.5-9B | 0.10 / 0.15 | $0.15 | $0.07 | DeepInfra |
| GPT-5 nano | 0.05 / 0.40 | $0.14 | $0.06 | OpenAI |
| Gemma 3 27B | 0.08 / 0.16 | $0.13 | $0.06 | DeepInfra |
| Gemma 3 12B | 0.05 / 0.15 | $0.09 | $0.04 | DeepInfra |
| Mistral Small 24B | 0.05 / 0.08 | $0.08 | $0.03 | DeepInfra |
| Llama 3.1 8B | 0.02 / 0.04 | $0.03 | $0.015 | DeepInfra |
| Mistral Nemo (12B) | 0.019 / 0.03 | $0.03 | $0.013 | DeepInfra |

Sources: [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing), [Google](https://ai.google.dev/gemini-api/docs/pricing), [Fireworks](https://docs.fireworks.ai/serverless/pricing), [Groq](https://console.groq.com/docs/models), [DeepInfra](https://deepinfra.com/pricing); all read 2026-10-02. The [OpenRouter model list](https://openrouter.ai/api/v1/models) (same day) shows similar or slightly higher lowest prices for the open models.

Notes. GPT-5 nano and GPT-OSS are reasoning models: hidden reasoning tokens are billed as output, so their real cost must be measured with reasoning set to its minimum. "GPT-6 luna" is on OpenAI's price list with no description. Gemini 2.5 Flash-Lite has no announced shutdown date, but Google's [deprecations page](https://ai.google.dev/gemini-api/docs/deprecations) recommends 3.5 Flash-Lite for new projects and already restricts other 2.5 models to past users; treat it as a model that may disappear. Groq lists Llama models under enterprise pricing.

Latency: well under the current 20-second timeout; Groq lists 560–1,000 tokens per second. Effort: about a day to add a second provider behind the existing `callTool` interface. The open question is quality (section 3.4).

### 3.4 Self-hosted small models

- **GPU rental** ([RunPod](https://www.runpod.io/pricing)): RTX A5000 $0.16 an hour (community cloud), RTX 3090 $0.22, RTX 4090 $0.34, L4 $0.44. Always on, that is $3.84–8.16 a day. Serverless 24 GB workers cost $0.69–1.10 an hour, billed per second, with cold starts. Hetzner's dedicated GPU servers (GEX45 with 24 GB, GEX131 with 96 GB) did not show prices on its page; secondary sources give about €184 a month for the older GEX44.
- **Throughput** (secondary benchmarks): about 1,490 tokens per second in total for Llama 3.1 8B on one RTX A6000 with 50 concurrent requests ([databasemart](https://www.databasemart.com/blog/vllm-gpu-benchmark-a6000)); about 2,800 on a 4090 at batch 32 (a source that could not be fetched). That is 8–15 full exchanges a second, so 45,000 exchanges need 50–95 minutes of GPU time a day.
- **Cost**: an always-on GPU alone takes most or all of the budget, while hosted 8B models cost $0.015–0.03 per 1,000. Self-hosting has no price advantage at this scale. Its value is serving custom weights and control. CPU inference (about 10–15 tokens per second for 2–3B models, secondary) is too slow, and the production box runs the simulation. An already-owned GPU machine would change this arithmetic; none was assessed.
- **Persona quality in 1–8B models**: published evidence is thin and addresses harder tasks. A 2025 paper fine-tunes DistilGPT-2, TinyLlama 1.1B and Mistral 7B to fixed personas with LoRA on about 150 synthetic pairs per character ([arXiv 2511.10277](https://arxiv.org/abs/2511.10277)). Persona-Pruner (ICML 2026, [arXiv 2606.14695](https://arxiv.org/abs/2606.14695)) reports that persona-guided pruning recovers most of the role-play score lost by naive pruning. Persona fidelity declines over 100-plus-turn dialogues ([arXiv 2512.12775](https://arxiv.org/abs/2512.12775)). Sim's task is easier: one short line whose content is fixed by the act.

### 3.5 Fine-tuning a small model

Every rendered exchange is already stored with its request, so the world produces a training set as a by-product.

- Training: Fireworks charges $0.50 per million training tokens for LoRA on models up to 16B and states that fine-tuned models are served "for the same price as base models" ([pricing](https://fireworks.ai/pricing)). Together charges $0.34 per million for models up to 9B with a $4 minimum per job; its pricing page does not mention serverless serving of fine-tunes ([pricing](https://www.together.ai/pricing)). OpenAI fine-tunes GPT-4.1 nano at $1.50 per million training tokens, with inference at $0.20 / $0.80, double the base model's $0.10 / $0.40.
- Five thousand exchanges are about 7.5 million training tokens: $2.55–3.75 on Together or Fireworks, $11 on OpenAI.
- A tuned model no longer needs the instruction block, so the request shrinks to the scene (about 300 in / 90 out): **$0.08** per 1,000 on Fireworks, $0.13 on tuned GPT-4.1 nano.
- Risks: the student copies one teacher's style, so voices converge; newly minted acts fall outside the training set; one more model to version and re-evaluate. Worth doing only after section 3.3 shows where stock small models fail.

### 3.6 Line banks and grammars

- **Line banks.** For each character, a larger model writes a few hundred lines keyed by act, manner and familiarity, with slots for listener, topic and place. Estimated one-off cost on Haiku 4.5 (1,500 in / 4,000 out): about $0.02 per character, half through the batch API; about $2 to refresh 200 characters by batch. Runtime cost and latency: zero.
- **Grammars** in the Tracery style expand a few fragments into many surface forms (8 openers × 8 bodies × 6 closers is 384 lines from 22 fragments). A small local model can choose among expansions under constrained decoding, so output stays inside the authored space while reacting to context ([Boris the Brave, 2025](https://www.boristhebrave.com/2025/03/08/tracery-ai), with a 0.5B model).
- **What makes it read as canned** is meeting the same line twice. Track lines seen per viewer and per pair, refresh banks weekly, and keep a model for `chat` and for topics a bank has no slot for. Topic strings need a fixed grammatical form for slots to read correctly; that is a rule for card authors and the compiler.

The existing plain-line fallback is already a one-entry bank. Effort: about a week.

### 3.7 Render on view

- Render at play time only when a client is watching that place or a participant's owner is online.
- Otherwise store the act and render on first read (one to two seconds, with the bank line shown meanwhile), or never.
- For an owner returning after hours, summarise unseen conversations in one call: about 60 input and 20 output tokens per summarised exchange, $0.16 per 1,000 on Haiku 4.5, $0.08 by batch.

Cost then scales with the fraction of exchanges ever seen, which is unknown and the most valuable number to measure. Quality risk: none for what is seen. Effort: days.

### 3.8 Several exchanges in one call

Render the exchanges in one place over a short window in one structured call, paying the instruction block once. With about 900 shared tokens, 300 per scene and 120 output tokens each, eight exchanges cost about $1.00 per 1,000 on Haiku 4.5: the same saving as trimming, overlapping with it. Research on batch prompting reports up to five times fewer tokens at comparable accuracy with up to six items per call ([Cheng et al., 2023](https://arxiv.org/abs/2301.08721)). Risks: voices bleeding between conversations, one failure losing several results, waiting for the window.

### 3.9 Generation in the viewer's browser

WebLLM on WebGPU runs 1–3B models (a 4-bit Llama 3.2 1B is a 695 MB download) at 20–90 tokens per second on recent laptops (secondary, [pinggy.io](https://pinggy.io/blog/run_llm_in_browser_webgpu/); [arXiv 2412.15803](https://arxiv.org/abs/2412.15803) reports up to 80% of native speed). Chrome's Prompt API runs Gemini Nano on desktop only, needing 22 GB free disk and more than 4 GB of video memory or 16 GB of RAM ([Chrome docs](https://developer.chrome.com/docs/ai/prompt-api)). Cost to Sim: zero. Limits: no phones, a large first download, the weakest models, and different viewers seeing different words for one act. An optional enhancement at most.

## 4. Ranked plan for 200 inhabitants on $1–5 a day

1. **Trim the request** (3.2). Hours of work; 2.2× on every call; no change of model.
2. **Render on view** (3.7). Live rendering only for exchanges a client is watching or that involve an online owner; bank or plain lines for the rest; digests for returning owners. Saves a factor equal to one over the fraction seen.
3. **Two model tiers** (3.3). Trimmed Haiku 4.5 for exchanges that matter (questions, agreements, refusals involving an owned Soul); a model at $0.013–0.10 per 1,000 trimmed for everything else, chosen by the experiment in section 5.
4. **Line banks** (3.6) for natives' formulaic acts (greetings, agreements, refusals), authored and refreshed through the batch API.
5. **Batch everything nobody waits for** (3.1): banks, digests, any back-fill of words.
6. **Later**: a small model fine-tuned on Sim's own transcripts and served at base price (3.5); scene calls for crowded places (3.8); in-browser rendering on capable desktops (3.9).

Not recommended now: an always-on GPU, CPU inference on the production box, prompt caching.

**Worked budget**, the hard case of 44,800 exchanges a day (20% of plays are speech), assuming 10% are rendered live:

| Item | Volume / day | Unit cost | $ / day |
|---|---|---|---|
| Owned-Soul exchanges that matter, trimmed Haiku | 1,000 | $1.00 / 1,000 | 1.00 |
| Other live exchanges, cheap model | 3,480 | $0.015–0.10 / 1,000 | 0.05–0.35 |
| Unseen exchanges, bank or plain line | 40,320 | 0 | 0 |
| Digests for returning owners, batch | about 5,000 summarised | $0.08 / 1,000 | 0.40 |
| Weekly line-bank refresh for 200 characters, batch | 1/7 | $2 | 0.30 |
| **Total** | | | **about 1.8–2.1** |

The same policy with every exchange rendered (owned-Soul ones on trimmed Haiku, the rest on a $0.015–0.10 model) costs about $1.6–5.4 a day, at or above the top of the budget. At 5% speech share everything scales down by four. The gap from today's $99 to about $2 is a factor of about 50, most of it from rendering on view and moving ambient talk to a cheaper model.

## 5. One cheap first experiment

**Aim:** choose the ambient model and measure the three unknowns that set the budget.

1. Take 200 stored speech requests from the `brain_calls` table, stratified across acts and across natives and owned Souls.
2. Re-render each with six arms: the current Haiku request; trimmed Haiku; Gemini 2.5 Flash-Lite (trimmed); GPT-5 nano or GPT-6 luna (trimmed, minimal reasoning); Llama 3.1 8B or Mistral Nemo on DeepInfra (trimmed); a per-character line bank.
3. Score each line automatically:
   - **cost**: real input, output and reasoning tokens per call, converted to dollars per 1,000;
   - **format**: share of responses `cleanLines` cannot parse;
   - **act fidelity**: a judge model asked whether the line adds a promise, plan or fact not in the act; report the violation rate;
   - **voice**: a judge shown the line and four character descriptions picks the speaker; report the hit rate;
   - **latency**: median and 95th percentile.
4. The owner ranks 40 randomly chosen sets blind, without model labels.
5. **Adopt a cheap model for ambient talk** if its format failures are at most 2%, its act violations at most 3% and no more than twice trimmed Haiku's, and its voice hit rate within 10 points of trimmed Haiku's.
6. In the same pass, query the database for: the share of plays that are speech acts; the share of stored `talks` rows ever fetched by a non-admin client (add a fetch counter if this is not recorded); and the real token counts of today's calls.

Cost: under $5 in model calls and about an afternoon. The result fixes the demand figure, the fraction seen and the per-exchange price in section 4.

## 6. Not verified

- The share of plays that are speech acts, the fraction of exchanges ever seen and the 10% live-render assumption; demand at 200 inhabitants depends on all three.
- The trimmed token counts (550 / 90) and the saving from dropping the tool.
- Any quality measurement of cheap models on this task; the cited papers address longer, harder role-play.
- Self-hosted throughput (secondary benchmarks) and Hetzner GPU prices.
- Gemini caching minimums for Flash-Lite models; reasoning-token overhead on GPT-5 nano and GPT-OSS; whether Fireworks serves LoRA fine-tunes of every 4–16B model serverlessly.
- Chrome Prompt API's stable version for web pages (sources say 138 or 148).

## Sources

- Anthropic: https://platform.claude.com/docs/en/about-claude/pricing ; https://platform.claude.com/docs/en/build-with-claude/prompt-caching ; https://platform.claude.com/docs/en/build-with-claude/batch-processing
- OpenAI: https://developers.openai.com/api/docs/pricing ; https://developers.openai.com/api/docs/guides/prompt-caching
- Google: https://ai.google.dev/gemini-api/docs/pricing ; https://ai.google.dev/gemini-api/docs/caching ; https://ai.google.dev/gemini-api/docs/deprecations
- Open models: https://openrouter.ai/api/v1/models ; https://deepinfra.com/pricing ; https://www.together.ai/pricing ; https://fireworks.ai/pricing ; https://docs.fireworks.ai/serverless/pricing ; https://console.groq.com/docs/models
- GPUs: https://www.runpod.io/pricing ; https://www.hetzner.com/dedicated-rootserver/matrix-gpu/ ; https://www.databasemart.com/blog/vllm-gpu-benchmark-a6000
- Persona and batching research: https://arxiv.org/abs/2511.10277 ; https://arxiv.org/abs/2606.14695 ; https://arxiv.org/abs/2512.12775 ; https://arxiv.org/abs/2301.08721
- Grammars: https://www.boristhebrave.com/2025/03/08/tracery-ai
- In-browser: https://arxiv.org/abs/2412.15803 ; https://pinggy.io/blog/run_llm_in_browser_webgpu/ ; https://developer.chrome.com/docs/ai/prompt-api
