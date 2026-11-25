// Which session saved the newer versions a session behind main is told about. Each Save records the versions it
// made (@local/vibe64-core/server/savedVersions); the update check, Save's refusal and the session's work answer name
// the saving session from that record, by its current name. A version Save did not record, or a record Vibe64
// cannot read, names nobody: the message then gives its time and file count alone.

import { newerSavedFacts, newerSavedMessage, newerSavedSource } from "@local/vibe64-core/shared";
import { readSavedVersions, recordSavedVersions } from "@local/vibe64-core/server/savedVersions";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// The session metadata entry holding its name (@local/vibe64-runtime's SESSION_LABEL_METADATA).
const SESSION_LABEL_METADATA = "label";

/**
 * Records the versions a finished Save made, its own and each connected copy's, as `session`'s. Never fails: the
 * Save already happened, and a version without a record only names nobody.
 * @param {{ runProjectSourceExclusive: Function }} project
 * @param {{ stateRoot?: string }} runtime
 * @param {{ sessionId: string, metadata?: Record<string, string> }} session
 * @param {{ saveCommit?: string, connected?: Array<{ name: string, saveCommit?: string }> }} result
 */
function recordSessionSave(project, runtime, session, result) {
  const savedAt = new Date().toISOString();
  const saver = {
    savedAt,
    sessionId: normalizeText(session?.sessionId),
    sessionName: normalizeText(session?.metadata?.[SESSION_LABEL_METADATA])
  };
  return recordSavedVersions({
    projectRuntimeRoot: runtime?.stateRoot,
    runExclusive: operation => project.runProjectSourceExclusive(operation, { operation: `record-saved-versions:${saver.sessionId}` }),
    saves: [
      ...(result.saveCommit ? [{ ...saver, commit: result.saveCommit, repository: "" }] : []),
      ...(result.connected || []).filter(copy => copy.saveCommit)
        .map(copy => ({ ...saver, commit: copy.saveCommit, repository: copy.name }))
    ]
  });
}

/** A session's name now, or null when it has none or cannot be read, such as a deleted session's. */
async function currentSessionName(runtime, sessionId) {
  try {
    return normalizeText(await runtime.store.readMetadataValue(sessionId, SESSION_LABEL_METADATA)) || null;
  } catch {
    return null;
  }
}

/**
 * `versions` with `savedBy` on each that Save recorded, by the saving session's current name.
 * @param {{ stateRoot?: string, store: { readMetadataValue: Function } }} runtime
 * @param {Array<{ commit: string }> | undefined} versions
 */
async function nameIncomingVersions(runtime, versions) {
  if (!Array.isArray(versions) || !versions.length) return versions;
  const saved = await readSavedVersions({ projectRuntimeRoot: runtime?.stateRoot, commits: versions.map(version => version?.commit) });
  if (!saved.size) return versions;
  const names = new Map();
  for (const { sessionId } of saved.values()) {
    if (!names.has(sessionId)) names.set(sessionId, await currentSessionName(runtime, sessionId));
  }
  return versions.map((version) => {
    const savedBy = saved.get(version?.commit);
    return savedBy ? { ...version, savedBy: { ...savedBy, sessionName: names.get(savedBy.sessionId) ?? savedBy.sessionName } } : version;
  });
}

/**
 * Save's refusal while main has newer saved versions, with the sessions that saved them named, in its details and in
 * its message, which may say more around it (such as the copies a Save pushed before it stopped).
 * @param {object} runtime
 * @param {Error & { details?: { newerSaved?: object } }} error
 */
async function nameNewerSavedRefusal(runtime, error) {
  const newerSaved = error?.details?.newerSaved;
  if (!newerSaved || !Array.isArray(newerSaved.incomingVersions)) return error;
  const named = { ...newerSaved, incomingVersions: await nameIncomingVersions(runtime, newerSaved.incomingVersions) };
  const unnamed = newerSavedMessage(newerSavedFacts(newerSaved));
  error.message = String(error.message || "").replace(unnamed, () => newerSavedMessage(newerSavedFacts(named)));
  error.details = { ...error.details, newerSaved: named };
  error.newerSaved = named;
  return error;
}

/**
 * What the session's work answer says about newer saved versions: its stored update check's when that check read
 * the same gap (same main and session head), so the page and the AI name them as the check did; otherwise how many,
 * or the connected copy behind its main. Null when nothing is newer.
 * @param {{ behind?: number, branch?: string, canonicalCommit?: string, sessionHead?: string, connected?: object[] }} work
 * @param {object | null} check the session's stored update check
 */
function workNewerSaved(work, check) {
  const source = newerSavedSource(work);
  if (!source) return null;
  if (source !== work) return { behind: source.behind, repository: source.repository };
  const branch = normalizeText(work.branch) || "main";
  if (!check || check.canonicalCommit !== work.canonicalCommit || check.sessionHead !== work.sessionHead || check.behind !== work.behind) {
    return { behind: work.behind, branch };
  }
  return {
    behind: check.behind,
    branch,
    ...(Number.isSafeInteger(check.incomingFileCount) ? { incomingFileCount: check.incomingFileCount } : {}),
    incomingVersions: check.incomingVersions,
    incomingVersionsTruncated: check.incomingVersionsTruncated === true
  };
}

export { nameIncomingVersions, nameNewerSavedRefusal, recordSessionSave, workNewerSaved };
