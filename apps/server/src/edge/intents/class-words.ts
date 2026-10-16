// W8: ordinary resident words for attending a class ("attend the lecture", "go to class", "sit in on the lesson",
// "take a seat in the classroom") become the existing seat-in-room intent, which picks a free audience seat facing the
// room's lectern/screen. Words that name no class, or a world without a classroom, resolve as before.
import type {IntentInput} from './intents.ts';
type Place = {id: string; name: string};
const CLASS = /\b(?:class(?:room)?|lecture(?:\s+(?:hall|room|theatre|theater))?|lesson|seminar|presentation|talk)\b/i;
const ATTEND = /^\s*(?:(?:let'?s|i\s+want\s+to|i'?d\s+like\s+to|please)\s+)?(?:attend|join|go\s+to|go\s+into|head\s+to|walk\s+to|sit\s+in(?:\s+on)?|listen\s+to|watch|catch|take\s+a\s+seat\s+(?:in|at|for)|sit\s+(?:down\s+)?(?:in|at|for)|be\s+at|be\s+in)\s+(?:the\s+|a\s+|an\s+|this\s+|today'?s\s+)?(.+?)\s*[.!]?\s*$/i;
const NOT = /\b(?:not|never|don'?t|dont|stop|leave|skip)\b/i;
/** Classroom places of this world, the one whose id/name reads most like a classroom first. */
export function classroomPlaces(places: Iterable<Place>): Place[] {
  return [...places].filter(p => /classroom|lecture|lesson/i.test(`${p.id} ${p.name}`)).sort((a, b) => Number(/seat/i.test(a.id)) - Number(/seat/i.test(b.id)) || a.id.localeCompare(b.id)).filter(p => !/seat/i.test(p.id));
}
/** "attend the lecture" → {verb:'sit', target:{in:<classroom>, row:'any'}}; null when the words are not about a class. */
export function classWords(text: string, places: Iterable<Place>): IntentInput | null {
  if (!text || text.includes(':') || NOT.test(text)) return null;
  const m = ATTEND.exec(text); if (!m || !CLASS.test(m[1])) return null;
  const rooms = classroomPlaces(places); if (!rooms.length) return null;
  const named = rooms.find(p => m[1].toLowerCase().includes(p.name.toLowerCase())) ?? rooms[0];
  const row = /\bfront\b/i.test(m[1]) ? 'front' : /\bback\b/i.test(m[1]) ? 'back' : 'any';
  return {verb: "sit", target: {in: named.id, row}};
}
