// Managed execution receipts: the command a runner reads, and the result it leaves, in the workspace's or the
// applications' runtime directory.

import {
  chmodSync,
  closeSync,
  fchmodSync,
  fchownSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import process from "node:process";

import { managedExecutionRuntimeBase } from "./commandEnvironment.js";
import { managedExecutionId } from "./executionIdentity.js";
import { safeUsername, workspaceFromDaemonUsername } from "./hostAccounts.js";
import {
  DIRECTORY_NO_FOLLOW,
  makeDirectory,
  NEW_FILE_NO_FOLLOW,
  openedPath,
  readOwnedFile
} from "./hostFiles.js";

const MANAGED_EXECUTION_RESULT_LIMIT_BYTES = 64 * 1024;
const APPLICATION_RECEIPTS_ROOT = "/run/vibe64-applications";

// A workspace's application executions keep their receipts in root's own
// runtime directory, which their accounts only traverse: they are in no group
// that reaches the daemon's runtime directory. Only root writes in /run, so
// root makes that directory itself, with no process.
function openApplicationExecutionReceipts(owner = {}, { create = false } = {}) {
  if (create) {
    makeDirectory(APPLICATION_RECEIPTS_ROOT);
    chmodSync(APPLICATION_RECEIPTS_ROOT, 0o711);
  }
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  return openManagedExecutionReceipts(path.join(APPLICATION_RECEIPTS_ROOT, workspace), { create, mode: 0o711 });
}

// Every receipt of a workspace: its daemon's and people's, and its applications'.
function openAllExecutionReceipts(owner = {}) {
  const workspace = openWorkspaceExecutionReceipts(owner);
  let applications;
  try {
    applications = openApplicationExecutionReceipts(owner);
  } catch (error) {
    workspace.close();
    throw error;
  }
  const both = [workspace, applications];
  return {
    close: () => both.forEach((receipts) => receipts.close()),
    entries: () => both.flatMap((receipts) => receipts.entries()),
    remove: (executionId) => both.forEach((receipts) => receipts.remove(executionId)),
    result: (executionId) => both.map((receipts) => receipts.result(executionId)).find((result) => result.executionId) || {}
  };
}

// The workspace's execution receipts in its daemon's runtime directory. Only
// creating one makes the directories, with the shared group's id its caller
// read; stopping and releasing find none there when there is none.
function openWorkspaceExecutionReceipts(owner = {}, { create = false, gid = null } = {}) {
  const runtimeBase = managedExecutionRuntimeBase(owner);
  if (create) {
    ensureWorkspaceRuntimeBase(runtimeBase, { gid, uid: owner.uid });
  }
  return openManagedExecutionReceipts(path.join(runtimeBase, "executions"), {
    create,
    gid: create ? gid : 0,
    legacyUid: owner.uid,
    uid: 0
  });
}

// The daemon's runtime directory sits in root's own /run, so its path is never
// a link the daemon planted; root still opens it without following one. Root
// makes it, or keeps it, the daemon's with the shared group and mode 2750, as
// `install -d` did, with no process.
function ensureWorkspaceRuntimeBase(runtimeBase = "", { gid = null, uid = null } = {}) {
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) {
    throw new Error("Vibe64 exec helper needs the daemon's uid and the shared group's gid.");
  }
  makeDirectory(runtimeBase, 0o750);
  const descriptor = openSync(runtimeBase, DIRECTORY_NO_FOLLOW);
  try {
    const stats = fstatSync(descriptor);
    if (stats.uid !== uid || stats.gid !== gid) fchownSync(descriptor, uid, gid);
    if ((stats.mode & 0o7777) !== 0o2750) fchmodSync(descriptor, 0o2750);
  } finally {
    closeSync(descriptor);
  }
}

const NO_EXECUTION_RECEIPTS = Object.freeze({
  close() {},
  create() { throw new Error("Vibe64 exec helper has no execution receipt directory."); },
  entries: () => [],
  remove() {},
  result: () => ({})
});
// What its target user can leave in a receipt instead of the runner's result.
const UNREADABLE_RESULT_CODES = new Set(["ENOENT", "ELOOP", "ENOTDIR", "ENXIO", "EVIBE64UNSAFEFILE"]);

