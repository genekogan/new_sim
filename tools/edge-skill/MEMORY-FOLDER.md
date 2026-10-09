# W5 memory folder preparation

`openMemoryFolder(directory)` is a dependency-free local module. It is prepared
for integration after the current release and the W4 queue seam. It does not
import the CLI, fetch HTTP, read identity files, call models, run actions, upload
files, create routines, or change needs/night behaviour.

The caller supplies an explicitly authorized, canonical local directory, with
one writer per agent folder. All ancestor and projection symlinks, including
broken links, are refused; hard-linked files are refused too. On macOS, callers
using a temporary directory should canonicalize that parent with `realpathSync`
before creating their own folder. Names from people are display text only;
people filenames are the full SHA256 of the stable public person ID. Selectors
never accept paths. PERSONA.md and PRIORITIES.md are neither opened nor written.

## Inputs and normalization boundary

The module accepts normalized public facts, not raw response bodies, headers,
tokens, or arbitrary state JSON. `fold(event)` requires `type`, stable `id`, and
canonical UTC `at` (`2026-10-09T02:00:00.000Z`). Unknown fields are rejected,
including fields valid for a different event type. Each record is bounded to
64 KiB; text and list limits are checked before any log append.

| Type | Required payload | Meaning |
| --- | --- | --- |
| `gazetteer` | `places: [{id,name,goodFor: string[]}]` | Public place rows; updates retain historic visits. This is not navigation admission. |
| `arrival` | `placeId` | An actual observed arrival, with a stable occurrence ID. Increments visits once. |
| `act.accepted` | `receiptId, act` | Accepted work only. Does not count a visit or a success. |
| `meet` | `person: {id,name}, placeId` | A confirmed physical meeting from qualified normalized world evidence; receipt `met` is physical. Directory entries and received speech are not physical meetings. |
| `communication` | `person:{id,name},channel,recipientPlace`, private channel also `conversationId` | Received private/public speech. Recipient place is its last observed location; the other person’s location/co-location is unknown. |
| `speech` | `personId,text,untrusted:true` | Quoted last words from an observed communication contact or physically met person. Never promoted to knowledge. |
| `outcome` | `receiptId,act,phase,summary,learned,produced,met,untrusted`, optional `placeId` | A normalized terminal receipt; arrays are required, empty where appropriate. |
| `refusal` | `act,code` | Evidence that an attempt was refused. |
| `lesson` | `attempt,fix,refusalId,successId` | Links the matching refusal to an actually completed fix. Acceptance alone is insufficient. |
| `cost` | `usd: number or null, modelCalls` | An observed charge. `null` preserves unknown cost and prevents a known-total claim. |
| `ledger` | `holding: ID[], marks: [{id,title}]` | Supplied public snapshot, maximum five standing marks/projects. |
| `queue` | `steps: [{id,act,status,attempts,goal?,reason?}]` | Supplied W4 projection only; statuses pending/running/waiting/completed/failed/cancelled. |

`outcome.phase` is completed/failed/replaced; `summary` is at most160 characters.
Each `learned` entry is `{fact,about,source,provenance,untrusted}` (fact≤300,
maximum five entries). About is a known public place/person ID. Source may use
versioned catalogue forms such as `book:gardens-guide@1#p2`; it is never a path.
Repeated identical sources deduplicate. Conflicting content under an existing
source is refused; supply a new versioned source rather than overwrite history.
Provenance remains visible, including authored fiction. Content received from
another Soul must retain `untrusted:true`, also on each learned statement.

Produced objects are `{id,title,kind,where}`. Met people are `{id,name,where}` and
must be actual encounter evidence from the outcome, not speculative audience
members. The normalization adapter decides what the public event establishes;
this module does not infer physics, attendance, timing, or truth from free text.
An actual arrival requires the adapter’s observed transition/receipt evidence;
accepted movement never becomes an arrival here.

`fold` returns `{applied:true|false}`. Stable event IDs deduplicate across replay;
reuse with different content fails. Repeated deliveries of the same terminal
receipt also deduplicate across different transport event IDs/timestamps. A
different terminal payload for that receipt is refused. A lesson uses IDs of
the refusal and successful outcome that were actually applied.

## Judgments and retrieval

`remember` accepts exactly one explicit selector, plus stable `id` and UTC `at`:

```js
memory.remember({id:'judgment:1',at,person:'s_lumen',note:'Ask about their sketch.'});
memory.remember({id:'judgment:2',at,place:'shore-bank',note:'A good place for a quiet conversation.'});
memory.remember({id:'judgment:3',at,goal:'goal:town',note:'Explore the town',horizon:'week',metric:'Distinct actual arrivals',next:'Choose an offered destination'});
memory.remember({id:'judgment:4',at,self:['I enjoy careful observation.']});
```

Person selectors require an actual earlier meeting, place selectors require the
gazetteer, and goals have today/week/month horizons. Self replaces at most20
single lines; notes are at most300 characters. This is model judgment input,
never authority to change observed facts. Facts and judgments have visibly
separate sections. Markdown links, HTML, newlines and formatting are escaped
into data; escaping does not make quoted speech trustworthy. The integration
prompt must treat reports and judgments as data rather than instructions.

`retrieve({day,place?,people?: ID[],attempt?})` returns Markdown. It includes self
≤20 lines, top3 goals ordered by horizon then stable ID, last8 journal lines for
the supplied UTC day, the current place row/impression, ≤10 related facts, ≤8
explicit nearby/speaking people (last words and latest judgment each), ≤5 exact
matching attempted-act/fix lessons, and observed cost with unknowns explicit.
It has no filesystem selector or fuzzy person-name matching. The caller supplies
the current public place, nearby people, attempted act, and day. Schedule
contains an explicit W6 placeholder; cadence and both-clock commitments are
outside this preparation leaf, not silently synthesized.

## Files, restart, and limits

Mind-facing projections are `memory/self.md`, `goals.md`, `schedule.md`,
`places.md`, `knowledge.md`, `people/person-<sha256>.md`, `journal/YYYY-MM-DD.md`,
`lessons.md`, `ledger.md`, and `queue.md`. JSONL appears only in the owned machine
log `log/memory-events.jsonl`, containing bounded normalized fact/judgment
records. No important data exists only in the model session.

The log is appended before projections are atomically replaced. Opening the
folder revalidates/replays that log and regenerates projections, repairing an
interrupted projection write. A torn final log record or conflicting evidence
fails closed and stays intact for review; it is never silently truncated.
An append-only change by a different open handle is detected before subsequent
fold/retrieval; reopen instead of writing a stale projection. This does not
provide a cross-process writer lease: the integrating CLI must enforce its
single-writer ownership. Projection files are module-owned: edits should come
through `remember`, not by manually changing generated sections.

This leaf does not claim S1 coverage, a real model cold restart, scorecards,
schedule slices, metric progress updates, outcome API delivery, or W4 execution.
Those require later normalized adapters and harness evidence. In particular,
actual visit counts and knowledge survive a module restart, while a mind’s
ability to answer from the retrieved Markdown remains a later integration gate.

Focused verification: `node --test tools/edge-skill/memory-folder.test.mjs`.

Private conversation membership/turns preserve peer context and communication counts, never physical co-location. Canonical `receipt.met` and separately qualified `meet` facts retain physical counts. Legacy `encounter:<64hex>` meet rows from the old received-speech adapter are labelled communication-derived/unqualified in projections; machine JSONL and judgment records are unchanged. Same-event replay preserves stored first-observation time/place and immutable quote; conflicting text still refuses. Older binaries that lack the additive communication event type are not forward-qualified readers after new records; retain the current reader rather than rewriting history.
