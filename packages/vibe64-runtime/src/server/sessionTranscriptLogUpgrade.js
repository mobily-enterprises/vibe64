// 20261124-chat-transcript-log's preparation: each chat's previous-release transcript.json becomes the appended
// transcript.jsonl (sessionTranscriptLog.js), staged through the stopped session store for Core's publisher.

import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { CONVERSATION_TURN_ID_PATTERN } from "./sessionRecordRules.js";
import {
  LEGACY_TRANSCRIPT_FILE,
  TRANSCRIPT_LOG_FILE,
  legacyTranscriptJson,
  parseLegacyTranscript,
  parseTranscriptLog,
  transcriptLogContents
} from "./sessionTranscriptLog.js";

/** @typedef {import("./types.js").SessionRecordFiles} SessionRecordFiles */
/** @typedef {import("./sessionTemporaryConversationRemoval.js").PrepareSessionStateUpgrade} PrepareSessionStateUpgrade */

/**
 * @param {{ recordFiles: SessionRecordFiles, prepareSessionStateUpgrade: PrepareSessionStateUpgrade }} dependencies
 */
function createSessionTranscriptLogUpgrade({ recordFiles, prepareSessionStateUpgrade }) {
  /**
   * 20261124: each chat's whole-record transcript.json becomes a transcript.jsonl
   * whose one line is the same record, which later messages append to. Main and
   * temporary chats of active and closing sessions, archives and prepared renewal
   * archives; nothing else changes. The new file is published before the old one
   * is removed, and each conversion is read back through the new reader and
   * compared with the old record before anything is staged.
   * @param {{ temporaryRoot: string, apply: boolean }} options
   * @returns {Promise<{ updates: object[], chats: number, perTurnLayouts: number }>}
   */
  async function prepareChatTranscriptLogUpgrade({ temporaryRoot, apply }) {
    let chats = 0;
    let perTurnLayouts = 0;
    const updates = await prepareSessionStateUpgrade({
      temporaryRoot,
      async inspectSession(sessionPaths, { checkedPath, inventory, readRegularText }) {
        await checkedPath(sessionPaths.sessionRoot, true);
        const scopes = [sessionPaths];
        for (const entry of await inventory(sessionPaths.conversationsRoot)) {
          if (entry.isDirectory()) scopes.push(recordFiles.conversationPaths(sessionPaths, entry.name));
        }
        const changes = [];
        for (const scope of scopes) {
          const entries = await inventory(scope.conversationLogRoot);
          const legacyPath = path.join(scope.conversationLogRoot, LEGACY_TRANSCRIPT_FILE);
          const logPath = path.join(scope.conversationLogRoot, TRANSCRIPT_LOG_FILE);
          const legacy = await checkedPath(legacyPath);
          if (legacy && await checkedPath(logPath)) {
            throw new Error(`A chat has both an old and a new transcript: ${scope.conversationLogRoot}. Inspect it and any earlier upgrade backup before upgrading.`);
          }
          if (!legacy) {
            // Older still: the per-turn layout, which 20261002-session-conversations converts before this upgrade runs.
            if (entries.some((entry) => CONVERSATION_TURN_ID_PATTERN.test(entry.name) || ["rewound.json", "message-ids.json"].includes(entry.name))) {
              if (apply) {
                throw new Error(`A chat is still in the per-turn layout: ${scope.conversationLogRoot}. Apply 20261002-session-conversations first; inspect it if that upgrade is already recorded.`);
              }
              perTurnLayouts += 1;
            }
            continue;
          }
          const original = await readRegularText(legacyPath);
          let record;
          let contents;
          try {
            record = parseLegacyTranscript(original);
            const unknown = Object.keys(JSON.parse(original)).filter((key) => !["version", "metadata", "rewound", "turns", "summary"].includes(key));
            if (unknown.length) throw new Error(`fields this upgrade does not know (${unknown.join(", ")})`);
            for (const [turnId, turn] of record.turns) {
              const fields = Object.keys(turn).filter((key) => !["messages", "metadata"].includes(key));
              if (fields.length) throw new Error(`turn ${turnId} has fields this upgrade does not know (${fields.join(", ")})`);
            }
            contents = transcriptLogContents(record);
          } catch (error) {
            throw new Error(`Chat transcript ${legacyPath} cannot be converted: ${error.message} Inspect it, or restore it from a backup, before upgrading.`);
          }
          if (!isDeepStrictEqual(legacyTranscriptJson(parseTranscriptLog(Buffer.from(contents, "utf8")).record), JSON.parse(original))) {
            throw new Error(`Chat transcript ${legacyPath} did not convert exactly, and nothing was changed. Inspect it before upgrading.`);
          }
          chats += 1;
          changes.push({ filePath: logPath, original: null, contents }, { filePath: legacyPath, original, contents: null });
        }
        return changes;
      }
    });
    return { updates, chats, perTurnLayouts };
  }

  return Object.freeze({ prepareChatTranscriptLogUpgrade });
}

export { createSessionTranscriptLogUpgrade };
