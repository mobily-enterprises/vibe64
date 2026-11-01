import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  conversationMessageIdentity,
  conversationMessageVersion,
  createConversationStorage,
  createConversationStreams,
  createConversationTranscript
} from "@jskit-ai/assistant-core/server/conversation";
import { isMissingPathError, isPlainObject, vibe64Error } from "@local/vibe64-core/server/core";
import { parseIntegrationSetupRequest } from "../shared/integrationSetupRequest.js";
import {
  VIBE64_ASSISTANT_ENGINE_ID_SET,
  defineVibe64AssistantSelection,
  vibe64AssistantSelectionFromMetadata
} from "../shared/assistantSelection.js";
import { normalizeVibe64ConversationAttachments } from "../shared/conversationAttachments.js";
import { writeJsonFile, writeTextFile } from "./sessionFiles.js";
import {
  CONVERSATION_MESSAGE_FILE_PATTERN,
  CONVERSATION_MESSAGE_ROLES,
  CONVERSATION_TURN_ATTACHMENTS_FILE,
  CONVERSATION_TURN_ID_PATTERN,
  CONVERSATION_TURN_METADATA_FILE,
  UUID_V4_PATTERN
} from "./sessionRecordRules.js";
import {
  conversationTurnRoot,
  createParsedFileCache,
  isoFromConversationTimestamp,
  readDirectoryEntries,
  readTextIfExists,
  sortedFileNames
} from "./sessionStoreLayout.js";
import { enqueueSessionMutation } from "./sessionStoreLocks.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("./types.js").SessionStoreState} SessionStoreState */
/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */
/** @typedef {import("./types.js").SessionRecordFiles} SessionRecordFiles */
/** @typedef {import("./types.js").SessionArchiveAccess} SessionArchiveAccess */
/** @typedef {import("./types.js").SessionRecords} SessionRecords */

const conversationStreams = createConversationStreams();
const conversationRecordCache = createParsedFileCache(8);
const conversationMessageIds = new WeakMap();

function conversationRecordHasMessage(record, messageId) {
  let ids = conversationMessageIds.get(record);
  if (!ids) {
    ids = new Set();
    for (const turn of record.turns.values()) {
      for (const message of turn.messages) if (message.messageId) ids.add(message.messageId);
    }
    conversationMessageIds.set(record, ids);
  }
  return Boolean(messageId) && ids.has(messageId);
}

function validIntegrationSetupCompletion(value) {
  return typeof value.configurationHash === "string" && /^[a-f0-9]{64}$/u.test(value.configurationHash) &&
    typeof value.verifiedAt === "string" && Number.isFinite(Date.parse(value.verifiedAt));
}

function validIntegrationContinuation(value) {
  if (!isPlainObject(value)) return false;
  if (value.status === "pending") return Object.keys(value).length === 1;
  return Object.keys(value).length === 3 && ["sending", "accepted"].includes(value.status) &&
    VIBE64_ASSISTANT_ENGINE_ID_SET.has(value.engineId) &&
    typeof value.threadId === "string" && value.threadId.trim() === value.threadId && value.threadId.length > 0;
}

function normalizeConversationTurnMetadata(value = null) {
  if (!isPlainObject(value)) {
    throw vibe64Error(
      "Conversation turn metadata must be an object.",
      "vibe64_invalid_conversation_turn_metadata"
    );
  }
  const other = { ...value };
  for (const key of [
    "actorDisplayName",
    "actorId",
    "engineId",
    "assistantSelection",
    "assistantRouting",
    "nativeMessageVersions"
  ]) delete other[key];
  return {
    ...other,
    actorDisplayName: toText(value.actorDisplayName),
    actorId: toText(value.actorId),
    ...(VIBE64_ASSISTANT_ENGINE_ID_SET.has(value.engineId) ? { engineId: value.engineId } : {}),
    ...(value.assistantSelection ? { assistantSelection: defineVibe64AssistantSelection(value.assistantSelection) } : {}),
    ...(isPlainObject(value.assistantRouting) &&
      ["senior", "junior", "fix", "helper", "review", "deslop"].includes(value.assistantRouting.resolvedMode) ? {
          assistantRouting: Object.fromEntries(["requestedMode", "resolvedMode", "reason", "parentMessageId", "settingsRevision"]
            .filter((key) => value.assistantRouting[key] !== undefined).map((key) => [key, value.assistantRouting[key]]))
        } : {}),
    ...(isPlainObject(value.nativeMessageVersions) ? {
      nativeMessageVersions: Object.fromEntries(Object.entries(value.nativeMessageVersions)
        .filter(([, version]) => typeof version === "string" && /^[a-f0-9]{64}$/u.test(version)))
    } : {})
  };
}

