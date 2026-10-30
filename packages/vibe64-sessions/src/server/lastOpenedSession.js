import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { serializeByKey, writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";

// The session each person last opened in a project, so reopening the project
// returns to it in any browser or on any device. One small file per person
// under the project's state, named by a hash of the signed-in user's id; the
// standalone editor has no signed-in user and keeps one "local" record. It is
// never stored in a session, and the session list offers it only while it
// names an open session.
const LAST_OPENED_SESSIONS_DIR = "last-opened-sessions";
const pendingWrites = new Map();

function lastOpenedSessionPath(stateRoot, vibe64User) {
  const userId = String(vibe64User?.uid ?? vibe64User?.username ?? "local");
  const key = createHash("sha256").update(userId).digest("hex");
  return path.join(stateRoot, LAST_OPENED_SESSIONS_DIR, `${key}.json`);
}

// A missing, damaged or unreadable record is no record: the project then
// opens its default session.
async function readLastOpenedSessionId(stateRoot, vibe64User) {
  try {
    const record = JSON.parse(await readFile(lastOpenedSessionPath(stateRoot, vibe64User), "utf8"));
    return typeof record?.sessionId === "string" ? record.sessionId : "";
  } catch {
    return "";
  }
}

// Writes only a change, one write at a time per person and project.
async function rememberLastOpenedSessionId(stateRoot, vibe64User, sessionId) {
  const filePath = lastOpenedSessionPath(stateRoot, vibe64User);
  return serializeByKey(pendingWrites, filePath, async () => {
    if (await readLastOpenedSessionId(stateRoot, vibe64User) === sessionId) return false;
    await writeJsonFileAtomic(filePath, { sessionId });
    return true;
  });
}

export {
  readLastOpenedSessionId,
  rememberLastOpenedSessionId
};
