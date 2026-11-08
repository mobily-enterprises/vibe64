// Stopped-writer removal of whole temporary conversations from a project's session state.

import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { isMissingPathError, isPlainObject } from "@local/vibe64-core/server/core";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { assertValidVibe64SessionId, isValidVibe64SessionId } from "./sessionRecordRules.js";
import {
  metadataFilePath,
  readDirectoryEntries,
  readTextIfExists,
  renewalArchiveStagingRoot,
  sortedDirectoryNames
} from "./sessionStoreLayout.js";

/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */
/** @typedef {import("./types.js").SessionRecordFiles} SessionRecordFiles */
/** @typedef {import("./types.js").SessionArchiveRecords} SessionArchiveRecords */
/** @typedef {import("./types.js").SessionArchiveAccess} SessionArchiveAccess */
/** @typedef {ReturnType<typeof import("./sessionStateUpgrades.js").createSessionStateUpgrades>["prepareSessionStateUpgrade"]} PrepareSessionStateUpgrade */

/**
 * Whether a folder holds a file (or anything but a folder) at any depth.
 * @param {string} directory
 */
async function holdsFiles(directory) {
  for (const entry of await readDirectoryEntries(directory)) {
    if (!entry.isDirectory() || await holdsFiles(path.join(directory, entry.name))) return true;
  }
  return false;
}

/**
 * Removes a folder only when it holds no file at any depth.
 * @param {string} directory
 * @returns {Promise<boolean>} whether it was removed
 */
async function removeEmptyTree(directory) {
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
  if (!info.isDirectory() || await holdsFiles(directory)) return false;
  await rm(directory, { recursive: true });
  return true;
}

/**
 * Every regular file below a folder, for removal through the backed-up publisher.
 * @param {string} root
 * @param {(root: string) => Promise<import("node:fs").Dirent[]>} inventory refuses a symbolic link
 */
async function filesBelow(root, inventory) {
  const files = [];
  for (const entry of await inventory(root)) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(filePath, inventory));
    else if (entry.isFile()) files.push(filePath);
    else throw new Error(`Session upgrade requires regular files: ${filePath}. Inspect it before upgrading.`);
  }
  return files;
}

/** The temporary conversation record a folder holds, refused unless its identity is the folder's. */
function conversationRecord(source, filePath, folderName) {
  const conversation = parsedRecord(source, filePath, "temporary conversation");
  if (conversation.conversationId !== folderName) throw new Error(`Temporary conversation identity does not match ${filePath}.`);
  return conversation;
}

function parsedRecord(source, filePath, label) {
  let record;
  try {
    record = JSON.parse(source);
  } catch {
    throw new Error(`Invalid ${label} record: ${filePath}. Inspect it before upgrading.`);
  }
  if (!isPlainObject(record)) throw new Error(`Invalid ${label} record: ${filePath}. Inspect it before upgrading.`);
  return record;
}

/**
 * @param {object} dependencies
 * @param {SessionStorePaths} dependencies.storePaths
 * @param {SessionRecordFiles} dependencies.recordFiles
 * @param {SessionArchiveRecords} dependencies.archiveRecords
 * @param {SessionArchiveAccess} dependencies.archiveAccess
 * @param {PrepareSessionStateUpgrade} dependencies.prepareSessionStateUpgrade the session inventory the other upgrades use
 */
