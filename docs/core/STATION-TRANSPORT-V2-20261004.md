# Isolated negotiated station transport

This extends the e113 atomic physical/era producer. Production bootstrap and
App audio/World rendering defaults stay uninstalled. The optional seventh Hub
adapter and optional `buildApp.stationV2` dependency must belong to the selected
host. Existing calls remain compatible; no model or control endpoint is added.

Hello may offer a strict unique array `stationContracts` of one or two exact
values, `station-live/1` and `station-live/2`. Absence means V1. Hub selects V2
then V1 only among actually injected adapters. Welcome advertises the selected
contract or null; no overlap produces no station message. Invalid capabilities
are dropped under the existing inbound validation policy. The default client
hello omits the new field. Connection's optional seventh constructor argument
offers versions; new `onStationV2(view, receipt)` receives detached public data.

## Checkpoint and reader binding

The first V2 view binds its exact current physical head to the selected world's
actual welcome rules/dt. That is an authoritative late-reader boundary, not
independent proof of unseen history. Within that same session, subsequent heads
advance only by an exact adjacent era/source fold from the previously accepted
head. A skipped era, reset, changed epoch/dt or missing source closes the socket
for a fresh welcome. This refines G006 revision 2's welcome binding: welcome is
the starting physical binding; the validated head becomes the current binding.
Refreshing welcome on every V2 checkpoint would discard correlated clock probes
and force the App graph to restart despite an unchanged cue.

After the canonical pair has fully folded, Hub sends the physical snapshot and
explicit station view. A V2 listener retains the connection/session; its current
anchor is null until an actual current-era anchor is recorded. That receipt
starts nothing. Connection retains the last accepted anchor revision across a
pending view, rejects regression, and permits an identical anchor republished by
a later cue/source notification. The original cue, seed, observation and origin
head cannot change under the same cue ID. Later cues require the exact next
sequence/predecessor/end, a new seed and the current physical origin. No inferred
phase, fallback cue or missing predecessor is synthesized.

A V1 listener receives an updated actual-rules welcome before the physical
snapshot and retained V1 view with `fresh:false`. Its clock generation/probes
clear as before; comparing welcome rules with the original epoch rules names the
version mismatch. The V1 codec/phase helper stays strict and returns null. This
qualifies transport-level silence, not the App's graph disposal or UI notice.

## Public reads

All candidate routes send `Cache-Control: no-store` and remain 404 without the
explicit adapter. They add no account, invitation, pairing, spend or permission
policy. Wrong world/epoch/bounds/frontier or unknown query fields return a generic
404 without raw errors or private values.

- `GET /v1/station-v2`: explicit strict live view.
- `GET /v1/station-v2/history?worldId=…&epoch=…&rulesVersion=…&tick=…`:
  authoritative selected native era, exclusive upper boundary, nullable cue/
  phase/anchor; optional `sourceCutoffSeq` requires that exact recorded row.
- `GET /v1/station-v2/eras?worldId=…&epoch=…`: at most 64 strict public era/source
  pairs in `station-era-page/1`; optional `afterSeq` is an actual selected-world
  era row, `limit` is 1–64, and `sourceCutoffSeq` fixes the exact frontier.
  `nextAfterSeq` is the last included era when another exists, otherwise null.
  The epoch must itself exist at that frontier. Cursor pages are immutable
  projections; no station/clock state changes. Page framing is bounded, but
  current full history scans/state arrays are not lifetime-performance qualified.

## Evidence and limits

The new Node tests run the actual native engine, SQLite, Hono TCP routes, Hub WS
and shared Connection on port4959 with fake minds and paid spend $0. One V1 and
two staggered V2 listeners cross both tick37 inside a cue and tick2563 in silence;
a third joins after, and one reconnects. Exact era-row history keeps silence and
does not borrow a later same-tick cue/anchor. Completed native take chunks start
at the same physical boundary with the new captured scene hash. Tests assert
unchanged V2 sessions, changed V1 generation/stale phase, exact cue/seed, next
cue/current rules, detached payloads, anonymous privacy and measured monotonic
probe receipts. Phase equality uses a common server timestamp; it does not
establish acoustic synchronization, device tolerance, long drift or browser audio.

Initial transport run8/11 failed three test setups: requesting a take before its
first completed chunk, renewing a cue before a silence test, and expecting error
replies to dropped invalid hellos. Corrected3/4 then exposed a welcome/station
arrival wait race; waiting for both actual packets closed it. Type errors were
test declarations (unknown engine take, assertion narrowing and query unions).
Failures and actual executions remain in the team review receipt. The immutable
e113 fixture/source pins are now verified against that exact Git commit; this
current transport execution is separate evidence, never relabeled e113 proof.

G006 final App/World/PM agreement, installed audio/depiction, current production,
general idle-tail repair, persistent shore/boats and full W/G remain open. Exact
source adoption and consumer checks are the next handoff, not default activation.
