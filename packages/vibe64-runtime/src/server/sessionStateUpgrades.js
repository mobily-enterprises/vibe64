import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMissingPathError, isPlainObject } from "@local/vibe64-core/server/core";
import { explicitPathIsManagedSessionSource } from "@local/vibe64-core/server/sessionSourcePath";
import {
  assertValidVibe64SessionId,
  assertVibe64SessionStatus,
  CONVERSATION_MESSAGE_FILE_PATTERN,
  CONVERSATION_TURN_ATTACHMENTS_FILE,
  CONVERSATION_TURN_ID_PATTERN,
  CONVERSATION_TURN_METADATA_FILE,
  isValidVibe64SessionId,
  LEARNING_SESSION_METADATA,
  learningSessionBinding,
  RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES,
  validateLearningSessionScope,
  VIBE64_SESSION_STATUS
} from "./sessionRecordRules.js";
import {
  ARCHIVE_EXECUTIONS,
  conversationTurnRoot,
  metadataFilePath,
  readDirectoryEntries,
  readTextIfExists,
  runCommand,
  sortedDirectoryNames
} from "./sessionStoreLayout.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").SessionStoreState} SessionStoreState */
/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */
/** @typedef {import("./types.js").SessionRecordFiles} SessionRecordFiles */
/** @typedef {import("./types.js").SessionArchiveRecords} SessionArchiveRecords */
/** @typedef {import("./types.js").SessionArchiveAccess} SessionArchiveAccess */
/** @typedef {ReturnType<typeof import("./sessionConversationStore.js").createSessionConversationStore>} SessionConversationStore */

/**
 * Applies each message-data patch to the one message it names, in place.
 * @param {object[]} messages
 * @param {unknown} patches
 * @returns {boolean} whether any message's data changed
 */
function applyMessageDataPatches(messages, patches) {
  if (!Array.isArray(patches)) throw new Error("Conversation data upgrade must return message-data patches.");
  let changed = false;
  const patched = new Set();
  for (const patch of patches) {
    const matches = messages.filter(message => message.messageId === patch.messageId);
    if (!patch.messageId || patched.has(patch.messageId) || matches.length !== 1 || !isPlainObject(patch.data)) {
      throw new Error("Conversation data upgrade has an unknown or ambiguous message identity.");
    }
    patched.add(patch.messageId);
    const message = matches[0];
    if (message.data !== undefined && !isPlainObject(message.data)) {
      throw new Error("Conversation message has invalid data. Inspect it before upgrading.");
    }
    const data = { ...message.data, ...patch.data };
    if (!isDeepStrictEqual(message.data, data)) {
      message.data = data;
      changed = true;
    }
  }
  return changed;
}

/**
 * The file changes that move each saved plan to the upgraded plan text, retiring its old location.
 * @param {object[]} plans the plans read before the upgrade
 * @param {object[]} upgradedPlans the transform's plans
 */
function planChanges(plans, upgradedPlans) {
  const changes = [];
  for (const plan of upgradedPlans) {
    const previous = plans.find(({ conversationId }) => conversationId === plan.conversationId);
    if (!previous || typeof plan.text !== "string") throw new Error("Plan upgrade cannot create an unknown conversation's plan.");
    if (previous.original !== plan.text) {
      changes.push({
        filePath: previous.filePath,
        original: previous.original,
        contents: plan.text
      });
    }
    if (previous.originalOld !== null) changes.push({ filePath: previous.oldPath, original: previous.originalOld, contents: null });
  }
  return changes;
}

/**
 * Prepares the stopped-writer upgrades of the store's session state.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 * @param {SessionRecordFiles} dependencies.recordFiles
 * @param {SessionArchiveRecords} dependencies.archiveRecords
 * @param {SessionArchiveAccess} dependencies.archiveAccess
 * @param {SessionConversationStore} dependencies.conversationStore
 */
