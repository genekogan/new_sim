// Client-owned clocks and routine occurrence keys. No world timetable/planner.
// World minutes are absolute (day * 1440 + minute); the server supplies anchors.
export function clockAt(anchor, realMs) {
  if (!Number.isFinite(anchor.worldMinutes) || !Number.isFinite(anchor.realMs) || !Number.isFinite(realMs) || (!anchor.paused && (!(anchor.realMsPerWorldMinute > 0) || !Number.isFinite(anchor.realMsPerWorldMinute)))) throw new Error('Invalid authoritative clock anchor');
  return {
    realMs,
    worldMinutes: anchor.worldMinutes + (anchor.paused ? 0 : (realMs - anchor.realMs) / anchor.realMsPerWorldMinute),
    realMsPerWorldMinute: anchor.paused ? null : anchor.realMsPerWorldMinute,
    paused: !!anchor.paused,
  };
}

export function timePair(anchor, targetWorldMinutes) {
  if (!Number.isFinite(targetWorldMinutes)) throw new Error('Invalid world target');
  clockAt(anchor, anchor.realMs);
  return { worldMinutes: targetWorldMinutes, realMs: anchor.paused ? null : anchor.realMs + (targetWorldMinutes - anchor.worldMinutes) * anchor.realMsPerWorldMinute, paused: !!anchor.paused };
}

export function parseWorldRoutine(line, id) {
  const match = /^\s*-\s*(\d{2}):(\d{2})\s+(daily|(?:mon|tue|wed|thu|fri|sat|sun)(?:,(?:mon|tue|wed|thu|fri|sat|sun))*)\s*·\s*(.+?)\s*·\s*(\d+(?:\.\d+)?m|until \d{2}:\d{2})\s*$/.exec(line);
  if (!match) throw new Error('Expected HH:MM daily|weekdays · instruction · duration or until HH:MM');
  const minute = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[1]) > 23 || Number(match[2]) > 59 || !id) throw new Error('Invalid routine time/id');
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const weekdays = match[3] === 'daily' ? null : [...new Set(match[3].split(',').map(x => days.indexOf(x)))];
  let durationWorldMinutes;
  if (match[5].startsWith('until ')) {
    const [hour, min] = match[5].slice(6).split(':').map(Number);
    if (hour > 23 || min > 59) throw new Error('Invalid until time');
    durationWorldMinutes = (hour * 60 + min - minute + 1440) % 1440;
  } else durationWorldMinutes = Number(match[5].slice(0, -1));
  if (!(durationWorldMinutes > 0) || durationWorldMinutes > 1440) throw new Error('Invalid routine duration');
  return { id, minute, weekdays, instruction: match[4], durationWorldMinutes,...(match[5].startsWith('until ')?{untilWorldTime:match[5].slice(6)}:{}) };
}

// Caller persists occurrence keys before scheduling its already compiled steps.
// No skipped occurrence is silently replayed as an immediate body action.
export function routineOccurrences({ routines, fromWorldMinutes, toWorldMinutes, epochWeekday, completedKeys = [], maxDays = 2 }) {
  if (!Number.isFinite(fromWorldMinutes) || !Number.isFinite(toWorldMinutes) || toWorldMinutes < fromWorldMinutes || !Number.isInteger(epochWeekday) || epochWeekday < 0 || epochWeekday > 6 || !Number.isInteger(maxDays) || maxDays < 1 || maxDays > 31) throw new Error('Invalid routine clock window');
  const firstDay = Math.floor(fromWorldMinutes / 1440);
  const lastDay = Math.floor(toWorldMinutes / 1440);
  const truncated = lastDay - firstDay + 1 > maxDays;
  const startDay = Math.max(firstDay, lastDay - maxDays + 1);
  const seen = new Set(completedKeys);
  const occurrences = [];
  if (new Set(routines.map(r => r.id)).size !== routines.length) throw new Error('Duplicate routine ids');
  for (let day = startDay; day <= lastDay; day++) {
    const weekday = ((epochWeekday + day) % 7 + 7) % 7;
    for (const routine of routines) {
      if (!routine.id || !Number.isInteger(routine.minute) || routine.minute < 0 || routine.minute >= 1440 || !Number.isFinite(routine.durationWorldMinutes) || routine.durationWorldMinutes <= 0) throw new Error('Invalid routine');
      if (routine.weekdays && !routine.weekdays.includes(weekday)) continue;
      const atWorldMinutes = day * 1440 + routine.minute;
      const key = `${routine.id}@${day}`;
      if (atWorldMinutes > fromWorldMinutes && atWorldMinutes <= toWorldMinutes && !seen.has(key)) occurrences.push({ key, routineId: routine.id, atWorldMinutes, instruction: routine.instruction, durationWorldMinutes: routine.durationWorldMinutes });
    }
  }
  occurrences.sort((a, b) => a.atWorldMinutes - b.atWorldMinutes || a.key.localeCompare(b.key));
  return { occurrences, truncated, discardedBeforeWorldMinutes: truncated ? startDay * 1440 : null };
}
