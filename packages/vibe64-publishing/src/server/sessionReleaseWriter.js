// Writes a prepared release (version bump + CHANGELOG entry) into a session's
// source through the source editor, like any edit the person makes there: the
// session's write lock, conflict hashes and change notifications all apply.
// The person then reviews and Saves it.
import { prepareReleaseChange } from "@local/vibe64-packaging/server/release";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

function writerError(message, code = "vibe64_publishing_prepare_failed") {
  return Object.assign(new Error(message), { code });
}

function createSessionReleaseWriter({ project, sourceEditor, today = () => new Date().toISOString().slice(0, 10) } = {}) {
  async function sessionRoot(sessionId) {
    const id = String(sessionId || "").trim();
    if (!id) throw writerError("Open a session first: the version change is written into it for you to review and Save.", "vibe64_publishing_session_required");
    const store = await project.createSessionStore();
    const session = await store.readSession(id);
    const root = session ? sessionSourcePath(session) : "";
    if (!root) throw writerError("That session has no source to write the release change into.", "vibe64_publishing_session_required");
    return root;
  }

  function stale(file) {
    return writerError(`${file.path} changed after the release was prepared. Prepare it again.`, "VIBE64_PUBLISH_PREPARE_STALE");
  }

  // The change was built from the text read when it was prepared. Every file
  // is checked against that text before any is written, so an edit made since
  // is never overwritten and the session is never left half-changed.
  async function baseHashes({ sessionId, files, user }) {
    const hashes = new Map();
    for (const file of files) {
      const current = await sourceEditor.readFile({ sessionId, path: file.path, vibe64User: user || undefined });
      if (file.before === null) {
        if (current?.ok !== false) throw stale(file);
        continue;
      }
      if (current?.ok === false) throw writerError(current.error || `Could not read ${file.path}.`);
      if (current.file.text !== file.before) throw stale(file);
      hashes.set(file.path, current.file.hash);
    }
    return hashes;
  }

  async function write({ sessionId, file, baseHash, user }) {
    const result = file.before === null
      ? await sourceEditor.createFile({ sessionId, path: file.path, text: file.after, vibe64User: user || undefined })
      : await sourceEditor.saveFile({ sessionId, path: file.path, text: file.after, baseHash, vibe64User: user || undefined });
    if (result?.ok === false) throw writerError(result.error || `Could not ${file.before === null ? "create" : "change"} ${file.path}.`);
  }

  return Object.freeze({
    async prepareAndWrite({ sessionId, entry, version, notes, user = null }) {
      const projectRoot = await sessionRoot(sessionId);
      const change = await prepareReleaseChange({ projectRoot, entry, version, notes, date: today() });
      const hashes = await baseHashes({ sessionId, files: change.files, user });
      for (const file of change.files) await write({ sessionId, file, baseHash: hashes.get(file.path), user });
      return change;
    }
  });
}

export { createSessionReleaseWriter };
