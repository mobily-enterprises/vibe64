// Save's record of which session saved each version, so a session behind main is told who saved the newer versions
// without anyone guessing it from the commits. It is one file in the project's runtime state root, beside the
// project's locks and session records, so the workspace's backups and moves carry it with the rest of the project's
// state; Save writes it under the project source lock, with the project's shared file mode. It only names sessions:
// a record that is missing, unreadable or corrupt names none and never stops a Save or an Update, and the next Save
// writes it again whole.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";
import { writeJsonFileAtomic } from "./atomicFile.js";

const SAVED_VERSIONS_FILE = "saved-versions.json";
// The newest Saves kept: a session is told about at most five newer versions, so older ones name nobody it reads.
const SAVED_VERSIONS_LIMIT = 200;
const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/u;

/** @param {string} projectRuntimeRoot */
function savedVersionsPath(projectRuntimeRoot) {
  return path.join(projectRuntimeRoot, SAVED_VERSIONS_FILE);
}

/**
 * One Save's entry, or null for anything else.
 * @param {unknown} value
 */
function savedEntry(value) {
  const commit = normalizeText(value?.commit);
  const sessionId = normalizeText(value?.sessionId);
  if (!COMMIT_PATTERN.test(commit) || !sessionId) return null;
  return {
    commit,
    repository: normalizeText(value.repository).slice(0, 200),
    savedAt: normalizeText(value.savedAt).slice(0, 100),
    sessionId: sessionId.slice(0, 200),
    sessionName: normalizeText(value.sessionName).slice(0, 200)
  };
}

/** The stored entries, newest first; none when the file is missing, unreadable or not this record. */
async function storedSaves(filePath) {
  let stored;
  try {
    stored = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
  return Array.isArray(stored?.saves) ? stored.saves.map(savedEntry).filter(Boolean) : [];
}

/**
 * Records the versions one Save made: the session's own commit and each connected copy's. True once recorded;
 * false, never a failure, when it could not be, since the Save it follows already happened.
 * @param {{ projectRuntimeRoot: string, runExclusive?: (operation: () => Promise<void>) => Promise<void>,
 *   saves: Array<{ commit: string, repository?: string, savedAt: string, sessionId: string, sessionName?: string }> }} input
 */
async function recordSavedVersions({ projectRuntimeRoot = "", runExclusive = operation => operation(), saves = [] } = {}) {
  const root = normalizeText(projectRuntimeRoot);
  const added = saves.map(savedEntry).filter(Boolean);
  if (!path.isAbsolute(root) || !added.length) return false;
  try {
    await runExclusive(async () => {
      const filePath = savedVersionsPath(root);
      const kept = (await storedSaves(filePath)).filter(entry => !added.some(save => save.commit === entry.commit));
      // No one needs it after a power cut more than Save needs to finish quickly, so it is written without a sync.
      await writeJsonFileAtomic(filePath, { saves: [...added, ...kept].slice(0, SAVED_VERSIONS_LIMIT) }, {
        durable: false,
        fileMode: vibe64SharedModes().file
      });
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Who saved each of `commits` that Save recorded, by commit.
 * @param {{ projectRuntimeRoot: string, commits: string[] }} input
 * @returns {Promise<Map<string, { savedAt: string, sessionId: string, sessionName: string }>>}
 */
async function readSavedVersions({ projectRuntimeRoot = "", commits = [] } = {}) {
  const root = normalizeText(projectRuntimeRoot);
  const wanted = new Set(commits.map(normalizeText).filter(Boolean));
  const found = new Map();
  if (!path.isAbsolute(root) || !wanted.size) return found;
  for (const { commit, savedAt, sessionId, sessionName } of await storedSaves(savedVersionsPath(root))) {
    if (wanted.has(commit) && !found.has(commit)) found.set(commit, { savedAt, sessionId, sessionName });
  }
  return found;
}

export {
  readSavedVersions,
  recordSavedVersions,
  savedVersionsPath
};
