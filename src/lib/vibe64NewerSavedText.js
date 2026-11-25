import { newerSavedFacts, newerSavedMessage, newerSavedSource } from "@local/vibe64-core/shared";

// The one message for a session whose main has newer saved versions, as the page says it: the time in the person's
// own clock (the server says how long ago, since it does not know that clock).

const SAVED_TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const SAVED_DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
});

/**
 * A saved version's time in the person's own clock: the time alone today, with the date otherwise; "" for a time
 * that cannot be read.
 * @param {string} at ISO time
 * @param {Date} [now]
 */
function savedClockText(at = "", now = new Date()) {
  const date = new Date(String(at || ""));
  if (!at || Number.isNaN(date.getTime())) return "";
  return (date.toDateString() === now.toDateString() ? SAVED_TIME_FORMAT : SAVED_DATE_TIME_FORMAT).format(date);
}

/**
 * The message, or "" when nothing newer is known.
 * @param {object | null} source the session's update check, its work answer's `newerSaved`, or Save's refusal's
 * @param {object} [options]
 * @param {string} [options.branch] the branch Save goes to, when `source` does not say
 * @param {boolean} [options.fallback] say "newer saved work" when `source` gives nothing newer, for a session Vibe64
 *   knows needs Update before it has read what is newer
 * @param {string} [options.selfSessionId] the session reading it
 * @param {boolean | null} [options.unsaved] whether the session has unsaved work
 */
function newerSavedText(source, { branch = "", fallback = false, selfSessionId = "", unsaved = null } = {}) {
  const found = newerSavedSource(source) || (fallback ? {} : null);
  if (!found) return "";
  const facts = newerSavedFacts(branch && !found.branch ? { ...found, branch } : found);
  return newerSavedMessage(facts, { savedAtText: (at) => savedClockText(at), selfSessionId, unsaved });
}

/**
 * Save's answer while main has newer saved versions, with its message said in the person's own clock. The server
 * says how long ago, and may say more around it, such as the connected copies a Save pushed before it stopped; an
 * answer whose message it cannot find again is shown as the server said it.
 * @param {string} text Save's answer
 * @param {object | null} newerSaved the answer's `details.newerSaved`
 * @param {{ selfSessionId?: string }} [options]
 */
function newerSavedAnswer(text, newerSaved, { selfSessionId = "" } = {}) {
  const source = newerSavedSource(newerSaved);
  const said = source ? newerSavedMessage(newerSavedFacts(source)) : "";
  if (!said || !text.includes(said)) return text || newerSavedText(source, { selfSessionId, unsaved: true });
  return text.replace(said, () => newerSavedText(source, { selfSessionId, unsaved: true }));
}

export { newerSavedAnswer, newerSavedText, savedClockText };
