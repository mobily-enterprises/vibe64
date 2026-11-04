// Stopped-writer removal of whole temporary conversations from a project's session state.

import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { isMissingPathError, isPlainObject } from "@local/vibe64-core/server/core";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { isValidVibe64SessionId } from "./sessionRecordRules.js";
import { metadataFilePath, readDirectoryEntries, sortedDirectoryNames } from "./sessionStoreLayout.js";

/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */
/** @typedef {import("./types.js").SessionRecordFiles} SessionRecordFiles */
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
 * @param {PrepareSessionStateUpgrade} dependencies.prepareSessionStateUpgrade the session inventory the other upgrades use
 */
function createSessionTemporaryConversationRemoval({ storePaths, recordFiles, prepareSessionStateUpgrade }) {
  /**
   * Stopped-writer removal of whole temporary conversations, as Close removes one: the record's
   * folder, the session attachments it owns and the session metadata its owner names. Live (active
   * and closing) sessions and prepared renewal archives are visited; other archived sessions never are.
   * `select({ sessionId, metadata, archived, conversations })` sees every record with the attachment
   * ids it owns and returns `{ conversationId, metadataNames }` for each one to remove. Its record
   * file is removed last, after everything it owns.
   * @param {object} options
   * @param {string} options.temporaryRoot
   * @param {Function} options.select
   */
  async function prepareTemporaryConversationRemoval({ temporaryRoot, select }) {
    if (typeof select !== "function") throw new Error("Temporary conversation removal requires a selection.");
    const removedFolders = new Map();
    return prepareSessionStateUpgrade({
      temporaryRoot,
      preparedRenewalsOnly: true,
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
          const conversation = parsedRecord(original, filePath, "temporary conversation");
          if (conversation.conversationId !== entry.name) throw new Error(`Temporary conversation identity does not match ${filePath}.`);
          conversations.push({ paths, filePath, original, conversation, attachmentIds: owned.get(entry.name) || [] });
        }
        const chosen = await select({
          sessionId: sessionPaths.sessionId,
          metadata: { ...metadata },
          archived: Boolean(archiveRecord),
          conversations: conversations.map(({ conversation, attachmentIds }) => ({
            conversation: structuredClone(conversation),
            attachmentIds: [...attachmentIds]
          }))
        });
        if (!Array.isArray(chosen)) throw new Error("Temporary conversation removal must return the conversations to remove.");
        const changes = [];
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
    removeEmptyConversationFolders
  });
}

export {
  createSessionTemporaryConversationRemoval
};
