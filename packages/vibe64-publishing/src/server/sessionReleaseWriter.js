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

  async function write({ sessionId, file, user }) {
    if (file.before === null) {
      const created = await sourceEditor.createFile({ sessionId, path: file.path, text: file.after, vibe64User: user || undefined });
      if (created?.ok === false) throw writerError(created.error || `Could not create ${file.path}.`);
      return;
    }
    const current = await sourceEditor.readFile({ sessionId, path: file.path, vibe64User: user || undefined });
    if (current?.ok === false) throw writerError(current.error || `Could not read ${file.path}.`);
    // The change was built from the text read when it was prepared; an edit
    // since then is never overwritten with it.
    if (current.file.text !== file.before) {
      throw writerError(`${file.path} changed after the release was prepared. Prepare it again.`, "VIBE64_PUBLISH_PREPARE_STALE");
    }
    const saved = await sourceEditor.saveFile({ sessionId, path: file.path, text: file.after, baseHash: current.file.hash, vibe64User: user || undefined });
    if (saved?.ok === false) throw writerError(saved.error || `Could not change ${file.path}.`);
  }

  return Object.freeze({
    async prepareAndWrite({ sessionId, entry, version, notes, user = null }) {
      const projectRoot = await sessionRoot(sessionId);
      const change = await prepareReleaseChange({ projectRoot, entry, version, notes, date: today() });
      for (const file of change.files) await write({ sessionId, file, user });
      return change;
    }
  });
}

export { createSessionReleaseWriter };