function createSessionStateUpgrades({
  state,
  storePaths,
  recordFiles,
  archiveRecords,
  archiveAccess,
  conversationStore
}) {
  async function prepareAssistantRoutingStateUpgrade({
    temporaryRoot,
    transform,
    transformTurnMetadata,
    transformHelperRecord,
    includePlans = false,
    transformPlanProgress
  }) {
    if (typeof transform !== "function") throw new Error("Routing upgrade requires a transform.");
    const inspectSession = async (sessionPaths, { checkedPath, inventory, readRegularText }) => {
      await checkedPath(sessionPaths.sessionRoot, true);
      await checkedPath(sessionPaths.manifestPath);
      await recordFiles.readManifestFromPaths(sessionPaths);
      await inventory(sessionPaths.metadataRoot);
      const metadata = await recordFiles.readMetadataFromPaths(sessionPaths);
      const conversations = [];
      for (const entry of await inventory(sessionPaths.conversationsRoot)) {
        if (!entry.isDirectory()) continue;
        const filePath = path.join(recordFiles.conversationPaths(sessionPaths, entry.name).conversationRoot, "conversation.json");
        const original = await readRegularText(filePath);
        if (original) {
          let record;
          try {
            record = JSON.parse(original);
          } catch {
            throw new Error(`Invalid temporary conversation record: ${filePath}. Inspect it before upgrading routing.`);
          }
          if (!isPlainObject(record)) throw new Error(`Invalid temporary conversation record: ${filePath}.`);
          if (record.conversationId !== entry.name) throw new Error(`Temporary conversation identity does not match ${filePath}.`);
          conversations.push({ filePath, original, record });
        }
      }
      const plans = [];
      if (includePlans) {
        for (const scope of [{ conversationId: "", root: sessionPaths.sessionRoot }, ...conversations.map(({ record, filePath }) => ({
          conversationId: record.conversationId,
          root: path.dirname(filePath)
        }))]) {
          const oldPath = path.join(scope.root, "work-plan", "plan.md");
          const filePath = path.join(scope.root, "plans", "current.md");
          await checkedPath(path.dirname(oldPath), true);
          await checkedPath(path.dirname(filePath), true);
          const originalOld = await checkedPath(oldPath) ? await readRegularText(oldPath) : null;
          const original = await checkedPath(filePath) ? await readRegularText(filePath) : null;
          if (originalOld !== null || original !== null) plans.push({ ...scope, oldPath, filePath, originalOld, original });
        }
      }
      const next = await transform({
        sessionId: sessionPaths.sessionId,
        metadata: { ...metadata },
        conversations: conversations.map(({ record }) => structuredClone(record)),
        ...(includePlans ? {
          plans: plans.map(({
            conversationId,
            originalOld,
            original
          }) => ({
            conversationId,
            originalOld,
            original
          }))
        } : {})
      });
      if (!isPlainObject(next)) throw new Error("Routing upgrade transform must return metadata/conversation patches.");
      const changes = planChanges(plans, next.plans || []);
      if (transformPlanProgress) {
        for (const scope of [{ conversationId: "", root: sessionPaths.sessionRoot }, ...conversations.map(({ record, filePath }) => ({
          conversationId: record.conversationId,
          root: path.dirname(filePath)
        }))]) {
          const root = path.join(scope.root, "plans");
          const files = [];
          for (const entry of await inventory(root)) {
            if (entry.isDirectory()) {
              if (!["plan", "progress", "archive"].includes(entry.name)) {
                throw new Error("Unknown plan directory. Inspect it before upgrading.");
              }
              for (const child of await inventory(path.join(root, entry.name))) {
                if (!child.isFile() || !/^[a-f0-9]{64}\.(md|json)$/u.test(child.name)) {
                  throw new Error("Unknown saved plan document. Inspect it before upgrading.");
                }
                const filePath = path.join(root, entry.name, child.name);
                files.push({
                  name: entry.name + "/" + child.name,
                  text: await readRegularText(filePath),
                  archivedAt: (await lstat(filePath)).mtime.toISOString()
                });
              }
            } else {
              if (!entry.isFile() || !["current.md", "current.json"].includes(entry.name)) {
                throw new Error("Unknown current plan record. Inspect it before upgrading.");
              }
              files.push({ name: entry.name, text: await readRegularText(path.join(root, entry.name)) });
            }
          }
          for (const patch of transformPlanProgress(files)) {
            if (!isPlainObject(patch) || !/^(current\.(md|json)|(archive|plan|progress)\/[a-f0-9]{64}\.(md|json))$/u.test(patch.name) ||
                !(patch.text === null || typeof patch.text === "string")) {
              throw new Error(
                "Plan-progress upgrade attempted an unrelated write."
              );
            }
            const original = files.find(file => file.name === patch.name)?.text ?? null;
            if (original !== patch.text) changes.push({ filePath: path.join(root, patch.name), original, contents: patch.text });
          }
        }
      }
      for (const [name, value] of Object.entries(next.metadata || {})) {
        if (!["assistant_routing", "assistant_routing_request", "assistant_routing_goal"].includes(name) || typeof value !== "string") {
          throw new Error("Routing upgrade cannot change unrelated session metadata.");
        }
        if (value === metadata[name]) continue;
        const filePath = metadataFilePath(sessionPaths, name);
        changes.push({ filePath, original: await checkedPath(filePath) ? await readRegularText(filePath) : null, contents: `${value}\n` });
      }
      for (const record of next.conversations || []) {
        const previous = conversations.find((entry) => entry.record.conversationId === record.conversationId);
        if (!previous) throw new Error("Routing upgrade cannot create or replace an unknown temporary conversation.");
        if (JSON.stringify(previous.record) === JSON.stringify(record)) continue;
        changes.push({ filePath: previous.filePath, original: previous.original, contents: `${JSON.stringify(record)}\n` });
      }
      if (transformTurnMetadata) {
        const scopes = [
          sessionPaths,
          ...conversations.map(({ record }) => recordFiles.conversationPaths(sessionPaths, record.conversationId))
        ];
        for (const scope of scopes) {
          for (const entry of await inventory(scope.conversationLogRoot)) {
            if (!entry.isDirectory() || !CONVERSATION_TURN_ID_PATTERN.test(entry.name)) continue;
            const filePath = path.join(scope.conversationLogRoot, entry.name, CONVERSATION_TURN_METADATA_FILE);
            const original = await readRegularText(filePath);
            if (!original) continue;
            let record;
            try {
              record = JSON.parse(original);
            } catch {
              throw new Error(`Invalid conversation metadata: ${filePath}. Inspect it before upgrading routing.`);
            }
            if (!isPlainObject(record)) throw new Error(`Invalid conversation metadata: ${filePath}.`);
            const updated = transformTurnMetadata(record);
            if (JSON.stringify(updated) !== JSON.stringify(record)) {
              changes.push({ filePath, original, contents: `${JSON.stringify(updated)}\n` });
            }
          }
        }
      }
      if (transformHelperRecord) {
        const inspectHelpers = async root => {
          for (const entry of await inventory(root)) {
            const filePath = path.join(root, entry.name);
            if (entry.isDirectory()) {
              await inspectHelpers(filePath);
              continue;
            }
            if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
            const original = await readRegularText(filePath);
            const record = JSON.parse(original);
            const upgraded = transformHelperRecord(record);
            if (JSON.stringify(record) !== JSON.stringify(upgraded)) {
              changes.push({
                filePath,
                original,
                contents: `${JSON.stringify(upgraded)}\n`
              });
            }
          }
        };
        await inspectHelpers(sessionPaths.backgroundTasksRoot);
        await inspectHelpers(path.join(sessionPaths.artifactsRoot, "assistant"));
      }
      return changes;
    };
    return prepareSessionStateUpgrade({ temporaryRoot, inspectSession, transformRenewal: transform });
  }

  /**
   * Stage through the session/archive owner. The offline publisher owns backups.
   */
  async function prepareSessionStateUpgrade({ temporaryRoot, inspectSession, transformRenewal, transformArchiveRecord }) {
    const relativeScratch = path.relative(state.normalizedStateRoot, temporaryRoot || state.normalizedStateRoot);
    if (!path.isAbsolute(temporaryRoot || "") || typeof inspectSession !== "function" ||
        !(relativeScratch === ".." || relativeScratch.startsWith(`..${path.sep}`))) {
      throw new Error("Session upgrade requires an inspector and scratch directory outside project state.");
    }
    const checkedPath = async (filePath, directory = false) => {
      let info;
      try {
        info = await lstat(filePath);
      } catch (error) {
        if (isMissingPathError(error)) return false;
        throw error;
      }
      if (directory ? !info.isDirectory() : !info.isFile()) {
        throw new Error(`Session upgrade requires a regular ${directory ? "directory" : "file"}: ${filePath}`);
      }
      return true;
    };
    const inventory = async (root) => {
      if (!await checkedPath(root, true)) return [];
      const entries = await readDirectoryEntries(root);
      if (entries.some((entry) => entry.isSymbolicLink())) {
        throw new Error(`Session upgrade inventory contains a symbolic link: ${root}. Inspect it before upgrading.`);
      }
      return entries.sort((left, right) => left.name.localeCompare(right.name));
    };
    const readRegularText = async (filePath) => await checkedPath(filePath) ? readTextIfExists(filePath) : "";
    await checkedPath(temporaryRoot, true);
    const updates = [];
    const inspect = (sessionPaths, archiveRecord = null) => inspectSession(sessionPaths, {
      checkedPath,
      inventory,
      readRegularText,
      archiveRecord
    });
    const rootPaths = storePaths.paths();
    await checkedPath(state.normalizedStateRoot, true);
    await checkedPath(rootPaths.sessionsRoot, true);
    for (const root of [rootPaths.activeSessionsRoot, rootPaths.closingSessionsRoot]) {
      for (const name of sortedDirectoryNames(await inventory(root), isValidVibe64SessionId)) {
        updates.push(...await inspect(storePaths.pathsForSessionRoot(name, path.join(root, name))));
      }
    }
    const inspectArchives = async (root) => {
      for (const entry of await inventory(root)) {
        const filePath = path.join(root, entry.name);
        if (entry.isDirectory()) {
          await inspectArchives(filePath);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".tar.gz")) continue;
        const sessionId = assertValidVibe64SessionId(entry.name.slice(0, -".tar.gz".length));
        const metadataPath = filePath.slice(0, -".tar.gz".length) + ".json";
        const rawRecord = await readRegularText(metadataPath);
        if (!rawRecord) throw new Error(`Session archive ${sessionId} is incomplete. Finish archive recovery before upgrading.`);
        let parsed;
        try {
          parsed = JSON.parse(rawRecord);
        } catch {
          throw new Error(`Invalid session archive record: ${metadataPath}. Inspect it before upgrading sessions.`);
        }
        const record = archiveRecords.sessionArchiveRecordFromJson(parsed, { archivePath: filePath, metadataPath });
        if (record.sessionId !== sessionId) throw new Error(`Session archive identity does not match ${filePath}.`);
        await archiveRecords.validateSessionArchive(filePath);
        await archiveAccess.withExtractedSessionArchive(record, async (sessionPaths) => {
          const changes = await inspect(sessionPaths, record);
          const nextArchiveRecord = transformArchiveRecord ? await transformArchiveRecord({ record: parsed, sessionPaths }) : null;
          if (nextArchiveRecord) archiveRecords.sessionArchiveRecordFromJson(nextArchiveRecord, { archivePath: filePath, metadataPath });
          if (!changes.length) {
            if (nextArchiveRecord) {
              updates.push({
                filePath: metadataPath,
                original: rawRecord,
                contents: `${JSON.stringify(nextArchiveRecord, null, 2)}\n`
              });
            }
            return;
          }
          for (const change of changes) {
            if (change.contents === null) {
              await rm(change.filePath);
              continue;
            }
            await mkdir(path.dirname(change.filePath), { recursive: true, mode: 0o700 });
            await writeFile(change.filePath, change.contents, { mode: 0o600 });
          }
          const replacementPath = path.join(temporaryRoot, `${randomUUID()}.tar.gz`);
          const result = await runCommand("tar", ["-czf", replacementPath, "-C", path.dirname(sessionPaths.sessionRoot), "."], {
            allowedRoots: [temporaryRoot],
            cwd: state.normalizedProjectContextRoot,
            execution: ARCHIVE_EXECUTIONS.write
          });
          if (!result.ok) throw new Error(`Cannot stage upgraded archive for ${sessionId}.`);
          await archiveRecords.validateSessionArchive(replacementPath);
          updates.push({ filePath, replacementPath });
          if (nextArchiveRecord) {
            updates.push({
              filePath: metadataPath,
              original: rawRecord,
              contents: `${JSON.stringify(nextArchiveRecord, null, 2)}\n`
            });
          }
        }, { temporaryRoot });
      }
    };
    if (transformRenewal) {
      for (const entry of await inventory(storePaths.renewalStateRoot())) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const sessionId = assertValidVibe64SessionId(entry.name.slice(0, -".json".length));
        const filePath = storePaths.renewalStatePath(sessionId);
        const original = await readRegularText(filePath);
        let renewal;
        try {
          renewal = JSON.parse(original);
        } catch {
          throw new Error(`Invalid session renewal record: ${filePath}. Inspect it before upgrading sessions.`);
        }
        if (!isPlainObject(renewal) || renewal.sessionId !== sessionId) {
          throw new Error(`Session renewal identity does not match ${filePath}.`);
        }
        const next = await transformRenewal({ sessionId, metadata: {}, conversations: [], renewal: structuredClone(renewal) });
        if (next.renewal && JSON.stringify(next.renewal) !== JSON.stringify(renewal)) {
          updates.push({ filePath, original, contents: `${JSON.stringify(next.renewal)}\n` });
        }
      }
    }
    await inspectArchives(rootPaths.archivedSessionsRoot);
    return updates;
  }

  /**
   * Typed stopped-writer upgrade preparation; this never publishes files or
   * weakens the ordinary immutable binding writer. Training supplies the exact
   * saved learner/pin and maps only the original publisher's frozen after files.
   */
  async function prepareLearningSessionBindingUpgrade({
    temporaryRoot,
    sessionId,
    learningScope,
    preparedReplacements = []
  } = {}) {
    const scope = validateLearningSessionScope(learningScope);
    const id = assertValidVibe64SessionId(sessionId);
    if (!scope || id !== `training-${scope.attemptId}` || state.admittedLearningScope ||
        !Array.isArray(preparedReplacements) || preparedReplacements.some(value => !isPlainObject(value) ||
          Object.keys(value).length !== 2 || typeof value.filePath !== "string" || typeof value.replacementPath !== "string")) {
      throw new Error("Offline practice binding requires the exact saved initial source session and frozen file references.");
    }
    const binding = JSON.stringify({ schemaVersion: 1, ...scope, conversationId: id });
    const files = [];
    let found = false;
    let currentArchive = null;
    const validateMetadata = (metadata, options = {}) => {
      const { archived = false } = options;
      if (Object.hasOwn(metadata, LEARNING_SESSION_METADATA)) learningSessionBinding(metadata, scope, id);
      if (!explicitPathIsManagedSessionSource({ sessionId: id, metadata }, metadata.source_path)) {
        throw new Error(`Practice session ${id} has no valid original managed source descriptor. Inspect it before upgrading.`);
      }
      const archiveMarker = metadata.session_archive_operation;
      let completedArchive = false;
      if (archived && archiveMarker) {
        try {
          const operation = JSON.parse(archiveMarker);
          completedArchive = isPlainObject(operation) && operation.status === "running" && operation.phase === "source";
        } catch { /* Preserve malformed recovery evidence and refuse below. */ }
      }
      if (metadata.renewal_id || metadata.renewal_quiesced_id || archiveMarker && !completedArchive) {
        throw new Error(
          `Practice session ${id} retains a renewal or archive operation. Finish its original owner transaction before upgrading.`
        );
      }
    };
    // A persisted renewal record is not a proof that its native/source transaction
    // is complete. Keep this bounded initial-session cut fail closed.
    const renewal = storePaths.renewalStatePath(id);
    let renewalInfo;
    try {
      renewalInfo = await lstat(renewal);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    if (renewalInfo) {
      throw new Error(`Practice session ${id} retains renewal state. Finish or inspect its original transaction before upgrading.`);
    }
    const updates = await prepareSessionStateUpgrade({
      temporaryRoot,
      async inspectSession(sessionPaths, { checkedPath, inventory, archiveRecord }) {
        if (sessionPaths.sessionId !== id) return [];
        if (found) throw new Error(`Practice session ${id} has multiple state incarnations. Finish archive recovery before upgrading.`);
        found = true;
        await checkedPath(sessionPaths.sessionRoot, true);
        await checkedPath(sessionPaths.manifestPath);
        await recordFiles.readManifestFromPaths(sessionPaths);
        const status = assertVibe64SessionStatus(await recordFiles.readStatusFromPaths(sessionPaths));
        if (RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES.has(status)) throw new Error(`Practice session ${id} is in a renewal transition.`);
        for (const entry of await inventory(sessionPaths.metadataRoot)) {
          const info = await lstat(path.join(sessionPaths.metadataRoot, entry.name));
          if (!info.isFile() || info.nlink !== 1) throw new Error(`Practice session ${id} requires regular non-aliased metadata.`);
        }
        const metadata = await recordFiles.readUnboundMetadataFromPaths(sessionPaths);
        if (archiveRecord && status !== VIBE64_SESSION_STATUS.ARCHIVED) {
          throw new Error(`Practice archive ${id} has non-archived contents.`);
        }
        validateMetadata(metadata, { archived: Boolean(archiveRecord) });
        const filePath = metadataFilePath(sessionPaths, LEARNING_SESSION_METADATA);
        if (archiveRecord) {
          for (const filename of [archiveRecord.archivePath, archiveRecord.metadataPath]) {
            const info = await lstat(filename);
            if (!info.isFile() || info.nlink !== 1) throw new Error(`Practice archive ${id} requires a regular non-aliased pair.`);
          }
          currentArchive = archiveRecord;
          files.push({
            filePath: archiveRecord.archivePath,
            kind: "archive"
          }, {
            filePath: archiveRecord.metadataPath,
            kind: "archive-metadata"
          });
          const indexed = archiveRecord.index.metadata?.[LEARNING_SESSION_METADATA];
          if (indexed !== undefined) learningSessionBinding({ learning_session: indexed }, scope, id);
          if (Boolean(indexed) !== Object.hasOwn(metadata, LEARNING_SESSION_METADATA) && !preparedReplacements.length) {
            throw new Error(
              `Practice archive ${id} has inconsistent binding and index. Inspect its original transaction before upgrading.`
            );
          }
        } else {
          files.push({ filePath, kind: "metadata" });
        }
        if (Object.hasOwn(metadata, LEARNING_SESSION_METADATA)) return [];
        return [{ filePath, original: null, contents: `${binding}\n` }];
      },
      transformArchiveRecord({ record, sessionPaths }) {
        if (sessionPaths.sessionId !== id || record.index.metadata?.[LEARNING_SESSION_METADATA] !== undefined) return null;
        return { ...record, index: { ...record.index, metadata: { ...record.index.metadata, [LEARNING_SESSION_METADATA]: binding } } };
      }
    });
    if (!found && preparedReplacements.length) {
      throw new Error(
        `Practice session ${id} has no original state for its frozen replacement. Restore or inspect the original owner before retrying.`
      );
    }
    const replacements = new Map();
    for (const replacement of preparedReplacements) {
      if (!path.isAbsolute(replacement.replacementPath) || replacements.has(replacement.filePath) ||
          !files.some(value => value.filePath === replacement.filePath)) {
        throw new Error(`Practice session ${id} has an unrelated or duplicate frozen replacement. Inspect its upgrade backup.`);
      }
      replacements.set(replacement.filePath, replacement.replacementPath);
    }
    const readFrozen = async filename => {
      const info = await lstat(filename);
      if (!info.isFile() || info.nlink !== 1) throw new Error(`Practice session ${id} requires regular frozen upgrade files.`);
      return readFile(filename, "utf8");
    };
    if (preparedReplacements.length) {
      if (!found || replacements.size !== files.length) throw new Error(`Practice session ${id} has an incomplete frozen replacement set.`);
      if (!currentArchive) {
        learningSessionBinding({ learning_session: toText(await readFrozen(replacements.get(files[0].filePath))) }, scope, id);
      } else {
        const archivePath = replacements.get(currentArchive.archivePath);
        const metadataPath = replacements.get(currentArchive.metadataPath);
        let value;
        try {
          value = JSON.parse(await readFrozen(metadataPath));
        } catch (cause) {
          throw new Error(`Frozen practice archive ${id} has invalid metadata. Inspect its original backup.`, { cause });
        }
        const record = archiveRecords.sessionArchiveRecordFromJson(value, { archivePath, metadataPath });
        if (record.sessionId !== id) throw new Error(`Frozen practice archive ${id} has a different session identity.`);
        learningSessionBinding({ learning_session: record.index.metadata?.[LEARNING_SESSION_METADATA] }, scope, id);
        const info = await lstat(archivePath);
        if (!info.isFile() || info.nlink !== 1) throw new Error(`Frozen practice archive ${id} is not a regular file.`);
        await archiveRecords.validateSessionArchive(archivePath);
        await archiveAccess.withExtractedSessionArchive(record, async sessionPaths => {
          const root = await lstat(sessionPaths.metadataRoot);
          if (!root.isDirectory()) throw new Error(`Frozen practice archive ${id} has an unsafe metadata root.`);
          const entries = await readdir(sessionPaths.metadataRoot, { withFileTypes: true });
          for (const entry of entries) {
            const entryInfo = await lstat(path.join(sessionPaths.metadataRoot, entry.name));
            if (!entryInfo.isFile() || entryInfo.nlink !== 1) throw new Error(`Frozen practice archive ${id} has unsafe metadata paths.`);
          }
          const metadata = await recordFiles.readUnboundMetadataFromPaths(sessionPaths);
          learningSessionBinding(metadata, scope, id);
          if (assertVibe64SessionStatus(await recordFiles.readStatusFromPaths(sessionPaths)) !== VIBE64_SESSION_STATUS.ARCHIVED) {
            throw new Error(`Frozen practice archive ${id} has non-archived contents.`);
          }
          validateMetadata(metadata, { archived: true });
        }, { temporaryRoot });
      }
    }
    return { found, files, updates };
  }

  /**
   * Offline message-data repair uses the same active/closing/archive inventory.
   * The feature owner supplies proven data only; content and receipts stay here.
   */
  async function prepareConversationMessageDataUpgrade({ temporaryRoot, transform }) {
    if (typeof transform !== "function") throw new Error("Conversation data upgrade requires a transform.");
    return prepareSessionStateUpgrade({
      temporaryRoot,
      async inspectSession(sessionPaths, { checkedPath, inventory, readRegularText }) {
        await checkedPath(sessionPaths.sessionRoot, true);
        await checkedPath(sessionPaths.manifestPath);
        await recordFiles.readManifestFromPaths(sessionPaths);
        await inventory(sessionPaths.metadataRoot);
        const metadata = await recordFiles.readMetadataFromPaths(sessionPaths);
        const scopes = [{ paths: sessionPaths, conversation: null }];
        for (const entry of await inventory(sessionPaths.conversationsRoot)) {
          if (!entry.isDirectory()) continue;
          const paths = recordFiles.conversationPaths(sessionPaths, entry.name);
          const source = await readRegularText(path.join(paths.conversationRoot, "conversation.json"));
          const conversation = source ? JSON.parse(source) : null;
          if (!isPlainObject(conversation) || conversation.conversationId !== entry.name) {
            throw new Error(`Invalid temporary conversation ${entry.name}. Inspect it before upgrading message data.`);
          }
          scopes.push({ paths, conversation });
        }
        const changes = [];
        for (const scope of scopes) {
          await inventory(scope.paths.conversationLogRoot);
          const filePath = path.join(scope.paths.conversationLogRoot, "transcript.json");
          if (!await checkedPath(filePath)) continue;
          const original = await readRegularText(filePath);
          conversationStore.parseConversationRecord(original);
          const document = JSON.parse(original);
          const messages = document.turns.flatMap(([, turn]) => turn.messages);
          const patches = await transform({
            sessionId: sessionPaths.sessionId,
            metadata: { ...metadata },
            conversation: structuredClone(scope.conversation),
            messages: structuredClone(messages)
          });
          if (applyMessageDataPatches(messages, patches)) {
            const contents = `${JSON.stringify(document, null, 2)}\n`;
            conversationStore.parseConversationRecord(contents);
            changes.push({ filePath, original, contents });
          }
        }
        return changes;
      }
    });
  }

  async function prepareConversationStorageUpgrade({ temporaryRoot }) {
    return prepareSessionStateUpgrade({
      temporaryRoot,
      async inspectSession(sessionPaths, { checkedPath, inventory, readRegularText }) {
        await checkedPath(sessionPaths.sessionRoot, true);
        await checkedPath(sessionPaths.manifestPath);
        await recordFiles.readManifestFromPaths(sessionPaths);
        const changes = [];
        const scopes = [sessionPaths];
        for (const entry of await inventory(sessionPaths.conversationsRoot)) {
          if (!entry.isDirectory()) continue;
          scopes.push(recordFiles.conversationPaths(sessionPaths, entry.name));
        }
        for (const scope of scopes) {
          const entries = await inventory(scope.conversationLogRoot);
          const filePath = path.join(scope.conversationLogRoot, "transcript.json");
          const original = await checkedPath(filePath) ? await readRegularText(filePath) : null;
          const legacy = [];
          const turns = new Map();
          for (const entry of entries) {
            if (!entry.isDirectory() || !CONVERSATION_TURN_ID_PATTERN.test(entry.name)) continue;
            const turnRoot = conversationTurnRoot(scope, entry.name);
            for (const file of await inventory(turnRoot)) {
              if (!CONVERSATION_MESSAGE_FILE_PATTERN.test(file.name) &&
                ![CONVERSATION_TURN_ATTACHMENTS_FILE, CONVERSATION_TURN_METADATA_FILE].includes(file.name)) continue;
              const sourcePath = path.join(turnRoot, file.name);
              const contents = await readRegularText(sourcePath);
              legacy.push({ filePath: sourcePath, original: contents, contents: null });
            }
            turns.set(entry.name, await conversationStore.readConversationTurnDirectory(scope, entry.name));
          }
          let rewound = [];
          for (const name of ["rewound.json", "message-ids.json"]) {
            const sourcePath = path.join(scope.conversationLogRoot, name);
            if (!await checkedPath(sourcePath)) continue;
            const contents = await readRegularText(sourcePath);
            if (name === "rewound.json") rewound = JSON.parse(contents);
            legacy.push({ filePath: sourcePath, original: contents, contents: null });
          }
          if (original !== null) {
            conversationStore.parseConversationRecord(original);
            if (legacy.length) {
              throw new Error(`Conversation has both current and legacy records: ${filePath}. Inspect the upgrade backup before retrying.`);
            }
          } else if (legacy.length || turns.size) {
            const contents = `${JSON.stringify(conversationStore.conversationRecordJson({ turns, metadata: {}, rewound }), null, 2)}\n`;
            conversationStore.parseConversationRecord(contents);
            // Publish the complete record first. Retry follows the prepared manifest
            // and retires old files only after all original bytes are backed up.
            changes.push({ filePath, original: null, contents }, ...legacy);
          }
        }
        return changes;
      }
    });
  }

  return Object.freeze({
    prepareAssistantRoutingStateUpgrade,
    prepareConversationMessageDataUpgrade,
    prepareConversationStorageUpgrade,
    prepareLearningSessionBindingUpgrade
  });
}

export {
  createSessionStateUpgrades
};