/**
 * Conversation storage: transcripts and their turns, integration setup
 * requests, a session's conversations and their live streams.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 * @param {SessionRecordFiles} dependencies.recordFiles
 * @param {SessionArchiveAccess} dependencies.archiveAccess
 * @param {SessionRecords} dependencies.sessionRecords
 */
function createSessionConversationStore({
  state,
  storePaths,
  recordFiles,
  archiveAccess,
  sessionRecords
}) {
  async function readConversationMessage(sessionPaths, turnId, fileName) {
    const match = toText(fileName).match(CONVERSATION_MESSAGE_FILE_PATTERN);
    if (!match) {
      return null;
    }
    const messageId = toText(match[3]);
    return {
      at: isoFromConversationTimestamp(match[2]),
      role: match[1],
      text: toText(await readTextIfExists(path.join(conversationTurnRoot(sessionPaths, turnId), fileName))),
      ...(messageId ? { messageId } : {})
    };
  }

  /** One conversation turn read from its per-turn message files, the layout the transcript state upgrade reads. */
  async function readConversationTurnDirectory(sessionPaths, turnId) {
    const fileNames = sortedFileNames(
      await readDirectoryEntries(conversationTurnRoot(sessionPaths, turnId)),
      (name) => CONVERSATION_MESSAGE_FILE_PATTERN.test(name)
    );
    const messages = (await Promise.all(
      fileNames.map((fileName) => readConversationMessage(sessionPaths, turnId, fileName))
    )).filter(Boolean);
    const [attachments, metadata] = await Promise.all([
      readConversationTurnAttachments(sessionPaths, turnId),
      readConversationTurnMetadata(sessionPaths, turnId)
    ]);
    return {
      messages: messages.map((message) => message.role === "user" && attachments.length ? { ...message, attachments } : message),
      ...(metadata ? { metadata } : {})
    };
  }

  async function readIntegrationSetupDecision(sessionPaths, turnId, assistant) {
    const request = parseIntegrationSetupRequest(assistant);
    if (!request) return null;
    const requestId = createHash("sha256").update(assistant.text).digest("hex");
    const text = await readTextIfExists(path.join(conversationTurnRoot(sessionPaths, turnId), "integration-setup.json"));
    let decision = { outcome: "pending" };
    if (text) {
      let saved;
      try {
        saved = JSON.parse(text);
      } catch {
        throw vibe64Error("Invalid integration setup decision.", "vibe64_invalid_integration_setup_decision");
      }
      const completed = saved?.outcome === "completed";
      if (!isPlainObject(saved) || Object.keys(saved).length !== (completed ? 6 : 2) ||
          typeof saved.requestId !== "string" || !/^[a-f0-9]{64}$/u.test(saved.requestId) ||
          (completed ? !validIntegrationSetupCompletion(saved) || !validIntegrationContinuation(saved.continuation) ||
            typeof saved.continuationMessageId !== "string" ||
            !UUID_V4_PATTERN.test(saved.continuationMessageId) : saved.outcome !== "skipped")) {
        throw vibe64Error("Invalid integration setup decision.", "vibe64_invalid_integration_setup_decision");
      }
      if (saved.requestId === requestId) decision = saved;
    }
    return { integrationId: request.integrationId, requestId, ...decision };
  }

  async function readIntegrationSetupRequest(sessionId, turnId) {
    if (typeof turnId !== "string" || !CONVERSATION_TURN_ID_PATTERN.test(turnId)) {
      throw vibe64Error("Invalid integration setup request.", "vibe64_invalid_integration_setup_request");
    }
    return archiveAccess.withReadableSessionPaths(sessionId, async (sessionPaths) =>
      (await readConversationTurn(sessionPaths, turnId)).integrationSetup || null);
  }

  /**
   * Only the authorized setup-command owner may supply this evidence after
   * checking the application's result against the current configuration.
   */
  async function completeIntegrationSetupRequest(sessionId, selection = {}) {
    if (!validIntegrationSetupCompletion(selection)) {
      throw vibe64Error("Invalid integration setup completion.", "vibe64_invalid_integration_setup_completion");
    }
    return decideIntegrationSetupRequest(sessionId, selection, {
      configurationHash: selection.configurationHash,
      verifiedAt: selection.verifiedAt,
      continuationMessageId: randomUUID(),
      continuation: { status: "pending" },
      outcome: "completed"
    });
  }

  async function skipIntegrationSetupRequest(sessionId, selection = {}) {
    return decideIntegrationSetupRequest(sessionId, selection, { outcome: "skipped" });
  }

  /**
   * Persist before contacting the provider. A previous claim must be inspected,
   * even after a restart; lack of local history does not prove non-delivery.
   */
  async function claimIntegrationContinuation(sessionId, selection = {}) {
    return updateIntegrationContinuation(sessionId, selection, "sending");
  }

  async function acceptIntegrationContinuation(sessionId, selection = {}) {
    return updateIntegrationContinuation(sessionId, selection, "accepted");
  }

  async function updateIntegrationContinuation(sessionId, selection, status) {
    const { turnId, requestId, continuationMessageId, engineId, threadId } = selection;
    const continuation = { status, engineId, threadId };
    if (typeof turnId !== "string" || !CONVERSATION_TURN_ID_PATTERN.test(turnId) ||
        !validIntegrationContinuation(continuation)) {
      throw vibe64Error("Invalid integration continuation.", "vibe64_invalid_integration_continuation");
    }
    return sessionRecords.mutateSession(sessionId, async (sessionPaths) => {
      const saved = (await readConversationTurn(sessionPaths, turnId)).integrationSetup;
      if (!saved || saved.outcome !== "completed" || saved.requestId !== requestId ||
          saved.continuationMessageId !== continuationMessageId) {
        throw vibe64Error(
          "This integration completion has changed or no longer exists.",
          "vibe64_integration_setup_request_changed"
        );
      }
      if (saved.continuation.status !== "pending" &&
          (saved.continuation.engineId !== engineId || saved.continuation.threadId !== threadId)) {
        throw vibe64Error(
          "This continuation belongs to a different assistant thread.",
          "vibe64_integration_continuation_thread_changed"
        );
      }
      if (status === "accepted" && saved.continuation.status === "pending") {
        throw vibe64Error(
          "This integration continuation has not been claimed.",
          "vibe64_integration_continuation_not_claimed"
        );
      }
      if (saved.continuation.status === "accepted" ||
          (status === "sending" && saved.continuation.status === "sending")) {
        return { changed: false, integrationSetup: saved };
      }
      const updated = { ...saved, continuation };
      const { integrationId, ...record } = updated;
      await writeJsonFile(path.join(conversationTurnRoot(sessionPaths, turnId), "integration-setup.json"), record);
      return { changed: true, integrationSetup: { ...record, integrationId } };
    });
  }

  async function decideIntegrationSetupRequest(sessionId, { turnId, requestId }, decision) {
    if (typeof turnId !== "string" || !CONVERSATION_TURN_ID_PATTERN.test(turnId) ||
        typeof requestId !== "string" || !/^[a-f0-9]{64}$/u.test(requestId)) {
      throw vibe64Error("Invalid integration setup request.", "vibe64_invalid_integration_setup_request");
    }
    return sessionRecords.mutateSession(sessionId, async (sessionPaths) => {
      const turn = await readConversationTurn(sessionPaths, turnId);
      if (!turn.integrationSetup || turn.integrationSetup.requestId !== requestId) {
        throw vibe64Error(
          "This integration setup request has changed or no longer exists.",
          "vibe64_integration_setup_request_changed"
        );
      }
      if (turn.integrationSetup.outcome === "completed" && decision.outcome === "completed" &&
          turn.integrationSetup.configurationHash !== decision.configurationHash) {
        throw vibe64Error(
          "This request was completed against a different integration configuration.",
          "vibe64_integration_setup_configuration_changed"
        );
      }
      // The first saved decision wins, including across independent store instances.
      if (turn.integrationSetup.outcome !== "pending") return turn.integrationSetup;
      await writeJsonFile(path.join(conversationTurnRoot(sessionPaths, turnId), "integration-setup.json"), {
        requestId,
        ...decision
      });
      return { ...turn.integrationSetup, ...decision };
    });
  }

  async function readConversationTurnAttachments(sessionPaths, turnId) {
    const source = await readTextIfExists(path.join(
      conversationTurnRoot(sessionPaths, turnId),
      CONVERSATION_TURN_ATTACHMENTS_FILE
    ));
    if (!source) {
      return [];
    }
    try {
      const value = JSON.parse(source);
      const attachments = normalizeVibe64ConversationAttachments(value);
      if (!Array.isArray(value) || attachments.length !== value.length) {
        throw new TypeError("Conversation attachments must be a valid attachment list.");
      }
      return attachments;
    } catch (error) {
      throw vibe64Error(
        `Conversation turn ${turnId} attachments are invalid: ${toText(error?.message) || "unknown error"}`,
        "vibe64_invalid_conversation_turn_attachments"
      );
    }
  }

  async function readConversationTurnMetadata(sessionPaths, turnId) {
    const text = await readTextIfExists(path.join(
      conversationTurnRoot(sessionPaths, turnId),
      CONVERSATION_TURN_METADATA_FILE
    ));
    if (!text) {
      return null;
    }
    try {
      return normalizeConversationTurnMetadata(JSON.parse(text));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw vibe64Error(
          `Conversation turn ${turnId} metadata is not valid JSON.`,
          "vibe64_invalid_conversation_turn_metadata"
        );
      }
      throw error;
    }
  }

  function conversationRecordJson(record) {
    return { version: 1, metadata: record.metadata, rewound: record.rewound, turns: [...record.turns] };
  }

  function parseConversationRecord(source) {
    let value;
    try {
      value = JSON.parse(source);
    } catch {
      throw vibe64Error("Conversation storage is not valid JSON. Restore it before continuing.", "vibe64_invalid_conversation_storage");
    }
    return validateConversationDocument(value);
  }

  function validateConversationDocument(value) {
    const turnIds = Array.isArray(value?.turns) ? new Set(value.turns.map((entry) => entry?.[0])) : new Set();
    if (value?.version !== 1 || !isPlainObject(value.metadata) || !Array.isArray(value.rewound) || !Array.isArray(value.turns) ||
        value.turns.some((entry) => !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== "string" ||
          !CONVERSATION_TURN_ID_PATTERN.test(entry[0]) ||
          !isPlainObject(entry[1]) || !Array.isArray(entry[1].messages) ||
          (entry[1].metadata !== undefined && !isPlainObject(entry[1].metadata)) ||
          entry[1].messages.some((message) => !isPlainObject(message) || !CONVERSATION_MESSAGE_ROLES.includes(message.role) ||
            typeof message.text !== "string" || typeof message.at !== "string" || !Number.isFinite(Date.parse(message.at)) ||
            (message.messageId !== undefined && typeof message.messageId !== "string"))) ||
        turnIds.size !== value.turns.length ||
        value.rewound.some((id) => !turnIds.has(id))) {
      throw vibe64Error(
        "Conversation storage has an unsupported or damaged format. Restore it before continuing.",
        "vibe64_invalid_conversation_storage"
      );
    }
    return { metadata: value.metadata, rewound: value.rewound, turns: new Map(value.turns) };
  }

  async function readConversationRecord(sessionPaths) {
    try {
      return await conversationRecordCache.read(path.join(sessionPaths.conversationLogRoot, "transcript.json"), parseConversationRecord);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    const entries = await readDirectoryEntries(sessionPaths.conversationLogRoot);
    if (entries.some((entry) =>
      CONVERSATION_TURN_ID_PATTERN.test(entry.name) || ["rewound.json", "message-ids.json"].includes(entry.name))) {
      throw vibe64Error(
        "This conversation needs the offline state upgrade. Stop services and run the candidate upgrade-state command before opening it.",
        "vibe64_conversation_upgrade_required"
      );
    }
    return { turns: new Map(), metadata: {}, rewound: [] };
  }

  /**
   * The session lease owns cross-process exclusion; JSKIT owns the transaction.
   * One rename publishes messages, native receipts and runtime metadata together.
   */
  function conversationRecordTransaction(sessionPaths, callback, write = false, newTurnMetadata = null) {
    let record;
    const storage = createConversationStorage({
      async readRecord() {
        record = await readConversationRecord(sessionPaths);
        return record;
      },
      async writeRecord(_scope, next) {
        // Transactions cannot change rewind markers; keep the saved ones.
        next = { metadata: next.metadata, turns: next.turns, rewound: next.rewound ?? record.rewound };
        const document = conversationRecordJson(next);
        validateConversationDocument(document);
        // Compact JSON: every reader parses it, and pretty printing a long
        // transcript on each update costs more than the rest of the write.
        const filePath = path.join(sessionPaths.conversationLogRoot, "transcript.json");
        const identity = await writeTextFile(filePath, `${JSON.stringify(document)}\n`);
        // The written document is final: JSKIT's write does not change it again.
        conversationRecordCache.remember(filePath, identity, next);
      }
    });
    return storage[write ? "write" : "read"](sessionPaths.conversationLogRoot, (transaction) => callback({
      ...transaction,
      /**
       * A read sees the saved record unchanged, so its message index applies.
       */
      ...(write ? {} : {
        async hasMessage(id) {
          return conversationRecordHasMessage(record, id);
        }
      }),
      async listTurnIds() {
        return (await transaction.listTurnIds()).filter((id) => !record.rewound.includes(id));
      },
      /**
       * Identity lookups see the same turns as listTurnIds.
       */
      // readable-check: allow method-probe - optional operation: a transaction without message lookups offers none
      ...(typeof transaction.findMessageTurnId === "function" ? {
        async findMessageTurnId(id) {
          const turnId = await transaction.findMessageTurnId(id);
          return turnId && !record.rewound.includes(turnId) ? turnId : "";
        }
      } : {}),
      async readTurn(id) {
        const turn = await transaction.readTurn(id);
        if (!turn || record.rewound.includes(id)) return turn;
        const integrationSetup = await readIntegrationSetupDecision(sessionPaths, id, turn.assistant);
        return integrationSetup ? { ...turn, integrationSetup } : turn;
      },
      async appendMessage(id, message) {
        const saved = await transaction.readTurn(id);
        let metadata = message.turnMetadata ? normalizeConversationTurnMetadata({
          ...saved?.metadata,
          ...message.turnMetadata
        }) : saved?.metadata;
        if (!saved && !metadata?.assistantSelection && newTurnMetadata) {
          metadata = normalizeConversationTurnMetadata({
            ...newTurnMetadata,
            ...metadata
          });
        }
        if (!saved && !metadata?.assistantSelection) {
          const selection = vibe64AssistantSelectionFromMetadata(
            await recordFiles.readMetadataFromPaths(sessionPaths),
            { required: false }
          );
          if (selection && (!metadata?.engineId || metadata.engineId === selection.engineId)) {
            metadata = normalizeConversationTurnMetadata({ ...metadata, engineId: selection.engineId, assistantSelection: selection });
          }
        }
        if (metadata?.engineId && message.role !== "thinking") {
          metadata.nativeMessageVersions = {
            ...metadata.nativeMessageVersions,
            [conversationMessageIdentity(id, message)]: conversationMessageVersion(message)
          };
        }
        await transaction.appendMessage(id, { ...message, ...(metadata ? { turnMetadata: metadata } : {}) });
      },
      async replaceAssistant(id, message) {
        const previous = await transaction.readTurn(id);
        const metadata = previous?.metadata || {};
        const key = conversationMessageIdentity(id, { role: "assistant" });
        if (previous?.assistant && !metadata.nativeMessageVersions?.[key]) {
          await transaction.updateTurnMetadata(id, {
            nativeMessageVersions: {
              ...metadata.nativeMessageVersions,
              [key]: conversationMessageVersion(previous.assistant)
            }
          });
        }
        await transaction.replaceAssistant(id, message);
      }
    }));
  }

  async function readConversationTurn(sessionPaths, turnId) {
    return conversationRecordTransaction(sessionPaths, async (transaction) => await transaction.readTurn(turnId) || {
      turnId,
      user: null,
      assistant: null,
      thinking: [],
      commentary: [],
      messages: []
    });
  }

  async function readConversationTail(sessionId, options = {}) {
    const { userLimit = 2 } = options;
    return withConversationTransaction(sessionId, async (transaction) => {
      const turns = [];
      let users = 0;
      for (const id of (await transaction.listTurnIds()).reverse()) {
        const turn = await transaction.readTurn(id);
        turns.unshift(turn);
        if (turn.user && ++users >= userLimit) break;
      }
      return turns;
    }, false);
  }

  async function readFirstUserMessage(sessionId) {
    return archiveAccess.withReadableSessionPaths(sessionId, async (paths) => {
      const record = await readConversationRecord(paths);
      for (const turn of record.turns.values()) {
        const user = turn.messages.find((message) => message.role === "user");
        if (user) return user;
      }
      return null;
    });
  }

  async function readSessionConversation(sessionId, conversationId) {
    return archiveAccess.withReadableSessionPaths(sessionId, async (paths) => {
      const text = await readTextIfExists(
        path.join(recordFiles.conversationPaths(paths, conversationId).conversationRoot, "conversation.json")
      );
      return text ? JSON.parse(text) : null;
    });
  }

  async function listSessionConversations(sessionId) {
    return archiveAccess.withReadableSessionPaths(sessionId, async (paths) => {
      const entries = await readDirectoryEntries(paths.conversationsRoot);
      const records = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        const text = await readTextIfExists(
          path.join(recordFiles.conversationPaths(paths, entry.name).conversationRoot, "conversation.json")
        );
        return text ? JSON.parse(text) : null;
      }));
      return records.filter(Boolean).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    });
  }

  async function writeSessionConversation(sessionId, conversationId, patch) {
    return sessionRecords.mutateSession(sessionId, async (paths) => {
      const file = path.join(recordFiles.conversationPaths(paths, conversationId).conversationRoot, "conversation.json");
      const text = await readTextIfExists(file);
      const previous = text ? JSON.parse(text) : {};
      const record = {
        ...previous,
        ...patch,
        conversationId,
        createdAt: previous.createdAt || state.now().toISOString(),
        updatedAt: state.now().toISOString()
      };
      await writeJsonFile(file, record);
      return record;
    });
  }

  async function deleteSessionConversation(sessionId, conversationId) {
    return sessionRecords.mutateSession(sessionId, (paths) => rm(recordFiles.conversationPaths(paths, conversationId).conversationRoot, {
      recursive: true,
      force: true
    }));
  }

  function withConversationTransaction(scope, callback, write) {
    const sessionId = typeof scope === "string" ? scope : scope.sessionId;
    const operation = write ? sessionRecords.mutateSession : archiveAccess.withReadableSessionPaths;
    return operation(sessionId, (paths) => {
      const scopedPaths = typeof scope === "string" ? paths : recordFiles.conversationPaths(paths, scope.conversationId);
      const run = () => conversationRecordTransaction(scopedPaths, callback, write, typeof scope === "string" ? null : scope.turnMetadata);
      // Nested session mutations can have concurrent participants. Serialize
      // transcript writes within that lease as well as between root mutations.
      return write ? enqueueSessionMutation(scopedPaths.conversationLogRoot, run) : run();
    });
  }

  /** A read-only transcript transaction for JSKIT's conversation transcript. */
  function readConversationStorage(scope, callback) {
    return withConversationTransaction(scope, callback, false);
  }

  /** A transcript transaction that may write, serialized with the session's other transcript writes. */
  function writeConversationStorage(scope, callback) {
    return withConversationTransaction(scope, callback, true);
  }

  const conversationStorage = Object.freeze({
    read: readConversationStorage,
    write: writeConversationStorage
  });

  const {
    readConversationLog,
    readConversationLogPage,
    conversationMessageIdExists,
    findSubmittedTurn: findSubmittedConversationTurn,
    writeConversationUserMessage: appendUserMessage,
    writeConversationAssistantMessage,
    upsertConversationAssistantMessage,
    writeConversationCommentaryMessage,
    writeConversationThinkingMessage,
    writeConversationSystemMessage
  } = createConversationTranscript({
    clock: state.now,
    storage: conversationStorage
  });

  /**
   * One conversation-log entry by turn ID, or null like an absent log entry.
   */
  function readConversationLogTurn(scope, turnId) {
    return withConversationTransaction(scope, async (transaction) => {
      if (!(await transaction.listTurnIds()).includes(turnId)) return null;
      const turn = await transaction.readTurn(turnId);
      return turn?.messages?.length ? turn : null;
    }, false);
  }

  function writeConversationUserMessage(scope, input) {
    return appendUserMessage(scope, { ...input, attachments: normalizeVibe64ConversationAttachments(input?.attachments) });
  }

  function conversationStreamScope(scope) {
    return typeof scope === "string" ? storePaths.paths(scope).sessionRoot
      : recordFiles.conversationPaths(storePaths.paths(scope.sessionId), scope.conversationId).conversationRoot;
  }

  function readConversationStream(scope) {
    return conversationStreams.read(conversationStreamScope(scope));
  }

  function updateConversationStream(scope, message) {
    return conversationStreams.update(conversationStreamScope(scope), message);
  }

  function completeConversationStreamMessage(scope, messageId) {
    return conversationStreams.complete(conversationStreamScope(scope), messageId);
  }

  function clearConversationStream(scope) {
    return conversationStreams.clear(conversationStreamScope(scope));
  }

  return Object.freeze({
    acceptIntegrationContinuation,
    claimIntegrationContinuation,
    clearConversationStream,
    completeConversationStreamMessage,
    completeIntegrationSetupRequest,
    conversationMessageIdExists,
    conversationRecordJson,
    conversationStorage,
    deleteSessionConversation,
    findSubmittedConversationTurn,
    listSessionConversations,
    parseConversationRecord,
    readConversationLog,
    readConversationLogPage,
    readConversationLogTurn,
    readConversationStream,
    readConversationTail,
    readFirstUserMessage,
    readIntegrationSetupRequest,
    readConversationTurnDirectory,
    readSessionConversation,
    skipIntegrationSetupRequest,
    updateConversationStream,
    upsertConversationAssistantMessage,
    writeConversationAssistantMessage,
    writeConversationCommentaryMessage,
    writeConversationSystemMessage,
    writeConversationThinkingMessage,
    writeConversationUserMessage,
    writeSessionConversation
  });
}

export {
  createSessionConversationStore
};