function createSessionTemporaryConversationRemoval({ storePaths, recordFiles, archiveRecords, archiveAccess, prepareSessionStateUpgrade }) {
  /**
   * Stopped-writer removal of whole temporary conversations, as Close removes one: the record's
   * folder, the session attachments it owns and the session metadata its owner names. Live (active
   * and closing) sessions and prepared renewal archives are visited, and with `allArchives` every
   * published archive too. `select({ sessionId, metadata, archived, prepared, conversations })` sees
   * every record with the attachment ids it owns (`prepared` marks a renewal's prepared archive) and
   * returns `{ conversationId, metadataNames }` for each one to remove, or `{ remove, metadata }`
   * whose `metadata` also sets session metadata values. A removed record file goes last, after
   * everything it owns. A choice that also carries `record` leaves its conversation to Close instead:
   * only the record file is rewritten, as that record, and the transcript and attachments stay for
   * Close to remove; the metadata it names still goes.
   * @param {object} options
   * @param {string} options.temporaryRoot
   * @param {Function} options.select
   * @param {boolean} [options.allArchives]
   */
  async function prepareTemporaryConversationRemoval({ temporaryRoot, select, allArchives = false }) {
    if (typeof select !== "function") throw new Error("Temporary conversation removal requires a selection.");
    const removedFolders = new Map();
    const preparedRoot = renewalArchiveStagingRoot(storePaths.paths());
    return prepareSessionStateUpgrade({
      temporaryRoot,
      preparedRenewalsOnly: !allArchives,
      async inspectSession(sessionPaths, { checkedPath, inventory, readRegularText, archiveRecord }) {
        await checkedPath(sessionPaths.sessionRoot, true);
        await checkedPath(sessionPaths.manifestPath);
        await recordFiles.readManifestFromPaths(sessionPaths);
        await inventory(sessionPaths.metadataRoot);
        const metadata = await recordFiles.readMetadataFromPaths(sessionPaths);
        const attachmentsRoot = path.join(sessionPaths.artifactsRoot, "attachments");
        const owned = new Map();
        for (const entry of await inventory(attachmentsRoot)) {
          // A folder still being prepared has a dot in its name and belongs to no conversation yet.
          if (!entry.isDirectory() || entry.name.includes(".")) continue;
          const filePath = path.join(attachmentsRoot, entry.name, "attachment.json");
          const source = await readRegularText(filePath);
          if (!source) continue;
          const owner = toText(parsedRecord(source, filePath, "attachment").conversationId);
          if (owner) owned.set(owner, [...owned.get(owner) || [], entry.name]);
        }
        const conversations = [];
        for (const entry of await inventory(sessionPaths.conversationsRoot)) {
          if (!entry.isDirectory()) continue;
          const paths = recordFiles.conversationPaths(sessionPaths, entry.name);
          const filePath = path.join(paths.conversationRoot, "conversation.json");
          const original = await readRegularText(filePath);
          if (!original) continue;
          const conversation = conversationRecord(original, filePath, entry.name);
          conversations.push({ paths, filePath, original, conversation, attachmentIds: owned.get(entry.name) || [] });
        }
        const selected = await select({
          sessionId: sessionPaths.sessionId,
          metadata: { ...metadata },
          archived: Boolean(archiveRecord),
          prepared: Boolean(archiveRecord) && !path.relative(preparedRoot, archiveRecord.archivePath).startsWith(".."),
          conversations: conversations.map(({ conversation, attachmentIds }) => ({
            conversation: structuredClone(conversation),
            attachmentIds: [...attachmentIds]
          }))
        });
        const { remove: chosen, metadata: values = {} } = Array.isArray(selected) ? { remove: selected } : selected || {};
        if (!Array.isArray(chosen) || !isPlainObject(values)) {
          throw new Error("Temporary conversation removal must return the conversations to remove.");
        }
        const changes = [];
        for (const [name, value] of Object.entries(values)) {
          if (typeof value !== "string") throw new Error("Temporary conversation removal sets only text metadata values.");
          if (value === metadata[name]) continue;
          const filePath = metadataFilePath(sessionPaths, name);
          changes.push({ filePath, original: await checkedPath(filePath) ? await readRegularText(filePath) : null, contents: `${value}\n` });
        }
        const folders = [];
        const removed = new Set();
        for (const choice of chosen) {
          const target = conversations.find(({ conversation }) => conversation.conversationId === choice?.conversationId);
          if (!target || removed.has(target.conversation.conversationId) || !Array.isArray(choice.metadataNames)) {
            throw new Error("Temporary conversation removal chose an unknown or repeated conversation.");
          }
          removed.add(target.conversation.conversationId);
          for (const name of choice.metadataNames) {
            const filePath = metadataFilePath(sessionPaths, name);
            if (await checkedPath(filePath)) changes.push({ filePath, original: await readRegularText(filePath), contents: null });
          }
          if (Object.hasOwn(choice, "record")) {
            if (!isPlainObject(choice.record) || choice.record.conversationId !== target.conversation.conversationId) {
              throw new Error("A temporary conversation left to Close must keep its own record identity.");
            }
            changes.push({ filePath: target.filePath, original: target.original, contents: `${JSON.stringify(choice.record, null, 2)}\n` });
            continue;
          }
          // Attachment files are bytes, so the publisher's own digests stand for their originals.
          for (const id of target.attachmentIds) {
            const folder = path.join(attachmentsRoot, id);
            for (const filePath of await filesBelow(folder, inventory)) changes.push({ filePath, contents: null });
            folders.push(folder);
          }
          for (const filePath of await filesBelow(target.paths.conversationRoot, inventory)) {
            if (filePath !== target.filePath) changes.push({ filePath, contents: null });
          }
          changes.push({ filePath: target.filePath, original: target.original, contents: null });
          folders.push(target.paths.conversationRoot);
        }
        removedFolders.set(sessionPaths.sessionRoot, folders);
        return changes;
      },
      // An archive is packed again without the folders its removed conversations emptied.
      async finishArchive(sessionPaths) {
        for (const folder of removedFolders.get(sessionPaths.sessionRoot) || []) await removeEmptyTree(folder);
      }
    });
  }

  /**
   * The session id, metadata and temporary conversation records of a copy of a session archive, such
   * as an earlier upgrade's before copy, read from a validated extraction below `temporaryRoot`.
   * @param {object} options
   * @param {string} options.archivePath the copy, named `<sessionId>.tar.gz`
   * @param {string} options.temporaryRoot
   */
  async function readArchivedConversations({ archivePath, temporaryRoot }) {
    if (!path.isAbsolute(archivePath || "") || !archivePath.endsWith(".tar.gz") || !path.isAbsolute(temporaryRoot || "")) {
      throw new Error("Reading an archive copy requires its absolute path and a scratch directory.");
    }
    const sessionId = assertValidVibe64SessionId(path.basename(archivePath, ".tar.gz"));
    await archiveRecords.validateSessionArchive(archivePath);
    return archiveAccess.withExtractedSessionArchive({ sessionId, archivePath }, async (sessionPaths) => {
      const conversations = [];
      for (const entry of await readDirectoryEntries(sessionPaths.conversationsRoot)) {
        if (!entry.isDirectory()) continue;
        const filePath = path.join(recordFiles.conversationPaths(sessionPaths, entry.name).conversationRoot, "conversation.json");
        const info = await lstat(filePath).catch((error) => {
          if (isMissingPathError(error)) return null;
          throw error;
        });
        if (!info) continue;
        if (!info.isFile()) throw new Error(`Session upgrade requires a regular file: ${filePath}`);
        conversations.push(conversationRecord(await readTextIfExists(filePath), filePath, entry.name));
      }
      return { sessionId, metadata: await recordFiles.readMetadataFromPaths(sessionPaths), conversations };
    }, { temporaryRoot });
  }

  /**
   * After a stopped-writer removal is published, the conversation and attachment folders it emptied
   * leave live sessions. Only folders that hold no file at any depth are removed.
   * @returns {Promise<number>} how many folders were removed
   */
  async function removeEmptyConversationFolders() {
    const rootPaths = storePaths.paths();
    let removed = 0;
    for (const root of [rootPaths.activeSessionsRoot, rootPaths.closingSessionsRoot]) {
      for (const name of sortedDirectoryNames(await readDirectoryEntries(root), isValidVibe64SessionId)) {
        const sessionPaths = storePaths.pathsForSessionRoot(name, path.join(root, name));
        for (const parent of [sessionPaths.conversationsRoot, path.join(sessionPaths.artifactsRoot, "attachments")]) {
          for (const entry of await readDirectoryEntries(parent)) {
            if (entry.isDirectory() && !entry.name.includes(".") && await removeEmptyTree(path.join(parent, entry.name))) removed += 1;
          }
        }
      }
    }
    return removed;
  }

  return Object.freeze({
    prepareTemporaryConversationRemoval,
    readArchivedConversations,
    removeEmptyConversationFolders
  });
}

export {
  createSessionTemporaryConversationRemoval
};