// Root keeps a workspace's execution receipts in a directory of its own
// (uid:gid, mode 0750: the target users of its executions only traverse it), so
// only root adds, renames or removes receipts there. That directory sits in the
// daemon's runtime directory, which the daemon can rearrange, so root opens it
// without following a link and from then on works only through the open
// directory: replacing its path afterwards changes nothing root does. A receipt
// is created only where nothing exists yet, and every write and ownership change
// goes through a descriptor root opened itself, never through a link. Older
// helpers left this directory to the daemon (legacyUid); creating a receipt
// takes it back.
function openManagedExecutionReceipts(directory = "", {
  create = false,
  gid = 0,
  legacyUid = 0,
  mode = 0o750,
  uid = 0
} = {}) {
  if (create) {
    makeDirectory(directory, mode);
  }
  let descriptor;
  try {
    descriptor = openSync(directory, DIRECTORY_NO_FOLLOW);
  } catch (error) {
    if (!create && error?.code === "ENOENT") return NO_EXECUTION_RECEIPTS;
    throw error;
  }
  try {
    const owned = fstatSync(descriptor).uid;
    if (owned !== uid && owned !== legacyUid) {
      throw new Error("Vibe64 exec helper refused an execution receipt directory owned by another user.");
    }
    if (create) {
      fchownSync(descriptor, uid, gid);
      fchmodSync(descriptor, mode);
    }
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
  return {
    close: () => closeSync(descriptor),
    entries: () => readdirSync(openedPath(descriptor)),
    // Node 26's rmSync (the C++ runtime's std::filesystem::remove_all) walks
    // the receipt with openat and unlinkat relative to directories it opened
    // with O_NOFOLLOW, so a link its target user swaps in meanwhile is removed,
    // never followed.
    remove: (executionId) => rmSync(openedPath(descriptor, managedExecutionId(executionId)), { force: true, recursive: true }),
    // The runner's result, from a receipt its target user owns: only that
    // user's regular file there, never through a link, and none otherwise.
    result(executionId = "") {
      const id = managedExecutionId(executionId);
      let receipt = -1;
      try {
        receipt = openSync(openedPath(descriptor, id), DIRECTORY_NO_FOLLOW);
        const result = JSON.parse(readOwnedFile(receipt, "result.json", {
          maxBytes: MANAGED_EXECUTION_RESULT_LIMIT_BYTES,
          uid: fstatSync(receipt).uid
        }));
        return result?.schema === "vibe64.managed-execution.result" && result.schemaVersion === 1 &&
          result.executionId === id ? result : {};
      } catch (error) {
        if (error instanceof SyntaxError || UNREADABLE_RESULT_CODES.has(error?.code)) return {};
        throw error;
      } finally {
        if (receipt >= 0) closeSync(receipt);
      }
    },
    // The receipt and the runner's command in it, handed to the target user;
    // returns the receipt's path. A service (privateDirectory) also gets a
    // private directory in its receipt, named to it as
    // VIBE64_EXECUTION_PRIVATE_DIR: whatever removes the receipt (Stop,
    // release-ended, a failed start) removes the state it keeps there, without
    // knowing what that state is.
    create(executionId = "", targetUser = {}, runnerCommand = {}, { privateDirectory = false } = {}) {
      const id = managedExecutionId(executionId);
      const receiptPath = openedPath(descriptor, id);
      mkdirSync(receiptPath, { mode: 0o700 });
      const receipt = openSync(receiptPath, DIRECTORY_NO_FOLLOW);
      try {
        const env = { ...runnerCommand.env };
        if (privateDirectory) {
          mkdirSync(openedPath(receipt, "private"), { mode: 0o700 });
          const directoryDescriptor = openSync(openedPath(receipt, "private"), DIRECTORY_NO_FOLLOW);
          try {
            fchownSync(directoryDescriptor, targetUser.uid, targetUser.gid);
          } finally {
            closeSync(directoryDescriptor);
          }
          env.VIBE64_EXECUTION_PRIVATE_DIR = path.join(directory, id, "private");
        }
        const command = openSync(openedPath(receipt, "command.json"), NEW_FILE_NO_FOLLOW, 0o600);
        try {
          writeFileSync(command, `${JSON.stringify({
            ...runnerCommand,
            env,
            schema: "vibe64.managed-execution.command",
            schemaVersion: 1
          })}\n`);
          fchmodSync(command, 0o600);
          fchownSync(command, targetUser.uid, targetUser.gid);
        } finally {
          closeSync(command);
        }
        fchownSync(receipt, targetUser.uid, targetUser.gid);
      } finally {
        closeSync(receipt);
      }
      return path.join(directory, id);
    }
  };
}

function readManagedExecutionResult(owner = {}, executionId = "") {
  const receipts = openAllExecutionReceipts(owner);
  try {
    return receipts.result(executionId);
  } finally {
    receipts.close();
  }
}

function writeManagedExecutionResult(executionRoot = "", result = {}) {
  const resultPath = path.join(executionRoot, "result.json");
  const temporaryPath = `${resultPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify({
    ...result,
    schema: "vibe64.managed-execution.result",
    schemaVersion: 1
  })}\n`, {
    flag: "wx",
    mode: 0o600
  });
  renameSync(temporaryPath, resultPath);
}

export {
  ensureWorkspaceRuntimeBase,
  openAllExecutionReceipts,
  openApplicationExecutionReceipts,
  openManagedExecutionReceipts,
  openWorkspaceExecutionReceipts,
  readManagedExecutionResult,
  writeManagedExecutionResult
};
