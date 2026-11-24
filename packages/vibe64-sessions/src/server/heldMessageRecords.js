import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// A held message lives in the editor's memory while it waits, and a restart (a shutdown, a crash) loses that memory
// before the message reached its assistant. The session's records keep, for each message held past its answer, that
// it waits or how it ended unsent, so the restarted editor's delivery check says it was not sent and Retry sends it.
const HELD_MESSAGES_METADATA = "held_agent_messages";
const KEPT_ENTRIES = 50;
// A record older than this is dropped: a page that last followed it a day ago has long settled it.
const KEPT_MS = 24 * 60 * 60_000;
const RESTARTED = Object.freeze({
  code: "vibe64_agent_message_server_restarting",
  error: "Vibe64 restarted before this message reached the assistant. Send it again."
});

function parseEntries(raw) {
  try {
    const entries = JSON.parse(raw || "{}")?.entries;
    return Array.isArray(entries) ? entries.filter(entry => normalizeText(entry?.messageId)) : [];
  } catch {
    return [];
  }
}

/**
 * The session's records of its held messages, in session metadata `held_agent_messages` (`schemaVersion` 1),
 * written only in `mutateSession`.
 * @param {{ createRuntimeWithoutSource: () => Promise<any> }} project
 */
function createHeldMessageRecords(project) {
  async function change(sessionId, operation) {
    const runtime = await project.createRuntimeWithoutSource();
    await runtime.store.mutateSession(sessionId, async () => {
      const now = Date.now();
      const entries = operation(parseEntries(await runtime.store.readMetadataValue(sessionId, HELD_MESSAGES_METADATA)))
        .filter(entry => now - Date.parse(entry.at) < KEPT_MS)
        .slice(-KEPT_ENTRIES);
      await runtime.store.writeMetadataValue(sessionId, HELD_MESSAGES_METADATA, JSON.stringify({ schemaVersion: 1, entries }));
    });
  }

  /**
   * Records that this message waits, before its held answer goes out.
   * @param {string} sessionId
   * @param {string} messageId
   */
  function hold(sessionId, messageId) {
    return change(sessionId, entries => [
      ...entries.filter(entry => entry.messageId !== messageId),
      { messageId, status: "waiting", at: new Date().toISOString() }
    ]);
  }

  /**
   * Records how a held message's delivery ended: kept when it ended unsent, with its refusal, and dropped otherwise,
   * since the assistant's own delivery records then know it.
   * @param {string} sessionId
   * @param {string} messageId
   * @param {{ status: string, error?: string, code?: string }} receipt
   */
  function settle(sessionId, messageId, receipt) {
    return change(sessionId, entries => [
      ...entries.filter(entry => entry.messageId !== messageId),
      ...(receipt.status === "not-sent" ? [{
        messageId,
        status: "not-sent",
        at: new Date().toISOString(),
        error: normalizeText(receipt.error),
        code: normalizeText(receipt.code)
      }] : [])
    ]);
  }

  /**
   * The delivery check a record answers, or null without one: not sent, with its refusal, or, for one still marked
   * waiting (the editor stopped before it ended), with the restart's refusal.
   * @param {string} sessionId
   * @param {string} messageId
   */
  async function read(sessionId, messageId) {
    const runtime = await project.createRuntimeWithoutSource();
    const entry = parseEntries(await runtime.store.readMetadataValue(sessionId, HELD_MESSAGES_METADATA))
      .find(candidate => candidate.messageId === messageId);
    if (!entry) return null;
    const refusal = entry.status === "not-sent" && entry.error ? entry : RESTARTED;
    return {
      status: "not-sent",
      messageId,
      error: refusal.error,
      ...(refusal.code ? { code: refusal.code } : {}),
      recorded: true
    };
  }

  return Object.freeze({
    hold,
    read,
    settle
  });
}

export { createHeldMessageRecords, HELD_MESSAGES_METADATA, RESTARTED as HELD_MESSAGE_RESTARTED };
