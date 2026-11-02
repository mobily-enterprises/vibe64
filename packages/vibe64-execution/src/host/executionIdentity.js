// A managed execution's identity and limits: its id, kind, mode, unit and slice names, numeric limits, and
// the account it runs as.



import { registeredApplicationUser } from "./applicationAccounts.js";
import {
  assertExpectedId,
  assertUserInGroup,
  resolveOsUser,
  safeUsername,
  VIBE64_GROUP,
  workspaceFromDaemonUsername
} from "./hostAccounts.js";
import { assertActablePerson } from "./personRegistry.js";

const MANAGED_EXECUTION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const MANAGED_EXECUTION_KINDS = new Set([
  "assistant",
  "browser",
  "control",
  "job",
  "preview",
  "service",
  "terminal"
]);
const MANAGED_EXECUTION_MODES = new Set([
  "capture",
  "detached",
  "pty"
]);
const MANAGED_EXECUTION_MEMORY_MIN_BYTES = 64 * 1024 * 1024;
const MANAGED_EXECUTION_MEMORY_MAX_BYTES = 1024 * 1024 * 1024 * 1024;
const MANAGED_EXECUTION_WORK_MEMORY_MIN_BYTES = 256 * 1024 * 1024;
const MANAGED_EXECUTION_WORK_MEMORY_MAX_BYTES = 1024 * 1024 * 1024 * 1024;
const MANAGED_EXECUTION_TASKS_MIN = 8;
const MANAGED_EXECUTION_TASKS_MAX = 8192;

function managedExecutionTargetUser(payload = {}, owner = {}, {
  assertInGroup = assertUserInGroup,
  resolveUser = resolveOsUser
} = {}) {
  if (payload.applicationAccount === true) {
    const application = registeredApplicationUser(owner, payload.username);
    assertExpectedId("uid", payload.uid, application.uid);
    assertExpectedId("gid", payload.gid, application.gid);
    return application;
  }
  const username = safeUsername(payload.username || owner.username);
  // The daemon was resolved by this process moments ago; most executions run as it.
  const targetUser = username === owner.username ? owner : resolveUser(username);
  assertExpectedId("uid", payload.uid, targetUser.uid);
  assertExpectedId("gid", payload.gid, targetUser.gid);
  if (targetUser.username !== owner.username) {
    assertActablePerson(owner, targetUser);
  } else {
    assertInGroup(targetUser.username, VIBE64_GROUP);
  }
  return targetUser;
}

function managedExecutionId(value = "") {
  const executionId = String(value || "").trim();
  if (!MANAGED_EXECUTION_ID_PATTERN.test(executionId)) {
    throw new Error("Vibe64 exec helper rejected an invalid managed execution id.");
  }
  return executionId.toLowerCase();
}

function managedExecutionKind(value = "") {
  const kind = String(value || "").trim();
  if (!MANAGED_EXECUTION_KINDS.has(kind)) {
    throw new Error("Vibe64 exec helper rejected an unknown managed execution kind.");
  }
  return kind;
}

function managedExecutionMode(value = "") {
  const mode = String(value || "").trim();
  if (!MANAGED_EXECUTION_MODES.has(mode)) {
    throw new Error("Vibe64 exec helper rejected an unknown managed execution mode.");
  }
  return mode;
}

function managedExecutionInteger(value, minimum, maximum, label = "value") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Vibe64 exec helper rejected an invalid managed execution ${label}.`);
  }
  return parsed;
}

function managedExecutionUnitName(executionId = "", owner = {}) {
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  return `vibe64-exec-${workspace}-${managedExecutionId(executionId).replaceAll("-", "")}.service`;
}

function managedExecutionSliceName(owner = {}) {
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  return `vibe64-${workspace}-work.slice`;
}

export {
  MANAGED_EXECUTION_ID_PATTERN,
  MANAGED_EXECUTION_MEMORY_MAX_BYTES,
  MANAGED_EXECUTION_MEMORY_MIN_BYTES,
  MANAGED_EXECUTION_TASKS_MAX,
  MANAGED_EXECUTION_TASKS_MIN,
  MANAGED_EXECUTION_WORK_MEMORY_MAX_BYTES,
  MANAGED_EXECUTION_WORK_MEMORY_MIN_BYTES,
  managedExecutionId,
  managedExecutionInteger,
  managedExecutionKind,
  managedExecutionMode,
  managedExecutionSliceName,
  managedExecutionTargetUser,
  managedExecutionUnitName
};
