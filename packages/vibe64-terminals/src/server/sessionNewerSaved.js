// A session whose main has newer saved versions than it holds: those versions as the session's Git reads them (the
// five newest), how many files they change together and the branch they are on, which the update check reports and
// Save's refusal carries as `details.newerSaved`, with the one message they make
// (`newerSavedMessage` in @local/vibe64-core/shared): how many, when, how many files, then Update and Save.

import { newerSavedFacts, newerSavedMessage } from "@local/vibe64-core/shared";
import { GIT_HISTORY_RECORD_FORMAT, parseGitHistoryRecords } from "./gitRecords.js";
import { countCommitsBetween, git, saveError } from "./sessionWorkGit.js";

const INCOMING_VERSION_LIMIT = 5;
const SAVE_UPDATE_REQUIRED = "vibe64_session_save_update_required";

async function incomingVersionsBetween(runCommand, context, fromCommit, toCommit, options = {}) {
  const result = await git(runCommand, context, [
    "log",
    "--topo-order",
    `--max-count=${INCOMING_VERSION_LIMIT + 1}`,
    "-z",
    `--format=${GIT_HISTORY_RECORD_FORMAT}`,
    `${fromCommit}..${toCommit}`
  ], options);
  const records = parseGitHistoryRecords(String(result.stdout || result.output || ""));
  return {
    incomingVersions: records.slice(0, INCOMING_VERSION_LIMIT),
    incomingVersionsTruncated: records.length > INCOMING_VERSION_LIMIT
  };
}

/**
 * How many files the newer saved versions change, from where the session and main parted to main.
 * @returns {Promise<number>}
 */
async function incomingFileCount(runCommand, context, sessionHead, canonicalCommit, options = {}) {
  const result = await git(runCommand, context, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    `${sessionHead}...${canonicalCommit}`
  ], options);
  return String(result.stdout || result.output || "").split("\0").filter(Boolean).length;
}

/**
 * The newer saved versions between the session's head and its main, for a session whose history still descends
 * from main's (`git log` and the file count read from where they parted).
 * @returns {Promise<{ behind: number, branch: string, incomingFileCount: number, incomingVersions: object[],
 *   incomingVersionsTruncated: boolean }>}
 */
async function readNewerSaved(runCommand, context, sessionHead, canonicalCommit, options = {}) {
  const [behind, incoming, fileCount] = await Promise.all([
    countCommitsBetween(runCommand, context, sessionHead, canonicalCommit, options),
    incomingVersionsBetween(runCommand, context, sessionHead, canonicalCommit, options),
    incomingFileCount(runCommand, context, sessionHead, canonicalCommit, options)
  ]);
  return { behind, branch: context.branch, incomingFileCount: fileCount, ...incoming };
}

/**
 * The newer saved versions an update check reported, as Save's refusal carries them.
 * @param {object} check
 */
function newerSavedFromCheck(check = {}) {
  return {
    behind: check.behind || 0,
    ...(check.branch ? { branch: check.branch } : {}),
    ...(Number.isSafeInteger(check.incomingFileCount) ? { incomingFileCount: check.incomingFileCount } : {}),
    incomingVersions: check.incomingVersions || [],
    incomingVersionsTruncated: check.incomingVersionsTruncated === true
  };
}

/**
 * Save's refusal while main has newer saved versions: the one message, and its facts in `details.newerSaved` so each
 * reader says them in its own clock and with the sessions Save recorded.
 * @param {object} newerSaved what `readNewerSaved` or `newerSavedFromCheck` gives, with `repository` for a connected
 *   copy; `{ branch }` alone when only "newer saved work" is known
 * @param {Record<string, unknown>} [details] the refusal's other details
 * @param {{ messageCode?: string }} [options]
 */
function newerSavedRefusal(newerSaved, details = {}, options = {}) {
  return saveError(
    newerSavedMessage(newerSavedFacts(newerSaved)),
    SAVE_UPDATE_REQUIRED,
    { ...details, newerSaved, updateRequired: true },
    options
  );
}

export {
  incomingFileCount,
  incomingVersionsBetween,
  newerSavedFromCheck,
  newerSavedRefusal,
  readNewerSaved
};
