/**
 * LeadPulse — Calendar days in the workspace timezone.
 */

'use strict';

const DAY_MS = 86_400_000;

/** YYYY-MM-DD in the given IANA timezone. */
const localDate = (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);

/** How far `timeZone` is ahead of UTC at instant `t` (ms). */
function offsetAt(t, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - (t - (t % 1000));
}

/** The instant a YYYY-MM-DD day begins in `timeZone`. */
function dayStart(day, timeZone) {
  const midnightUtc = Date.parse(`${day}T00:00:00Z`);
  const guess = midnightUtc - offsetAt(midnightUtc, timeZone);
  return new Date(midnightUtc - offsetAt(guess, timeZone)); // the offset at the real midnight (differs across a DST change)
}

/** The instant the calendar day containing `date` begins in `timeZone`. */
const startOfDay = (date, timeZone) => dayStart(localDate(date, timeZone), timeZone);

/** Where a YYYY-MM-DD day begins (or, with `end`, where the next day begins) in `timeZone`. */
function dayBoundary(day, timeZone, { end = false } = {}) {
  if (!end) return dayStart(day, timeZone);
  return dayStart(new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10), timeZone);
}

module.exports = { DAY_MS, localDate, startOfDay, dayBoundary };
