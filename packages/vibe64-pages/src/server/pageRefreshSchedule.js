// When a page refreshes: every N minutes or hours, never more often than every
// 15 minutes, or daily at a set time in a time zone. Only the next time is ever
// kept, so ticks missed while Vibe64 was stopped come back as one catch-up.
import { vibe64Error } from "@local/vibe64-core/server/core";

const MINUTE_MS = 60_000;
const MIN_MINUTES = 15;
const MAX_MINUTES = 24 * 60;
const EVERY = /^(\d{1,4})\s*(m|min|mins|minutes?|h|hours?)$/iu;
const DAILY = /^([01]?\d|2[0-3]):([0-5]\d)$/u;

function scheduleRefusal(message) {
  return vibe64Error(message, "vibe64_pages_refresh_schedule_invalid", { status: 400 });
}

/**
 * @param {string} timeZone
 * @returns {boolean}
 */
function knownTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The time zone Vibe64 itself runs in. */
function serverTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * A schedule from the command's words: `every` such as "30m" or "2h", or `daily` such as "07:30"
 * in `timeZone` (else Vibe64's own).
 * @param {{ every?: string, daily?: string, timeZone?: string }} input
 * @returns {{ every: { minutes: number } } | { daily: { time: string, timeZone: string } }}
 */
function checkedSchedule({ every = "", daily = "", timeZone = "" }) {
  if (Boolean(every) === Boolean(daily)) throw scheduleRefusal("Give a refresh either --every (such as 30m or 2h) or --daily (such as 07:30).");
  if (every) {
    const match = EVERY.exec(String(every).trim());
    if (!match) throw scheduleRefusal(`"${every}" is not a period such as 30m or 2h.`);
    const minutes = Number(match[1]) * (match[2].toLowerCase().startsWith("h") ? 60 : 1);
    if (minutes < MIN_MINUTES) throw scheduleRefusal("A page refreshes at most every 15 minutes.");
    if (minutes > MAX_MINUTES) throw scheduleRefusal("Refresh at least daily: use --daily for a set time, or a period up to 24h.");
    if (timeZone) throw scheduleRefusal("--time-zone goes with --daily.");
    return { every: { minutes } };
  }
  const match = DAILY.exec(String(daily).trim());
  if (!match) throw scheduleRefusal(`"${daily}" is not a time such as 07:30.`);
  const zone = String(timeZone || "").trim() || serverTimeZone();
  if (!knownTimeZone(zone)) throw scheduleRefusal(`"${zone}" is not a time zone such as Europe/Rome.`);
  return { daily: { time: `${match[1].padStart(2, "0")}:${match[2]}`, timeZone: zone } };
}

/**
 * The wall clock in a time zone at an instant.
 * @param {number} at
 * @param {string} timeZone
 */
function zonedClock(at, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(new Date(at)).map((part) => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

/**
 * The instant a wall clock time names in a time zone (the later one when a clock change repeats it).
 * @param {{ year: number, month: number, day: number }} date
 * @param {number} hour
 * @param {number} minute
 * @param {string} timeZone
 */
function zonedInstant({ year, month, day }, hour, minute, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (at) => {
    const clock = zonedClock(at, timeZone);
    return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second) - Math.floor(at / 1000) * 1000;
  };
  const first = wall - offset(wall);
  return wall - offset(first);
}

/**
 * The first refresh strictly after `after`. A period counts from when it was set.
 * @param {ReturnType<typeof checkedSchedule>} schedule
 * @param {{ after: number, anchor: number }} times in milliseconds
 */
function nextRefreshAt(schedule, { after, anchor }) {
  if ("every" in schedule) {
    const period = schedule.every.minutes * MINUTE_MS;
    if (after < anchor) return anchor + period;
    return anchor + (Math.floor((after - anchor) / period) + 1) * period;
  }
  const { time, timeZone } = schedule.daily;
  const [hour, minute] = time.split(":").map(Number);
  const today = zonedClock(after, timeZone);
  for (let days = 0; days < 3; days += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + days));
    const at = zonedInstant({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }, hour, minute, timeZone);
    if (at > after) return at;
  }
  return after + MAX_MINUTES * MINUTE_MS;
}

/**
 * How the Pages list and the agent command say a schedule.
 * @param {ReturnType<typeof checkedSchedule>} schedule
 */
function scheduleText(schedule) {
  if ("daily" in schedule) return `Daily at ${schedule.daily.time} (${schedule.daily.timeZone})`;
  const { minutes } = schedule.every;
  if (minutes % 60) return `Every ${minutes} minutes`;
  return minutes === 60 ? "Every hour" : `Every ${minutes / 60} hours`;
}

export { checkedSchedule, nextRefreshAt, scheduleText, serverTimeZone };
