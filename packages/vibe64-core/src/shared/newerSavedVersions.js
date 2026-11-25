// The one message for a session whose main has newer saved versions than the session holds: how many, when the
// latest was saved, which session saved them when Vibe64 knows it (Save's own record of the versions it saved, never
// a guess from the commits), how many files they change, and the one fix: Update this session, which keeps its
// unsaved work, then Save. Save's refusal, the header's Save, the Changes page, the session's tab, session status and
// the AI's tools all say it from here; each passes the clock its reader reads.

import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * Who saved a version, as Save recorded it.
 * @typedef {{ savedAt: string, sessionId: string, sessionName: string }} SavedBy
 */

/**
 * What the message says.
 * @typedef {object} NewerSavedFacts
 * @property {number} behind how many newer saved versions; 0 when only "newer saved work" is known
 * @property {string} branch the branch Save goes to ("main" when unknown)
 * @property {string} latestAt when the latest of them was saved (ISO), or ""
 * @property {number | null} fileCount how many files they change together, or null when unknown
 * @property {SavedBy[]} savedBy the sessions that saved them, newest first; empty unless every one is known
 * @property {string} repository the connected repository they are in, or "" for the session's own
 */

function nonnegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

/**
 * A version's recorded saver, or null when Save recorded none.
 * @param {unknown} value
 * @returns {SavedBy | null}
 */
function normalizeSavedBy(value) {
  const sessionId = normalizeText(value?.sessionId);
  if (!sessionId) return null;
  return {
    savedAt: normalizeText(value.savedAt).slice(0, 100),
    sessionId: sessionId.slice(0, 200),
    sessionName: normalizeText(value.sessionName).slice(0, 200)
  };
}

/**
 * The repository a session's newer saved work is in: its own when its main moved on, else the first connected copy
 * behind its main. Null when neither is behind.
 * @param {{ behind?: number, connected?: Array<{ behind?: number, name?: string }> } | null} check an update check or
 *   the session's work as Save reads it
 */
function newerSavedSource(check) {
  if (!check || typeof check !== "object") return null;
  if (nonnegativeInteger(check.behind) > 0) return check;
  const copy = Array.isArray(check.connected)
    ? check.connected.find(entry => nonnegativeInteger(entry?.behind) > 0 && normalizeText(entry?.name))
    : null;
  return copy ? { ...copy, repository: normalizeText(copy.name) } : null;
}

/**
 * The message's facts from an update check, Save's refusal or the session's work: `behind`, `incomingVersions`
 * (newest first, each with `committedAt` and, when Save recorded it, `savedBy`), `incomingFileCount`, `branch`, and
 * `repository` for a connected copy. Sessions are named only when every newer version is listed and each has Save's
 * record; otherwise none is.
 * @param {object | null} source
 * @returns {NewerSavedFacts | null}
 */
function newerSavedFacts(source) {
  if (!source || typeof source !== "object") return null;
  const behind = nonnegativeInteger(source.behind);
  const versions = Array.isArray(source.incomingVersions) ? source.incomingVersions : [];
  const savers = versions.map(version => normalizeSavedBy(version?.savedBy));
  const complete = behind > 0 && versions.length === behind && savers.every(Boolean);
  const savedBy = [];
  if (complete) {
    for (const saver of savers) {
      if (!savedBy.some(entry => entry.sessionId === saver.sessionId)) savedBy.push(saver);
    }
  }
  const fileCount = Number(source.incomingFileCount);
  return {
    behind,
    branch: normalizeText(source.branch) || "main",
    latestAt: behind > 0 ? normalizeText(savers[0]?.savedAt || versions[0]?.committedAt) : "",
    fileCount: Number.isSafeInteger(fileCount) && fileCount >= 0 ? fileCount : null,
    savedBy,
    repository: normalizeText(source.repository)
  };
}

/**
 * How long ago a version was saved, for a reader whose clock Vibe64 does not know (the AI, Save's stored answer).
 * @param {string} at ISO time
 * @param {number} [now]
 */
function savedAgoText(at, now = Date.now()) {
  const time = Date.parse(normalizeText(at));
  if (!Number.isFinite(time)) return "";
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

const listed = names => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * "the Passes session", "the Passes and Inbox sessions", "this session" for the reader's own, "session 1125-0802…"
 * for one without a name.
 * @param {SavedBy[]} savedBy
 * @param {string} selfSessionId
 */
function sessionsText(savedBy, selfSessionId) {
  const named = savedBy.every(saver => saver.sessionName && saver.sessionId !== selfSessionId);
  if (named && savedBy.length > 1) return `the ${listed(savedBy.map(saver => saver.sessionName))} sessions`;
  return listed(savedBy.map(saver => saver.sessionId === selfSessionId ? "this session"
    : saver.sessionName ? `the ${saver.sessionName} session` : `session ${saver.sessionId.replace(/^\d{4}-/u, "")}`));
}

/**
 * The message: "Main has 1 newer saved version (8:11 AM, from the Passes session, 2 files). Update this session to
 * take it in (your unsaved work stays), then Save." Update is the one fix it names; it never says merge.
 * @param {NewerSavedFacts | null} facts
 * @param {object} [options]
 * @param {(at: string) => string} [options.savedAtText] the time as its reader reads it; how long ago by default
 * @param {string} [options.selfSessionId] the reading session, named "this session"
 * @param {boolean | null} [options.unsaved] whether the session has unsaved work; null when not known
 */
function newerSavedMessage(facts, { savedAtText = savedAgoText, selfSessionId = "", unsaved = true } = {}) {
  if (!facts) return "";
  const one = facts.behind === 1;
  const when = facts.latestAt ? savedAtText(facts.latestAt) : "";
  const details = [
    when ? (one ? when : `latest ${when}`) : "",
    facts.savedBy.length ? `from ${sessionsText(facts.savedBy, normalizeText(selfSessionId))}` : "",
    facts.fileCount ? `${facts.fileCount} ${facts.fileCount === 1 ? "file" : "files"}` : ""
  ].filter(Boolean);
  const branch = facts.branch === "main" ? "main" : `branch ${facts.branch}`;
  const subject = facts.repository
    ? `In connected repository ${facts.repository}, ${branch}`
    : `${branch[0].toUpperCase()}${branch.slice(1)}`;
  const newer = facts.behind ? `${facts.behind} newer saved ${one ? "version" : "versions"}` : "newer saved work";
  const them = facts.behind > 1 ? "them" : "it";
  const fix = unsaved === false ? `Update this session to take ${them} in.`
    : unsaved === true ? `Update this session to take ${them} in (your unsaved work stays), then Save.`
      : `Update this session to take ${them} in (any unsaved work stays) before saving.`;
  return `${subject} has ${newer}${details.length ? ` (${details.join(", ")})` : ""}. ${fix}`;
}

export {
  newerSavedFacts,
  newerSavedMessage,
  newerSavedSource,
  normalizeSavedBy,
  savedAgoText
};
