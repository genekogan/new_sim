# Personal reminders (additive eden-edge/1.1)

Authenticated POST/list/cancel are private to the current Soul and world. They
create advisory stream facts, never execute a body action, install a world rule,
change native history or add a planner/needs/night policy. Existing edge1 and
server-plan APIs remain. Reminder text is agent-origin data marked untrusted,
not a promoted human NOW instruction.

```
POST /v1/edge/reminders
{"clientRef":"library-review-1","text":"Review the library notes",
 "at":{"clock":"world","worldDayIndex":72,"time":"18:00"}}

{"clientRef":"real-review-1","text":"Review today's work",
 "at":{"clock":"real","time":"2026-10-10T18:00:00-04:00"}}

GET /v1/edge/reminders?state=active
GET /v1/edge/reminders?state=all&after=<returned nextCursor>
DELETE /v1/edge/reminders/<returned id>
```

Use explicit calendar worldDayIndex from fresh boot, not engineDayIndex/day,
a weekday, an inferred epoch or "tomorrow". World HH:MM has no implicit offset;
real timestamps require full ISO seconds and Z or an explicit numeric offset.
Invalid dates, local/relative time, past targets and recipient overrides refuse.
Real offsets normalize to the same UTC instant. Creation responses carry both
fresh clocks. Native tick seconds, calendar world-minutes and wall time remain
distinct: at72,000ticks/day, one calendar minute is50ticks =2.5native seconds.

A stable1..100-character clientRef replays its same normalized request/ID even
after delivery/cancellation or when its target has become past. Different content
with that ref conflicts. List is bounded100/page with explicit total/nextCursor
and ID order. Cancellation is idempotent; an already-delivered fact is reported
as alreadyDelivered and cannot be unsent. Limits are64 active reminders/Soul
and256/world. These are resource limits, not model or dollar budgets.

Private reminders and pending outbox rows are separate durable SQLite tables
outside the native event/fold union. Due marking retains the pending body and
both detection clocks atomically. Stream insertion, cursor marker and delivered
status share a nested savepoint. A crash before delivery retains the outbox; a
crash/fault before commit rolls back event/cursor/status together. Restart and
repeated polling cannot emit a second due fact. Existing stream retention/gap
semantics remain: listing a delivered reminder recovers its durable status and
cursor, without reemitting an event after pruning.

The scheduler owns an independent unref one-second timer and removes it on
close. Current clockRate/pause are sampled each poll. World targets defer while
paused and never infer passage of world time from wall time; real targets still
run. Both current delivery clocks and original detection clocks accompany the
private reminder.due event. Acceptance target is delivery within2 real seconds
through WS/wait while the server is running. Event-loop stalls or downtime may
produce an honestly late notification; an old deadline is not backdated into a
claim of timely execution. No guarantee of actor participation or completion is
made.

Five focused tests cover explicit dates/offsets, rate and pause changes,
ownership, idempotency/cancel, actual SQLite close/reopen, injected rollback after
stream insertion, no duplicate event, real HTTP WS/wait timing on both clocks,
and unchanged calendar starting durability. Existing event-stream suite also
passes. All fixtures are fake/no-model/no-public-data. Current-world client/routine
acceptance remains Root-owned.

The existing calendar path already wraps state advances and stream insertion in
savepoints; restart/repeat/failure rollback are verified and not repaired twice.
Its steward minutes remain native minutes (minutes*60*20ticks), not calendar
minutes; accepted startsAtTick/history is unchanged. Its default Comms sweep is
30 real seconds, an explicit due-latency limitation. Client world-routine timers
use fresh clocks or new personal reminders rather than relying on that old
cadence. A precise legacy-calendar timing change would be a separate prospective
review. No new timetable/routine object or native autonomy is introduced here.
