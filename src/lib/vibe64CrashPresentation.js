import { crashMessage, crashTurnsText } from "@local/vibe64-core/shared/crashText";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value) => String(value).padStart(2, "0");

/**
 * A crash's time in the viewer's own zone, as HH:MM, with the day before it when that is not today
 * ("23 Nov 04:18"), and the year when that is not this year.
 * @param {string} iso
 * @param {Date} [now]
 */
function crashTimeText(iso, now = new Date()) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "an unknown time";
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (at.toDateString() === now.toDateString()) return time;
  const day = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return at.getFullYear() === now.getFullYear() ? `${day} ${time}` : `${day} ${at.getFullYear()} ${time}`;
}

/** When it crashed: a process that stopped without a trace was last heard from at its last heartbeat. */
function crashWhen(record, now) {
  if (record.kind === "stopped-without-trace" && record.lastHeartbeatAt) return `about ${crashTimeText(record.lastHeartbeatAt, now)}`;
  return crashTimeText(record.at, now);
}

const sentence = (text) => (/[.!?]$/u.test(text) ? text : `${text}.`);

/**
 * The banner's first sentence for those who can act on it: "Vibe64 crashed at 04:18: read ECONNRESET.", or with
 * several crashes not yet acknowledged, "Vibe64 crashed 3 times; the last at 04:18: read ECONNRESET."
 * @param {any} record the newest crash not yet acknowledged
 * @param {number} count how many are not acknowledged
 * @param {Date} [now]
 */
function crashBannerHeadline(record, count, now = new Date()) {
  const when = crashWhen(record, now);
  const lead = count > 1 ? `Vibe64 crashed ${count} times; the last at ${when}` : `Vibe64 crashed at ${when}`;
  return sentence(`${lead}: ${crashMessage(record)}`);
}

/**
 * The smaller line for those who cannot act on it, without the error itself.
 * @param {any} record
 * @param {number} count
 * @param {Date} [now]
 */
function crashMemberLine(record, count, now = new Date()) {
  const when = crashWhen(record, now);
  const lead = count > 1 ? `Vibe64 crashed ${count} times, the last at ${when}, and restarted.` : `Vibe64 crashed at ${when} and restarted.`;
  return [lead, crashTurnsText(record), "The workspace owner can see what happened."].filter(Boolean).join(" ");
}

export { crashBannerHeadline, crashMemberLine, crashTimeText };
