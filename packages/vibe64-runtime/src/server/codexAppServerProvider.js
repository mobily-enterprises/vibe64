import { CodexAppServerJsonRpcClient, socketPathFromCodexAppServerEndpoint } from "@jskit-ai/assistant-core/server/codex-client";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

import {
  CODEX_AUTH_RECONNECTING_CODE,
  CODEX_AUTH_RECONNECTING_MESSAGE,
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE,
  codexAuthOutputRequiresReconnect,
  codexAuthStateSignature,
  markCodexReconnectRequired,
  readCodexAuthStatus
} from "@local/vibe64-core/server/codexAuthState";
import {
  runVibe64Command as defaultCommandRunner,
  stableHash,
  stopVibe64Execution,
  vibe64ManagedExecutionProvider,
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "@local/vibe64-execution/server";
import { withGenesisCommandShim } from "@local/vibe64-genesis/server";
import {
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
  runtimeNamespace
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  AGENT_PROVIDER_IDS,
  normalizeAgentText,
  normalizeAgentThread,
  normalizeAgentTurn
} from "./agentProviders.js";
import {
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
} from "./codexAttachmentPaths.js";

const CODEX_APP_SERVER_METADATA_SCHEMA_VERSION = 18;
const CODEX_APP_SERVER_PROVIDER_ID = AGENT_PROVIDER_IDS.CODEX_APP_SERVER;
const CODEX_APP_SERVER_TRANSPORT = Object.freeze({
  UNIX: "unix"
});
const CODEX_APP_SERVER_RUNTIME_DIR_NAME = "codex-app-server";
const CODEX_APP_SERVER_METADATA_FILE = "runtime.json";
const CODEX_APP_SERVER_LOG_FILE = "app-server.log";
const CODEX_APP_SERVER_SOCKET_FILE = "app-server.sock";
const CODEX_APP_SERVER_LOCK_DIR = "runtime.lock";
const CODEX_APP_SERVER_READY_TIMEOUT_MS = 60000;
const CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS = 2000;
const CODEX_APP_SERVER_LOCK_TIMEOUT_MS = 10000;
const CODEX_APP_SERVER_RUNTIME_BUSY_CODE = "vibe64_codex_app_server_runtime_busy";
const CODEX_APP_SERVER_PROCESS_IDENTITY_SETTLE_TIMEOUT_MS = 1000;
const CODEX_APP_SERVER_PROCESS_IDENTITY_SETTLE_POLL_MS = 25;
const CODEX_APP_SERVER_LOCK_STALE_MS = 120000;
const CODEX_APP_SERVER_PROCESS_IDENTITY_VERSION = 1;
const CODEX_APP_SERVER_PROCESS_IDENTITY_PLATFORM = "linux-proc";
const CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV = "VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN";
const CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV = "VIBE64_CODEX_APP_SERVER_COMMAND_HASH";
const CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES = new Set([
  "DBUS_SESSION_BUS_ADDRESS",
  "DBUS_STARTER_ADDRESS",
  "DBUS_STARTER_BUS_TYPE"
]);
const CODEX_APP_SERVER_SESSION_COMMAND_HOOK_PATH = fileURLToPath(
  new URL("./agentSessionCommandHook.js", import.meta.url)
);
const CODEX_APP_SERVER_INVALID_REQUEST_CODE = -32600;
const CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE = "vibe64_codex_model_catalog_invalid";
const CODEX_APP_SERVER_MODEL_CATALOG_PAGE_LIMIT = 100;
const CODEX_APP_SERVER_MODEL_CATALOG_MAX_PAGES = 100;
const CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRIES = 1000;
const CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRY_BYTES = 32 * 1024;
const CODEX_APP_SERVER_MODEL_CATALOG_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH = 512;
const CODEX_APP_SERVER_THREAD_INVENTORY_PAGE_LIMIT = 100;
const CODEX_APP_SERVER_THREAD_INVENTORY_MAX_PAGES = 100;
const CODEX_APP_SERVER_THREAD_INVENTORY_MAX_COUNT = 1000;
const CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH = 512;
const CODEX_APP_SERVER_THREAD_INVENTORY_MAX_ENTRY_BYTES = 64 * 1024;
const CODEX_APP_SERVER_THREAD_INVENTORY_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES = 1024 * 1024;
const CODEX_APP_SERVER_CHATGPT_ACCESS_TOKEN_MAX_LENGTH = 256 * 1024;
const CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH = 512;
const CODEX_APP_SERVER_PLAN_TYPE_MAX_LENGTH = 128;
const CODEX_APP_SERVER_API_KEY_MAX_LENGTH = 16 * 1024;
const CODEX_APP_SERVER_ECONOMY_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const CODEX_APP_SERVER_SERVER_INFO_USER_AGENT_MAX_LENGTH = 512;
const CODEX_AUTH_PREFLIGHT_TIMEOUT_MS = 15000;
const CODEX_AUTH_PREFLIGHT_OUTPUT_TAIL_BYTES = 4096;
const CODEX_APP_SERVER_CLIENT_VERSION = "0.1.0";
const CODEX_APP_SERVER_EXECUTION_MODES = Object.freeze({
  ECONOMY: "economy",
  INTERACTIVE: "interactive"
});
const CODEX_APP_SERVER_ECONOMY_HOME_DIR = "codex-home";
const CODEX_APP_SERVER_ECONOMY_WORKSPACE_DIR = "workspace";
const CODEX_APP_SERVER_CHATGPT_REFRESH_METHOD = "account/chatgptAuthTokens/refresh";
const CODEX_APP_SERVER_MANAGED_UMASK = "0007";
const CODEX_APP_SERVER_MANAGED_SHELL = "/bin/sh";
const CODEX_APP_SERVER_MANAGED_STARTUP_SCRIPT = [
  `umask ${CODEX_APP_SERVER_MANAGED_UMASK}`,
  `unset ${[...CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES].join(" ")}`,
  'exec "$@"'
].join("\n");
const CODEX_APP_SERVER_ECONOMY_STARTUP_SCRIPT = [
  `umask ${CODEX_APP_SERVER_MANAGED_UMASK}`,
  "exec /usr/bin/env -i \\",
  '  HOME="$HOME" LOGNAME="$LOGNAME" USER="$USER" PATH="$PATH" \\',
  '  CODEX_HOME="$CODEX_HOME" LANG="$LANG" LC_ALL="$LC_ALL" LC_CTYPE="$LC_CTYPE" \\',
  `  ${CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV}="$${CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV}" ${CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV}="$${CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV}" \\`,
  '  SSL_CERT_DIR="$SSL_CERT_DIR" SSL_CERT_FILE="$SSL_CERT_FILE" TERM="$TERM" TMPDIR="$TMPDIR" TZ="$TZ" \\',
  '  "$@"'
].join("\n");
const CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES = process.platform === "linux" ? 107 : 103;
const VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV = "VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR";
const CODEX_APP_SERVER_ENDPOINT_STATUS = Object.freeze({
  MISSING: "missing",
  RESPONSIVE: "responsive",
  TIMEOUT: "timeout",
  UNREACHABLE: "unreachable"
});
const CODEX_APP_SERVER_RUNTIME_STATUS = Object.freeze({
  EXITED: "exited",
  INCOMPATIBLE: "incompatible",
  LIVE: "live",
  MISSING: "missing",
  SUSPECT: "suspect"
});
const CODEX_APP_SERVER_PROCESS_STATE = Object.freeze({
  RUNNING: "running",
  STOPPED: "stopped"
});
const CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS = Object.freeze({
  ABSENT: "absent",
  AMBIGUOUS: "ambiguous",
  EXACT: "exact",
  INVALID: "invalid",
  MISMATCH: "mismatch"
});

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function codexAppServerTextHasControlCharacters(value = "") {
  return Array.from(String(value)).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function codexAppServerExecutionMode(options = {}) {
  return normalizeAgentText(options.executionMode) === CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
    ? CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
    : CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE;
}

function codexAppServerIsEconomy(options = {}) {
  return codexAppServerExecutionMode(options) === CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY;
}

function codexAppServerEconomyAuthError(code = "", message = "") {
  const error = new Error(
    normalizeAgentText(message) || "Codex economy authentication is unavailable. Reconnect Codex and retry."
  );
  error.code = normalizeAgentText(code) || "vibe64_codex_economy_auth_unavailable";
  return error;
}

function boundedCodexAuthText(value, {
  label = "Codex authentication value",
  maxLength = 0
} = {}) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw codexAppServerEconomyAuthError(
      "vibe64_codex_economy_auth_invalid",
      `${label} is missing or invalid. Reconnect Codex and retry.`
    );
  }
  return value;
}

function codexAccountIdentitySignature(authMode = "", identity = "") {
  return `sha256:${createHash("sha256")
    .update("vibe64-codex-account-v1\0", "utf8")
    .update(normalizeAgentText(authMode), "utf8")
    .update("\0", "utf8")
    .update(String(identity || ""), "utf8")
    .digest("hex")}`;
}

function codexAuthSecretSignature(secret = "") {
  return createHash("sha256")
    .update("vibe64-codex-auth-secret-v1\0", "utf8")
    .update(String(secret || ""), "utf8")
    .digest("hex");
}

async function readBoundedCodexAuthJson(filePath = "") {
  let handle = null;
  try {
    handle = await open(filePath, "r");
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size > CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES) {
      throw codexAppServerEconomyAuthError(
        "vibe64_codex_economy_auth_invalid",
        "The selected Codex authentication record is invalid. Reconnect Codex and retry."
      );
    }
    const buffer = Buffer.alloc(CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    if (offset > CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES) {
      throw codexAppServerEconomyAuthError(
        "vibe64_codex_economy_auth_invalid",
        "The selected Codex authentication record is too large. Reconnect Codex and retry."
      );
    }
    const parsed = JSON.parse(buffer.subarray(0, offset).toString("utf8"));
    if (!isPlainObject(parsed)) {
      throw new Error("invalid authentication record");
    }
    return parsed;
  } catch (error) {
    if (error?.code?.startsWith?.("vibe64_codex_economy_auth_")) {
      throw error;
    }
    throw codexAppServerEconomyAuthError(
      "vibe64_codex_economy_auth_unavailable",
      "The selected Codex authentication record could not be read. Reconnect Codex and retry."
    );
  } finally {
    await handle?.close?.().catch(() => null);
  }
}

async function readCodexSelectedAccountAuth(options = {}) {
  const toolHomeSource = normalizeAgentText(options.toolHomeSource);
  if (!toolHomeSource || !path.isAbsolute(toolHomeSource)) {
    throw codexAppServerEconomyAuthError(
      "vibe64_codex_economy_auth_unavailable",
      "The selected Codex account is unavailable. Reconnect Codex and retry."
    );
  }
  const auth = await readBoundedCodexAuthJson(path.join(toolHomeSource, ".codex", "auth.json"));
  const storedMode = normalizeAgentText(auth.auth_mode).toLowerCase();
  if (storedMode === "chatgpt") {
    const tokens = isPlainObject(auth.tokens) ? auth.tokens : {};
    const accountId = boundedCodexAuthText(tokens.account_id, {
      label: "Codex account identity",
      maxLength: CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH
    });
    const accessToken = boundedCodexAuthText(tokens.access_token, {
      label: "Codex access token",
      maxLength: CODEX_APP_SERVER_CHATGPT_ACCESS_TOKEN_MAX_LENGTH
    });
    const planTypeValue = tokens.chatgpt_plan_type ?? tokens.plan_type;
    const planType = planTypeValue === undefined || planTypeValue === null || planTypeValue === ""
      ? ""
      : boundedCodexAuthText(planTypeValue, {
          label: "Codex plan type",
          maxLength: CODEX_APP_SERVER_PLAN_TYPE_MAX_LENGTH
        });
    return Object.freeze({
      accessToken,
      accountId,
      authMode: "chatgpt",
      identitySignature: codexAccountIdentitySignature("chatgpt", accountId),
      planType,
      secretSignature: codexAuthSecretSignature(accessToken)
    });
  }
  if (["apikey", "api_key"].includes(storedMode)) {
    const apiKey = boundedCodexAuthText(auth.OPENAI_API_KEY, {
      label: "Codex API key",
      maxLength: CODEX_APP_SERVER_API_KEY_MAX_LENGTH
    });
    return Object.freeze({
      apiKey,
      authMode: "apiKey",
      identitySignature: codexAccountIdentitySignature("apiKey", apiKey),
      secretSignature: codexAuthSecretSignature(apiKey)
    });
  }
  throw codexAppServerEconomyAuthError(
    "vibe64_codex_economy_auth_invalid",
    "The selected Codex authentication mode is unsupported. Reconnect Codex and retry."
  );
}

async function readCodexSelectedAccountAccess(options = {}) {
  const toolHomeSource = normalizeAgentText(options.toolHomeSource);
  if (!toolHomeSource || !path.isAbsolute(toolHomeSource)) {
    throw codexAppServerEconomyAuthError(
      "vibe64_codex_economy_auth_unavailable",
      "The selected Codex account is unavailable. Reconnect Codex and retry."
    );
  }
  const auth = await readBoundedCodexAuthJson(path.join(toolHomeSource, ".codex", "auth.json"));
  const authMode = normalizeAgentText(auth.auth_mode).toLowerCase();
  if (!["chatgpt", "apikey", "api_key"].includes(authMode)) {
    throw codexAppServerEconomyAuthError(
      "vibe64_codex_economy_auth_invalid",
      "The selected Codex authentication mode is unsupported. Reconnect Codex and retry."
    );
  }
  const ownerOnly = authMode === "chatgpt";
  const endpointCode = ownerOnly ? "codex_subscription" : "openai_api";
  return Object.freeze({
    endpointCode,
    ownerOnly
  });
}

async function currentCodexAccountIdentitySignature(options = {}) {
  const explicit = normalizeAgentText(options.accountIdentitySignature);
  if (explicit) {
    return explicit;
  }
  if (!codexAppServerIsEconomy(options)) {
    return "";
  }
  return (await readCodexSelectedAccountAuth(options)).identitySignature;
}

function hasOwn(object = {}, property = "") {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function codexAppServerRequestIsInvalid(error = null, method = "") {
  const expectedMethod = normalizeAgentText(method);
  const actualMethod = normalizeAgentText(error?.method);
  return Number(error?.code) === CODEX_APP_SERVER_INVALID_REQUEST_CODE &&
    (!expectedMethod || !actualMethod || actualMethod === expectedMethod);
}

function codexAppServerModelCatalogError(message = "") {
  const error = new Error(normalizeAgentText(message) || "Codex returned an invalid model catalog.");
  error.code = CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE;
  return error;
}

function codexAppServerEconomyLoginParams(auth = {}) {
  if (auth.authMode === "chatgpt") {
    return {
      accessToken: auth.accessToken,
      chatgptAccountId: auth.accountId,
      chatgptPlanType: auth.planType || null,
      type: "chatgptAuthTokens"
    };
  }
  if (auth.authMode === "apiKey") {
    return {
      apiKey: auth.apiKey,
      type: "apiKey"
    };
  }
  throw codexAppServerEconomyAuthError(
    "vibe64_codex_economy_auth_invalid",
    "The selected Codex authentication mode is unsupported. Reconnect Codex and retry."
  );
}

function codexAppServerEconomyLoginResponseType(auth = {}) {
  return auth.authMode === "chatgpt" ? "chatgptAuthTokens" : "apiKey";
}

function codexAppServerEconomyAccountType(auth = {}) {
  return auth.authMode === "chatgpt" ? "chatgpt" : "apiKey";
}

function codexAppServerEconomyRequestError(error = null, reason = "") {
  if (
    error?.name === "AbortError" ||
    error?.code === "ABORT_ERR" ||
    (typeof error?.code === "string" && error.code.startsWith("vibe64_codex_economy_")) ||
    error?.code === CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE
  ) {
    return error;
  }
  const failure = new Error("Codex isolated economy execution failed. Retry the task.");
  failure.code = "vibe64_codex_economy_provider_request_failed";
  const providerCode = Number(error?.code);
  if (Number.isSafeInteger(providerCode)) {
    failure.providerCode = providerCode;
  }
  const normalizedReason = normalizeAgentText(reason);
  if (normalizedReason && normalizedReason.length <= 128) {
    failure.operation = normalizedReason;
  }
  return failure;
}

function normalizeCodexAppServerInfo(initializeResult = null) {
  if (!isPlainObject(initializeResult)) {
    return null;
  }
  const rawUserAgent = initializeResult.userAgent;
  if (
    typeof rawUserAgent !== "string" ||
    rawUserAgent.length === 0 ||
    rawUserAgent.length > CODEX_APP_SERVER_SERVER_INFO_USER_AGENT_MAX_LENGTH ||
    codexAppServerTextHasControlCharacters(rawUserAgent)
  ) {
    return Object.freeze({ userAgent: "" });
  }
  return Object.freeze({
    userAgent: rawUserAgent.trim()
  });
}

function runtimeEnvValue(env = {}, hostEnv = process.env, name = "") {
  const primaryEnv = isPlainObject(env) ? env : {};
  const fallbackEnv = isPlainObject(hostEnv) ? hostEnv : {};
  return normalizeAgentText(hasOwn(primaryEnv, name) ? primaryEnv[name] : fallbackEnv[name]);
}

function processUid() {
  return typeof process.getuid === "function" ? process.getuid() : "user";
}

function processIsAlive(pid) {
  const normalizedPid = Number(pid);
  if (!Number.isSafeInteger(normalizedPid) || normalizedPid <= 0) {
    return false;
  }
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch {
    return false;
  }
}

function processGroupIsAlive(processGroupId) {
  const normalizedProcessGroupId = Number(processGroupId);
  if (!Number.isSafeInteger(normalizedProcessGroupId) || normalizedProcessGroupId <= 0) {
    return false;
  }
  if (process.platform === "win32") {
    return processIsAlive(normalizedProcessGroupId);
  }
  try {
    process.kill(-normalizedProcessGroupId, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcessGroup(processGroupId, signal) {
  const normalizedProcessGroupId = Number(processGroupId);
  const target = process.platform === "win32"
    ? normalizedProcessGroupId
    : -normalizedProcessGroupId;
  try {
    process.kill(target, signal);
    return true;
  } catch (error) {
    if (!["ESRCH", "EPERM"].includes(String(error?.code || ""))) {
      throw error;
    }
    return false;
  }
}

function linuxProcessStat(value = "") {
  const text = String(value || "");
  const commandEnd = text.lastIndexOf(")");
  if (commandEnd < 0) {
    return null;
  }
  const fields = text.slice(commandEnd + 1).trim().split(/\s+/u);
  const state = String(fields[0] || "");
  const parentPid = Number(fields[1]);
  const processGroupId = Number(fields[2]);
  const startTimeTicks = String(fields[19] || "");
  if (
    !/^[A-Z]$/u.test(state) ||
    !Number.isSafeInteger(parentPid) || parentPid < 0 ||
    !Number.isSafeInteger(processGroupId) || processGroupId <= 0 ||
    !/^\d+$/u.test(startTimeTicks)
  ) {
    return null;
  }
  return {
    parentPid,
    processGroupId,
    startTimeTicks,
    state
  };
}

function normalizeCodexAppServerProcessIdentity(value = {}) {
  const normalized = isPlainObject(value) ? value : {};
  return {
    commandHash: normalizeAgentText(normalized.commandHash),
    platform: normalizeAgentText(normalized.platform),
    runtimeToken: normalizeAgentText(normalized.runtimeToken),
    startTimeTicks: normalizeAgentText(normalized.startTimeTicks),
    version: Number(normalized.version || 0)
  };
}

function codexAppServerProcessIdentityIsWellFormed(value = {}) {
  const identity = normalizeCodexAppServerProcessIdentity(value);
  return Boolean(
    identity.version === CODEX_APP_SERVER_PROCESS_IDENTITY_VERSION &&
    identity.platform === CODEX_APP_SERVER_PROCESS_IDENTITY_PLATFORM &&
    /^[a-f0-9]{12}$/u.test(identity.commandHash) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(identity.runtimeToken) &&
    /^\d+$/u.test(identity.startTimeTicks)
  );
}

function codexAppServerProcessMetadataIsIdentifiable(metadata = {}, runtimeDir = "") {
  const normalizedRuntimeDir = normalizeAgentText(runtimeDir);
  return Boolean(
    Number(metadata.schemaVersion) === CODEX_APP_SERVER_METADATA_SCHEMA_VERSION &&
    metadata.provider === CODEX_APP_SERVER_PROVIDER_ID &&
    Number.isSafeInteger(Number(metadata.pid)) && Number(metadata.pid) > 0 &&
    (!normalizedRuntimeDir || metadata.runtimeDir === normalizedRuntimeDir) &&
    codexAppServerProcessIdentityIsWellFormed(metadata.processIdentity) &&
    [
      CODEX_APP_SERVER_PROCESS_STATE.RUNNING,
      CODEX_APP_SERVER_PROCESS_STATE.STOPPED
    ].includes(metadata.processState)
  );
}

function codexAppServerLegacyProcessExitIsVerified(metadata = {}, runtimeDir = "") {
  const normalizedRuntimeDir = normalizeAgentText(runtimeDir);
  const pid = Number(metadata?.pid);
  return Boolean(
    Number(metadata?.schemaVersion) === CODEX_APP_SERVER_METADATA_SCHEMA_VERSION - 1 &&
    metadata?.provider === CODEX_APP_SERVER_PROVIDER_ID &&
    Number.isSafeInteger(pid) && pid > 0 &&
    metadata?.runtimeDir === normalizedRuntimeDir &&
    !processGroupIsAlive(pid)
  );
}

function linuxProcessEnvironmentValue(buffer = Buffer.alloc(0), name = "") {
  const prefix = `${name}=`;
  for (const entry of buffer.toString("utf8").split("\0")) {
    if (entry.startsWith(prefix)) {
      return entry.slice(prefix.length);
    }
  }
  return "";
}

async function linuxProcessRecords() {
  const records = [];
  const entries = await readdir("/proc", {
    withFileTypes: true
  }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) {
      continue;
    }
    const pid = Number(entry.name);
    const statValue = await readFile(`/proc/${entry.name}/stat`, "utf8").catch(() => "");
    const processStat = linuxProcessStat(statValue);
    if (!processStat || processStat.state === "Z") {
      continue;
    }
    let environment = null;
    let environmentReadable = true;
    try {
      environment = await readFile(`/proc/${entry.name}/environ`);
    } catch (error) {
      if (String(error?.code || "") === "ENOENT") {
        continue;
      }
      environmentReadable = false;
    }
    records.push({
      ...processStat,
      environment,
      environmentReadable,
      pid
    });
  }
  return records;
}

function normalizeCodexAppServerProcessIdentityInspection(value = {}) {
  const status = Object.values(CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS).includes(value?.status)
    ? value.status
    : CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.AMBIGUOUS;
  return {
    processGroupIds: [...new Set((Array.isArray(value?.processGroupIds)
      ? value.processGroupIds
      : [])
      .map(Number)
      .filter((processGroupId) => Number.isSafeInteger(processGroupId) && processGroupId > 0))],
    status
  };
}

async function inspectLinuxCodexAppServerProcessIdentity(metadata = {}) {
  if (!codexAppServerProcessMetadataIsIdentifiable(metadata)) {
    return {
      processGroupIds: [],
      status: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.INVALID
    };
  }
  if (metadata.processState === CODEX_APP_SERVER_PROCESS_STATE.STOPPED) {
    return {
      processGroupIds: [],
      status: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.ABSENT
    };
  }
  if (process.platform !== "linux") {
    return {
      processGroupIds: [],
      status: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.AMBIGUOUS
    };
  }
  const identity = metadata.processIdentity;
  const records = await linuxProcessRecords();
  const rootProcessGroupId = Number(metadata.pid);
  const rootGroupMembers = records.filter(({ processGroupId }) => processGroupId === rootProcessGroupId);
  const exactRecords = [];
  const rootUnreadable = rootGroupMembers.some(({ environmentReadable }) => !environmentReadable);
  for (const record of records) {
    if (!record.environmentReadable) {
      continue;
    }
    const runtimeToken = linuxProcessEnvironmentValue(
      record.environment,
      CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV
    );
    const commandHash = linuxProcessEnvironmentValue(
      record.environment,
      CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV
    );
    if (runtimeToken === identity.runtimeToken && commandHash === identity.commandHash) {
      exactRecords.push(record);
    }
  }
  const exactLeader = exactRecords.find(({ pid }) => pid === rootProcessGroupId);
  if (exactLeader && exactLeader.startTimeTicks !== identity.startTimeTicks) {
    return {
      processGroupIds: [],
      status: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.AMBIGUOUS
    };
  }
  if (exactRecords.length === 0) {
    if (rootUnreadable) {
      return {
        processGroupIds: [],
        status: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.AMBIGUOUS
      };
    }
    return {
      processGroupIds: [],
      status: rootGroupMembers.length > 0 || processGroupIsAlive(rootProcessGroupId)
        ? CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.MISMATCH
        : CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.ABSENT
    };
  }
  const processGroupIds = [...new Set(exactRecords.map(({ processGroupId }) => processGroupId))];
  for (const processGroupId of processGroupIds) {
    const groupMembers = records.filter((record) => record.processGroupId === processGroupId);
    if (groupMembers.some((record) => (
      !record.environmentReadable || !exactRecords.some(({ pid }) => pid === record.pid)
    ))) {
      return {
        processGroupIds: [],
        status: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.AMBIGUOUS
      };
    }
  }
  if (
    rootGroupMembers.some((record) => !exactRecords.some(({ pid }) => pid === record.pid))
  ) {
    return {
      processGroupIds: [],
      status: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.AMBIGUOUS
    };
  }
  return {
    processGroupIds,
    status: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.EXACT
  };
}

async function inspectCodexAppServerProcessIdentity(metadata = {}, options = {}) {
  const inspector = typeof options.processIdentityInspector === "function"
    ? options.processIdentityInspector
    : inspectLinuxCodexAppServerProcessIdentity;
  return normalizeCodexAppServerProcessIdentityInspection(await inspector(metadata));
}

async function ensurePrivateDirectory(dirPath = "") {
  await mkdir(dirPath, {
    mode: 0o700,
    recursive: true
  });
  await chmod(dirPath, 0o700).catch(() => null);
}

async function ensureWritablePrivateDirectory(dirPath = "") {
  await ensurePrivateDirectory(dirPath);
  const probePath = path.join(dirPath, `.vibe64-write-check-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(probePath, "", {
      mode: 0o600
    });
  } catch (error) {
    throw new Error(
      `Codex app-server runtime directory is not writable: ${dirPath}. ${String(error?.message || error)}`
    );
  } finally {
    await rm(probePath, {
      force: true
    }).catch(() => null);
  }
}

async function assertExistingDirectory(dirPath = "", label = "directory") {
  const normalizedPath = normalizeAgentText(dirPath);
  if (!normalizedPath) {
    return;
  }
  const stats = await stat(normalizedPath);
  if (!stats.isDirectory()) {
    throw new Error(`${label} is not a directory: ${normalizedPath}`);
  }
}

function codexAppServerRuntimeBaseDir({
  env = process.env,
  hostEnv = process.env
} = {}) {
  const explicitDir = runtimeEnvValue(env, hostEnv, "VIBE64_AGENT_RUNTIME_DIR");
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  const xdgRuntimeDir = runtimeEnvValue(env, hostEnv, "XDG_RUNTIME_DIR");
  if (xdgRuntimeDir && path.isAbsolute(xdgRuntimeDir)) {
    return path.join(xdgRuntimeDir, "vibe64", "agent-providers");
  }
  const homeDir = normalizeAgentText(os.homedir());
  if (homeDir && path.isAbsolute(homeDir)) {
    return path.join(homeDir, ".cache", "vibe64", "agent-providers");
  }
  return path.join(os.tmpdir(), `vibe64-${processUid()}`, "agent-providers");
}

function codexAppServerRuntimeScope({
  executionRoot = "",
  workdir = ""
} = {}) {
  const normalizedExecutionRoot = normalizeAgentText(executionRoot);
  if (normalizedExecutionRoot) {
    return path.resolve(normalizedExecutionRoot);
  }
  const normalizedWorkdir = normalizeAgentText(workdir);
  return normalizedWorkdir ? path.resolve(normalizedWorkdir) : "";
}

function codexAppServerRuntimeIdentityScope(options = {}) {
  const scope = codexAppServerRuntimeScope(options);
  if (!scope) {
    return "";
  }
  const namespace = runtimeNamespace();
  const runtimeInstanceId = normalizeAgentText(options.runtimeInstanceId);
  const executionMode = codexAppServerExecutionMode(options);
  return [
    namespace ? `namespace:${namespace}` : "",
    `scope:${scope}`,
    runtimeInstanceId ? `instance:${runtimeInstanceId}` : "",
    executionMode === CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
      ? `mode:${executionMode}`
      : ""
  ].filter(Boolean).join("\n");
}

function codexAppServerRuntimeDir(options = {}) {
  const scope = codexAppServerRuntimeIdentityScope(options);
  const dirName = scope
    ? `${CODEX_APP_SERVER_RUNTIME_DIR_NAME}-${stableHash(scope)}`
    : CODEX_APP_SERVER_RUNTIME_DIR_NAME;
  return path.join(codexAppServerRuntimeBaseDir(options), dirName);
}

function codexAppServerEconomyHomeDir(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_ECONOMY_HOME_DIR);
}

function codexAppServerEconomyWorkspaceDir(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_ECONOMY_WORKSPACE_DIR);
}

function codexAppServerEconomyCommandBaseEnv(env = process.env, codexHome = "") {
  const source = isPlainObject(env) ? env : {};
  const cleared = Object.fromEntries(Object.keys({
    ...process.env,
    ...source
  }).map((name) => [name, ""]));
  const allowedNames = [
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "PATH",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TERM",
    "TMPDIR",
    "TZ"
  ];
  return {
    ...cleared,
    ...Object.fromEntries(allowedNames
      .filter((name) => typeof source[name] === "string" && source[name])
      .map((name) => [name, source[name]])),
    CODEX_HOME: codexHome
  };
}

function codexAppServerMetadataPath(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_METADATA_FILE);
}

function codexAppServerLogPath(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_LOG_FILE);
}

function codexAppServerSocketPath(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_SOCKET_FILE);
}

function codexAppServerSocketPathBytes(socketPath = "") {
  return Buffer.byteLength(String(socketPath || ""), "utf8");
}

function codexAppServerSocketPathTooLong(socketPath = "") {
  return codexAppServerSocketPathBytes(socketPath) > CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES;
}

function assertCodexAppServerSocketPathSupported(socketPath = "") {
  if (!codexAppServerSocketPathTooLong(socketPath)) {
    return;
  }
  throw new Error(
    `Codex app-server Unix socket path is too long for this OS: ${socketPath} ` +
    `(${codexAppServerSocketPathBytes(socketPath)} bytes, max ${CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES}). ` +
    "Configure VIBE64_AGENT_RUNTIME_DIR or XDG_RUNTIME_DIR to a shorter host runtime directory."
  );
}

function codexAppServerLockDir(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_LOCK_DIR);
}

function codexAppServerUnixEndpoint(socketPath = "") {
  return `unix://${socketPath}`;
}

function codexAppServerProjectTrustOverride(workdir = "") {
  const normalizedWorkdir = normalizeAgentText(workdir);
  if (!normalizedWorkdir) {
    return "";
  }
  const projectRoot = path.resolve(normalizedWorkdir);
  return `projects={${JSON.stringify(projectRoot)}={trust_level="trusted"}}`;
}

async function currentCodexAuthStateSignature(options = {}) {
  const signature = normalizeAgentText(options.authStateSignature);
  if (signature) {
    return signature;
  }
  return codexAuthStateSignature({
    systemRoot: options.systemRoot
  });
}

async function assertCodexAuthGenerationCurrent(capturedSignature = "", options = {}) {
  const systemRoot = normalizeAgentText(options.systemRoot);
  if (!systemRoot) {
    return normalizeAgentText(capturedSignature);
  }
  const authStatus = await readCodexAuthStatus(systemRoot);
  if (authStatus?.status === "reconnecting") {
    const error = new Error(authStatus.message || CODEX_AUTH_RECONNECTING_MESSAGE);
    error.code = authStatus.code || CODEX_AUTH_RECONNECTING_CODE;
    error.retryable = false;
    throw error;
  }
  if (authStatus?.status === "reconnect_required") {
    throw codexReconnectRequiredError();
  }
  const currentSignature = await codexAuthStateSignature({
    systemRoot
  });
  if (
    normalizeAgentText(capturedSignature) &&
    normalizeAgentText(capturedSignature) !== currentSignature
  ) {
    const error = new Error("Codex authentication changed while the app-server was starting.");
    error.code = "vibe64_codex_auth_generation_changed";
    error.retryable = false;
    throw error;
  }
  return currentSignature;
}

function codexReconnectRequiredError({
  cause = null,
  observed = ""
} = {}) {
  const error = new Error(CODEX_RECONNECT_REQUIRED_MESSAGE);
  error.code = CODEX_RECONNECT_REQUIRED_CODE;
  error.errors = [
    {
      code: CODEX_RECONNECT_REQUIRED_CODE,
      message: CODEX_RECONNECT_REQUIRED_MESSAGE
    }
  ];
  error.observed = normalizeAgentText(observed);
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function tailAppend(text = "", chunk = "", maxBytes = CODEX_AUTH_PREFLIGHT_OUTPUT_TAIL_BYTES) {
  const next = `${String(text || "")}${String(chunk || "")}`;
  return next.length > maxBytes ? next.slice(-maxBytes) : next;
}

function codexAuthPreflightArgs() {
  return [
    "-c",
    STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
    "debug",
    "models"
  ];
}

async function runCodexAuthPreflight({
  codexCommand = STUDIO_MANAGED_CODEX_COMMAND,
  commandRunner = defaultCommandRunner,
  env = process.env,
  executionRoot = "",
  runtimeDir = "",
  runtimes = [],
  terminalEnv = {},
  timeoutMs = CODEX_AUTH_PREFLIGHT_TIMEOUT_MS,
  toolHomeSource = "",
  workdir = ""
} = {}) {
  const normalizedToolHomeSource = normalizeAgentText(toolHomeSource);
  if (normalizedToolHomeSource) {
    await assertExistingDirectory(normalizedToolHomeSource, "Codex credential home");
  }
  const normalizedRuntimeDir = normalizeAgentText(runtimeDir);
  if (normalizedRuntimeDir) {
    await ensureWritablePrivateDirectory(path.resolve(normalizedRuntimeDir));
  }
  const baseEnv = codexAppServerCommandBaseEnv({
    env,
    terminalEnv
  });
  const processCwd = codexAppServerProcessCwd({
    executionRoot,
    runtimeDir,
    workdir
  });
  try {
    const result = await commandRunner({
      actor: "app",
      allowedRoots: processCwd ? [processCwd] : [],
      args: codexAuthPreflightArgs(),
      baseEnv,
      command: codexCommand,
      credentialHome: codexAppServerCredentialHome(normalizedToolHomeSource, baseEnv),
      cwd: processCwd,
      envPolicy: "auth",
      inheritProcessEnv: false,
      mode: "capture",
      purpose: "codex",
      runtimes: codexAppServerRuntimes(runtimes),
      shimDirs: codexAppServerShimDirs(terminalEnv),
      timeout: normalizePositiveInteger(timeoutMs, CODEX_AUTH_PREFLIGHT_TIMEOUT_MS)
    });
    return {
      code: result.exitCode,
      ok: result.ok === true,
      output: tailAppend("", result.output || [
        result.stderr,
        result.stdout
      ].filter(Boolean).join("\n")),
      signal: result.signal,
      timedOut: result.timedOut === true
    };
  } catch (error) {
    return {
      error,
      ok: false,
      output: normalizeAgentText(error?.message || error)
    };
  }
}

async function markCodexAppServerReconnectRequired(options = {}, {
  reason = "codex-app-server",
  observed = ""
} = {}) {
  await markCodexReconnectRequired(options.systemRoot, {
    reason
  });
  throw codexReconnectRequiredError({
    observed
  });
}

async function assertCodexAuthPreflightReady(options = {}, {
  reason = "codex-auth-preflight"
} = {}) {
  const result = await runCodexAuthPreflight(options);
  if (result.ok && !codexAuthOutputRequiresReconnect(result.output)) {
    return result;
  }
  const observed = normalizeAgentText(result.output || result.error?.message || "Codex auth preflight failed.");
  if (codexAuthOutputRequiresReconnect(observed)) {
    await markCodexReconnectRequired(options.systemRoot, {
      reason
    });
    throw codexReconnectRequiredError({
      observed
    });
  }
  throw new Error(observed || "Codex auth preflight failed.");
}

function codexAppServerProcessCwd({
  executionRoot = "",
  runtimeDir = "",
  workdir = ""
} = {}) {
  const normalizedWorkdir = normalizeAgentText(workdir) ? path.resolve(workdir) : "";
  if (normalizedWorkdir) {
    return normalizedWorkdir;
  }
  const normalizedExecutionRoot = normalizeAgentText(executionRoot) ? path.resolve(executionRoot) : "";
  if (normalizedExecutionRoot) {
    return normalizedExecutionRoot;
  }
  return normalizeAgentText(runtimeDir) ? path.resolve(runtimeDir) : "";
}

function codexAppServerRuntimeDirIsManaged(runtimeDir = "") {
  const normalizedRuntimeDir = normalizeAgentText(runtimeDir);
  if (!normalizedRuntimeDir) {
    return false;
  }
  const basename = path.basename(path.resolve(normalizedRuntimeDir));
  return basename === CODEX_APP_SERVER_RUNTIME_DIR_NAME ||
    basename.startsWith(`${CODEX_APP_SERVER_RUNTIME_DIR_NAME}-`);
}

async function removeCodexAppServerRuntimeDir(runtimeDir = "") {
  const normalizedRuntimeDir = normalizeAgentText(runtimeDir);
  if (!codexAppServerRuntimeDirIsManaged(normalizedRuntimeDir)) {
    return false;
  }
  await rm(normalizedRuntimeDir, {
    force: true,
    recursive: true
  });
  return true;
}

async function waitForCodexAppServerProcessIdentityExit(metadata = {}, options = {}, timeoutMs = 0) {
  const deadline = Date.now() + timeoutMs;
  let inspection = await inspectCodexAppServerProcessIdentity(metadata, options);
  while (
    Date.now() < deadline &&
    inspection.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.EXACT
  ) {
    await delay(100);
    inspection = await inspectCodexAppServerProcessIdentity(metadata, options);
  }
  return inspection;
}

async function waitForCodexAppServerProcessIdentityToSettle(metadata = {}, options = {}) {
  const timeoutMs = normalizePositiveInteger(
    options.processIdentitySettleTimeoutMs,
    CODEX_APP_SERVER_PROCESS_IDENTITY_SETTLE_TIMEOUT_MS
  );
  const pollMs = normalizePositiveInteger(
    options.processIdentitySettlePollMs,
    CODEX_APP_SERVER_PROCESS_IDENTITY_SETTLE_POLL_MS
  );
  const deadline = Date.now() + timeoutMs;
  let inspection = await inspectCodexAppServerProcessIdentity(metadata, options);
  while (
    inspection.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.AMBIGUOUS &&
    Date.now() < deadline
  ) {
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    inspection = await inspectCodexAppServerProcessIdentity(metadata, options);
  }
  return inspection;
}

async function signalVerifiedCodexAppServerProcessGroups(metadata = {}, signal = "SIGTERM", options = {}) {
  const signalProcessGroupImpl = typeof options.signalProcessGroup === "function"
    ? options.signalProcessGroup
    : signalProcessGroup;
  const initial = await waitForCodexAppServerProcessIdentityToSettle(metadata, options);
  if (initial.status !== CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.EXACT) {
    return {
      inspection: initial,
      signaledProcessGroups: []
    };
  }
  const rootProcessGroupId = Number(metadata.pid);
  const orderedProcessGroupIds = [
    ...initial.processGroupIds.filter((processGroupId) => processGroupId !== rootProcessGroupId),
    ...initial.processGroupIds.filter((processGroupId) => processGroupId === rootProcessGroupId)
  ];
  const signaledProcessGroups = [];
  for (const processGroupId of orderedProcessGroupIds) {
    const current = await waitForCodexAppServerProcessIdentityToSettle(metadata, options);
    if (
      current.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.ABSENT ||
      current.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.MISMATCH
    ) {
      return {
        inspection: current,
        signaledProcessGroups
      };
    }
    if (current.status !== CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.EXACT) {
      return {
        inspection: current,
        signaledProcessGroups
      };
    }
    if (!current.processGroupIds.includes(processGroupId)) {
      continue;
    }
    signalProcessGroupImpl(processGroupId, signal);
    signaledProcessGroups.push(processGroupId);
  }
  return {
    inspection: await waitForCodexAppServerProcessIdentityToSettle(metadata, options),
    signaledProcessGroups
  };
}

async function stopCodexAppServerProcessGroup(metadata = {}, options = {}) {
  if (!codexAppServerProcessMetadataIsIdentifiable(metadata)) {
    return {
      identityStatus: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.INVALID,
      processExitVerified: false,
      stopped: false
    };
  }
  if (
    metadata.processState === CODEX_APP_SERVER_PROCESS_STATE.STOPPED &&
    metadata.processExitVerifiedAt
  ) {
    return {
      alreadyStopped: true,
      identityStatus: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.ABSENT,
      processExitVerified: true,
      stopped: false
    };
  }
  const before = await waitForCodexAppServerProcessIdentityToSettle(metadata, options);
  if (
    before.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.ABSENT ||
    before.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.MISMATCH
  ) {
    return {
      identityStatus: before.status,
      processExitVerified: true,
      stopped: false
    };
  }
  if (before.status !== CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.EXACT) {
    return {
      identityStatus: before.status,
      processExitVerified: false,
      stopped: false
    };
  }
  const term = await signalVerifiedCodexAppServerProcessGroups(metadata, "SIGTERM", options);
  if (term.inspection.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.AMBIGUOUS) {
    return {
      identityStatus: term.inspection.status,
      processExitVerified: false,
      signaledProcessGroups: term.signaledProcessGroups,
      stopped: false
    };
  }
  let after = await waitForCodexAppServerProcessIdentityExit(
    metadata,
    options,
    normalizePositiveInteger(options.termTimeoutMs, 3000)
  );
  let signaledProcessGroups = [...term.signaledProcessGroups];
  if (after.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.EXACT) {
    const kill = await signalVerifiedCodexAppServerProcessGroups(metadata, "SIGKILL", options);
    signaledProcessGroups = [...new Set([
      ...signaledProcessGroups,
      ...kill.signaledProcessGroups
    ])];
    if (kill.inspection.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.AMBIGUOUS) {
      return {
        identityStatus: kill.inspection.status,
        processExitVerified: false,
        signaledProcessGroups,
        stopped: false
      };
    }
    after = await waitForCodexAppServerProcessIdentityExit(
      metadata,
      options,
      normalizePositiveInteger(options.killTimeoutMs, 1000)
    );
  }
  const processExitVerified = [
    CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.ABSENT,
    CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.MISMATCH
  ].includes(after.status);
  return {
    descendantProcessGroups: signaledProcessGroups.filter((processGroupId) => (
      processGroupId !== Number(metadata.pid)
    )),
    identityStatus: after.status,
    pid: Number(metadata.pid),
    processExitVerified,
    signaledProcessGroups,
    stopped: processExitVerified && signaledProcessGroups.length > 0
  };
}

async function stopOwnedCodexAppServerExecution(metadata = {}, options = {}) {
  if (
    metadata.processState === CODEX_APP_SERVER_PROCESS_STATE.STOPPED &&
    metadata.processExitVerifiedAt
  ) {
    return stopCodexAppServerProcessGroup(metadata, options);
  }
  const executionId = normalizeAgentText(metadata.executionId);
  if (executionId) {
    const stopExecution = typeof options.stopExecution === "function"
      ? options.stopExecution
      : stopVibe64Execution;
    let executionStop;
    try {
      executionStop = await stopExecution(executionId, {
        allowMissingRecordScopeRecovery: true,
        killTimeoutMs: options.killTimeoutMs,
        reason: options.reason || "codex-app-server-stop",
        termTimeoutMs: options.termTimeoutMs
      });
    } catch (error) {
      return {
        error: String(error?.message || error || "The owned execution could not be stopped."),
        executionId,
        processExitVerified: false,
        scopeEmpty: false,
        stopped: false
      };
    }
    if (executionStop?.ok === true && executionStop?.scopeEmpty === true) {
      return {
        ...executionStop,
        executionId,
        processExitVerified: true,
        stopped: executionStop.stopped === true
      };
    }
    if (typeof options.stopExecution === "function" || vibe64ManagedExecutionProvider()) {
      return {
        ...(executionStop && typeof executionStop === "object" ? executionStop : {}),
        executionId,
        processExitVerified: false,
        scopeEmpty: false,
        stopped: false
      };
    }
  }
  return stopCodexAppServerProcessGroup(metadata, options);
}

async function stopCodexAppServerProcess(runtimeDir = "", options = {}) {
  const normalizedRuntimeDir = normalizeAgentText(runtimeDir);
  if (!normalizedRuntimeDir) {
    return {
      processExitVerified: false,
      stopped: false
    };
  }
  const metadata = await readCodexAppServerMetadata(normalizedRuntimeDir);
  if (!codexAppServerProcessMetadataIsIdentifiable(metadata, normalizedRuntimeDir)) {
    if (
      options.allowDeadLegacyRuntimeReplacement === true &&
      codexAppServerLegacyProcessExitIsVerified(metadata, normalizedRuntimeDir)
    ) {
      return {
        identityStatus: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.ABSENT,
        legacyRuntime: true,
        processExitVerified: true,
        stopped: false
      };
    }
    return {
      identityStatus: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.INVALID,
      processExitVerified: false,
      stopped: false
    };
  }
  return stopOwnedCodexAppServerExecution(metadata, options);
}

async function removeCodexAppServerMetadataTemps(runtimeDir = "") {
  let names = [];
  try {
    names = await readdir(runtimeDir);
  } catch {
    return;
  }
  await Promise.all(names
    .filter((name) => name.startsWith(`${CODEX_APP_SERVER_METADATA_FILE}.`) && name.endsWith(".tmp"))
    .map((name) => rm(path.join(runtimeDir, name), { force: true })));
}

async function cleanupFailedCodexAppServerStart(runtimeDir = "", {
  economy = false,
  executionId = "",
  neverStarted = false,
  pid = null,
  processIdentity = null
} = {}, options = {}) {
  let processStop = {
    processExitVerified: neverStarted === true,
    scopeEmpty: neverStarted === true,
    stopped: false
  };
  let processCleanupFailed = false;
  if (!neverStarted) {
    try {
      processStop = await stopOwnedCodexAppServerExecution({
        executionId: normalizeAgentText(executionId),
        pid: Number(pid),
        processIdentity,
        processState: CODEX_APP_SERVER_PROCESS_STATE.RUNNING,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        runtimeDir: normalizeAgentText(runtimeDir),
        schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION
      }, options);
    } catch {
      processCleanupFailed = true;
    }
  }
  if (processCleanupFailed || processStop.processExitVerified !== true) {
    return {
      ...processStop,
      cleanupFailed: true
    };
  }
  const economyRemovals = economy
    ? [
        rm(codexAppServerEconomyHomeDir(runtimeDir), { force: true, recursive: true }),
        rm(codexAppServerEconomyWorkspaceDir(runtimeDir), { force: true, recursive: true }),
        rm(codexAppServerLogPath(runtimeDir), { force: true })
      ]
    : [];
  const removals = await Promise.allSettled([
    ...economyRemovals,
    rm(codexAppServerSocketPath(runtimeDir), { force: true }),
    rm(codexAppServerMetadataPath(runtimeDir), { force: true }),
    removeCodexAppServerMetadataTemps(runtimeDir)
  ]);
  return {
    ...processStop,
    cleanupFailed: removals.some(({ status }) => status === "rejected")
  };
}

function codexAppServerRuntimeCleanupCanSkip(error) {
  return ["EACCES", "EPERM", "ENOENT"].includes(String(error?.code || ""));
}

async function stopCodexAppServerRuntime(options = {}) {
  const runtimeDir = normalizeAgentText(options.runtimeDir);
  const preserveProcessExitProof = options.preserveProcessExitProof === true;
  if (!runtimeDir || !codexAppServerRuntimeDirIsManaged(runtimeDir)) {
    return {
      processExitVerified: false,
      runtimeDirPreserved: false,
      runtimeDirRemoved: false,
      stopped: false
    };
  }
  let releaseLock;
  try {
    releaseLock = await acquireRuntimeLock(runtimeDir, options);
  } catch (error) {
    if (!codexAppServerRuntimeCleanupCanSkip(error)) {
      throw error;
    }
    return {
      processExitVerified: false,
      runtimeDirCleanupError: String(error?.message || error || ""),
      runtimeDirCleanupSkipped: String(error?.code || "") !== "ENOENT",
      runtimeDirPreserved: false,
      runtimeDirRemoved: false,
      stopped: false
    };
  }
  let runtimeDirRemoved = false;
  let runtimeDirCleanupSkipped = false;
  let runtimeDirCleanupError = "";
  let runtimeDirPreserved = false;
  let processStop = {
    processExitVerified: false,
    stopped: false
  };
  try {
    const existing = await readCodexAppServerMetadata(runtimeDir);
    const expectedAccount = normalizeAgentText(options.expectedAccountIdentitySignature);
    const ownedRuntime = options.ownedRuntime;
    if (
      ownedRuntime &&
      codexAppServerProcessMetadataIsIdentifiable(ownedRuntime, runtimeDir) &&
      (!expectedAccount || ownedRuntime.accountIdentitySignature === expectedAccount) &&
      (!existing || codexAppServerRuntimeIdentity(existing) !== codexAppServerRuntimeIdentity(ownedRuntime))
    ) {
      // Another owner may already have removed or replaced the shared runtime.
      // Prove this provider's exact execution stopped without touching its successor.
      return {
        ...await stopOwnedCodexAppServerExecution(ownedRuntime, options),
        runtimeDirPreserved: Boolean(existing),
        runtimeDirRemoved: false
      };
    }
    if (!existing) {
      return {
        processExitVerified: false,
        runtimeDirPreserved: false,
        runtimeDirRemoved: false,
        stopped: false
      };
    }
    if (expectedAccount) {
      // A replacement runtime is installed only after the previous process has
      // drained under this same lock. Never stop that replacement for stale
      // ephemeral-thread cleanup.
      if (!codexAppServerProcessMetadataIsIdentifiable(existing, runtimeDir) ||
          !/^sha256:[a-f0-9]{64}$/u.test(existing.accountIdentitySignature)) {
        return { processExitVerified: false, runtimeDirRemoved: false, stopped: false };
      }
      if (existing.accountIdentitySignature !== expectedAccount) {
        return { ownershipSuperseded: true, processExitVerified: false, runtimeDirRemoved: false, stopped: false };
      }
    }
    processStop = await stopCodexAppServerProcess(runtimeDir, options);
    if (processStop.processExitVerified === true && preserveProcessExitProof) {
      const metadata = await readCodexAppServerMetadata(runtimeDir);
      if (!codexAppServerProcessMetadataIsIdentifiable(metadata, runtimeDir)) {
        return {
          ...processStop,
          processExitVerified: false,
          runtimeDirPreserved: false,
          runtimeDirRemoved: false
        };
      }
      await writeCodexAppServerMetadata(runtimeDir, {
        ...metadata,
        processExitVerifiedAt: metadata.processExitVerifiedAt || new Date().toISOString(),
        processState: CODEX_APP_SERVER_PROCESS_STATE.STOPPED
      });
      runtimeDirPreserved = true;
    } else if (processStop.processExitVerified === true) {
      try {
        runtimeDirRemoved = await removeCodexAppServerRuntimeDir(runtimeDir);
      } catch (error) {
        if (!codexAppServerRuntimeCleanupCanSkip(error)) {
          throw error;
        }
        runtimeDirCleanupSkipped = true;
        runtimeDirCleanupError = String(error?.message || error || "");
      }
    }
  } finally {
    await releaseLock();
  }
  return {
    ...processStop,
    runtimeDirCleanupError,
    runtimeDirCleanupSkipped,
    runtimeDirPreserved,
    runtimeDirRemoved
  };
}

function codexAppServerEndpointForTarget(endpoint = "") {
  const normalizedEndpoint = normalizeAgentText(endpoint);
  if (!normalizedEndpoint) {
    return "";
  }
  return normalizedEndpoint;
}

function codexAppServerRuntimeIdentity(runtime = {}) {
  return [
    normalizeAgentText(runtime.accountIdentitySignature),
    normalizeAgentText(runtime.authStateSignature),
    normalizeAgentText(runtime.endpoint),
    normalizeAgentText(runtime.executionId),
    normalizeAgentText(runtime.executionMode),
    normalizeAgentText(runtime.runtimesHash),
    normalizeAgentText(runtime.terminalEnvHash),
    normalizeAgentText(runtime.socketPath),
    normalizeAgentText(runtime.startedAt),
    normalizeAgentText(runtime.pid)
  ].join("\0");
}

function codexAppServerEffectiveRuntimeInput(options = {}) {
  if (!codexAppServerIsEconomy(options)) {
    return {
      project: options.project,
      runtimes: options.runtimes,
      session: options.session,
      terminalEnv: options.terminalEnv,
      toolHomeSource: options.toolHomeSource,
      userKey: options.userKey
    };
  }
  return {
    project: {},
    runtimes: [],
    session: {},
    terminalEnv: {},
    toolHomeSource: "",
    userKey: ""
  };
}

function normalizeCodexAppServerTerminalEnv(terminalEnv = {}) {
  if (!isPlainObject(terminalEnv)) {
    return {};
  }
  return Object.fromEntries(Object.entries(terminalEnv)
    .map(([name, value]) => [
      normalizeAgentText(name),
      String(value ?? "")
    ])
    .filter(([name, value]) => (
      name &&
      String(value || "") &&
      !CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES.has(name)
    )));
}

function codexAppServerThreadRequestParams(params = {}, threadEnv = {}) {
  const source = isPlainObject(params) ? params : {};
  const config = isPlainObject(source.config) ? source.config : {};
  if (Object.hasOwn(config, "shell_environment_policy")) {
    return source;
  }
  return {
    ...source,
    config: {
      ...config,
      shell_environment_policy: {
        inherit: "none",
        set: normalizeCodexAppServerTerminalEnv(threadEnv)
      }
    }
  };
}

function codexAppServerControlGeneration(terminalEnv = {}) {
  const normalized = normalizeCodexAppServerTerminalEnv(terminalEnv);
  const generations = [
    normalized.VIBE64_CODEX_GIT_COMMAND_GENERATION,
    normalized.VIBE64_AGENT_ENV_COMMAND_GENERATION,
    normalized.VIBE64_AGENT_PREVIEW_COMMAND_GENERATION,
    normalized.VIBE64_AGENT_SESSION_COMMAND_GENERATION
  ].map(normalizeAgentText);
  return generations.every(Boolean)
    ? stableHash(JSON.stringify(generations))
    : "";
}

function codexAppServerSessionCommandHookConfig() {
  const command = [
    process.execPath,
    CODEX_APP_SERVER_SESSION_COMMAND_HOOK_PATH
  ].map(shellQuote).join(" ");
  return `hooks.PreToolUse=[{matcher="^Bash$",hooks=[{type="command",command=${JSON.stringify(command)},timeout=30}]}]`;
}

function codexAppServerCommandBaseEnv({
  env = process.env,
  terminalEnv = {}
} = {}) {
  const baseEnv = {
    ...env,
    ...normalizeCodexAppServerTerminalEnv(terminalEnv)
  };
  for (const name of CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES) {
    delete baseEnv[name];
  }
  return baseEnv;
}

function codexAppServerCredentialHome(toolHomeSource = "", baseEnv = {}) {
  const home = normalizeAgentText(toolHomeSource);
  if (!home) {
    return {};
  }
  return {
    home,
    username: normalizeAgentText(baseEnv.USER || baseEnv.LOGNAME)
  };
}

function codexAppServerShimDirs(terminalEnv = {}) {
  const normalizedTerminalEnv = normalizeCodexAppServerTerminalEnv(terminalEnv);
  return withGenesisCommandShim([
    normalizedTerminalEnv[VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV]
  ].map(normalizeAgentText).filter(Boolean));
}

function codexAppServerRuntimes(runtimes = []) {
  const requested = Array.isArray(runtimes) ? runtimes : [];
  const values = [
    ...VIBE64_INTERACTIVE_RUNTIME_PACKS,
    ...requested
  ];
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeAgentText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function codexAppServerRuntimesHash(runtimes = []) {
  return stableHash(JSON.stringify(codexAppServerRuntimes(runtimes)));
}

function codexAppServerEffectiveRuntimesHash(options = {}) {
  if (codexAppServerIsEconomy(options)) {
    return stableHash(JSON.stringify([]));
  }
  return codexAppServerRuntimesHash(options.runtimes);
}

function codexAppServerTerminalEnvHash(terminalEnv = {}) {
  return stableHash(JSON.stringify(Object.entries(normalizeCodexAppServerTerminalEnv(terminalEnv))
    .sort(([left], [right]) => left.localeCompare(right))));
}

function normalizeCodexAppServerContextRecord(value = {}) {
  return isPlainObject(value) ? value : {};
}

function codexAppServerExecutionContextHash({
  project = {},
  session = {},
  userKey = ""
} = {}) {
  return stableHash(JSON.stringify({
    project: normalizeCodexAppServerContextRecord(project),
    session: normalizeCodexAppServerContextRecord(session),
    userKey: normalizeAgentText(userKey)
  }));
}

function normalizeCodexAppServerMetadata(metadata = {}) {
  const normalized = isPlainObject(metadata) ? metadata : {};
  const endpoint = normalizeAgentText(normalized.endpoint);
  return {
    accountIdentitySignature: normalizeAgentText(normalized.accountIdentitySignature),
    attachmentHostRoot: normalizeAgentText(normalized.attachmentHostRoot),
    authStateSignature: normalizeAgentText(normalized.authStateSignature),
    endpoint,
    executionId: normalizeAgentText(normalized.executionId),
    executionMode: normalizeAgentText(normalized.executionMode) || CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
    executionContextHash: normalizeAgentText(normalized.executionContextHash),
    healthz: normalizeAgentText(normalized.healthz),
    logPath: normalizeAgentText(normalized.logPath),
    pid: Number.isSafeInteger(Number(normalized.pid)) ? Number(normalized.pid) : null,
    processCwd: normalizeAgentText(normalized.processCwd),
    processExitVerifiedAt: normalizeAgentText(normalized.processExitVerifiedAt),
    processIdentity: normalizeCodexAppServerProcessIdentity(normalized.processIdentity),
    processState: normalizeAgentText(normalized.processState),
    provider: normalizeAgentText(normalized.provider),
    readyz: normalizeAgentText(normalized.readyz),
    runtimeDir: normalizeAgentText(normalized.runtimeDir),
    runtimesHash: normalizeAgentText(normalized.runtimesHash),
    schemaVersion: Number(normalized.schemaVersion || 0),
    socketPath: normalizeAgentText(normalized.socketPath),
    startedAt: normalizeAgentText(normalized.startedAt),
    terminalEnvHash: normalizeAgentText(normalized.terminalEnvHash),
    toolHomeSource: normalizeAgentText(normalized.toolHomeSource),
    transport: normalizeAgentText(normalized.transport)
  };
}

function codexAppServerMetadataIsWellFormed(metadata = {}, options = {}) {
  const effective = codexAppServerEffectiveRuntimeInput(options);
  const expectedAttachmentHostRoot = codexAttachmentHostRoot({
    env: options.env
  });
  const expectedAccountIdentitySignature = normalizeAgentText(options.accountIdentitySignature);
  const expectedExecutionMode = codexAppServerExecutionMode(options);
  const expectedToolHomeSource = normalizeAgentText(effective.toolHomeSource);
  const expectedTerminalEnvHash = codexAppServerTerminalEnvHash(effective.terminalEnv);
  const expectedRuntimesHash = codexAppServerEffectiveRuntimesHash(options);
  const expectedExecutionContextHash = codexAppServerExecutionContextHash(effective);
  const expectedEconomyProcessCwd = expectedExecutionMode === CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
    ? codexAppServerEconomyWorkspaceDir(metadata.runtimeDir)
    : "";
  return Boolean(
    metadata.schemaVersion === CODEX_APP_SERVER_METADATA_SCHEMA_VERSION &&
    metadata.accountIdentitySignature === expectedAccountIdentitySignature &&
    metadata.attachmentHostRoot === expectedAttachmentHostRoot &&
    metadata.authStateSignature &&
    metadata.executionId &&
    metadata.executionContextHash === expectedExecutionContextHash &&
    metadata.executionMode === expectedExecutionMode &&
    metadata.processCwd &&
    codexAppServerProcessMetadataIsIdentifiable(metadata) &&
    metadata.processState === CODEX_APP_SERVER_PROCESS_STATE.RUNNING &&
    (!expectedEconomyProcessCwd || metadata.processCwd === expectedEconomyProcessCwd) &&
    metadata.provider === CODEX_APP_SERVER_PROVIDER_ID &&
    metadata.runtimesHash === expectedRuntimesHash &&
    metadata.terminalEnvHash === expectedTerminalEnvHash &&
    metadata.toolHomeSource === expectedToolHomeSource &&
    metadata.transport === CODEX_APP_SERVER_TRANSPORT.UNIX &&
    metadata.endpoint &&
    metadata.socketPath
  );
}

async function readCodexAppServerMetadata(runtimeDir = "") {
  try {
    const metadata = JSON.parse(await readFile(codexAppServerMetadataPath(runtimeDir), "utf8"));
    return normalizeCodexAppServerMetadata(metadata);
  } catch {
    return null;
  }
}

async function writeCodexAppServerMetadata(runtimeDir = "", metadata = {}) {
  await ensureWritablePrivateDirectory(runtimeDir);
  const metadataPath = codexAppServerMetadataPath(runtimeDir);
  const tempPath = `${metadataPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(tempPath, 0o600).catch(() => null);
  await rename(tempPath, metadataPath);
  await chmod(metadataPath, 0o600).catch(() => null);
}

async function codexAppServerEndpointStatus(endpoint = "", {
  timeoutMs = CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS,
  WebSocketImpl = WebSocket
} = {}) {
  const normalizedEndpoint = normalizeAgentText(endpoint);
  const socketPath = socketPathFromCodexAppServerEndpoint(normalizedEndpoint);
  if (!socketPath || !await fileExists(socketPath)) {
    return {
      status: CODEX_APP_SERVER_ENDPOINT_STATUS.MISSING
    };
  }
  const normalizedTimeoutMs = normalizePositiveInteger(timeoutMs, CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS);
  const client = new CodexAppServerJsonRpcClient({
    endpoint: normalizedEndpoint,
    requestTimeoutMs: normalizedTimeoutMs,
    WebSocketImpl
  });
  let timeout = null;
  const probe = (async () => {
    await client.connect();
    await client.initialize({ clientInfo: { name: "vibe64", title: "Vibe64", version: CODEX_APP_SERVER_CLIENT_VERSION } });
    return CODEX_APP_SERVER_ENDPOINT_STATUS.RESPONSIVE;
  })();
  probe.catch(() => null);
  try {
    const status = await Promise.race([
      probe,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(CODEX_APP_SERVER_ENDPOINT_STATUS.TIMEOUT), normalizedTimeoutMs);
        timeout.unref?.();
      })
    ]);
    return {
      status
    };
  } catch {
    return {
      status: CODEX_APP_SERVER_ENDPOINT_STATUS.UNREACHABLE
    };
  } finally {
    clearTimeout(timeout);
    client.close();
  }
}

async function codexAppServerMetadataIsLive(metadata = {}, options = {}) {
  return (await codexAppServerRuntimeStatus(metadata, options)).status === CODEX_APP_SERVER_RUNTIME_STATUS.LIVE;
}

function codexAppServerLivenessTimeoutMs(options = {}) {
  return normalizePositiveInteger(
    options.livenessTimeoutMs,
    normalizePositiveInteger(options.timeoutMs, CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS)
  );
}

async function codexAppServerRuntimeStatus(metadata = {}, options = {}) {
  const normalized = normalizeCodexAppServerMetadata(metadata);
  if (
    codexAppServerProcessMetadataIsIdentifiable(normalized) &&
    normalized.processState === CODEX_APP_SERVER_PROCESS_STATE.STOPPED &&
    normalized.processExitVerifiedAt
  ) {
    return {
      metadata: normalized,
      replace: true,
      reusable: false,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.EXITED
    };
  }
  if (!codexAppServerMetadataIsWellFormed(normalized, options)) {
    return {
      metadata: normalized,
      replace: true,
      reusable: false,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.INCOMPATIBLE
    };
  }
  const authStateSignature = await currentCodexAuthStateSignature(options);
  if (normalized.authStateSignature !== authStateSignature) {
    return {
      metadata: normalized,
      replace: true,
      reusable: false,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.INCOMPATIBLE
    };
  }
  let processIdentity = null;
  if (typeof options.processGroupIsAlive === "function") {
    const alive = options.processGroupIsAlive(normalized.pid);
    processIdentity = {
      processGroupIds: alive ? [normalized.pid] : [],
      status: alive
        ? CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.EXACT
        : CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.ABSENT
    };
  } else {
    processIdentity = await inspectCodexAppServerProcessIdentity(normalized, options);
  }
  if (
    processIdentity.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.ABSENT ||
    processIdentity.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.MISMATCH
  ) {
    return {
      metadata: normalized,
      replace: true,
      reusable: false,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.EXITED
    };
  }
  if (processIdentity.status !== CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.EXACT) {
    return {
      metadata: normalized,
      replace: false,
      reusable: true,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.SUSPECT
    };
  }
  const endpoint = await codexAppServerEndpointStatus(normalized.endpoint, {
    timeoutMs: codexAppServerLivenessTimeoutMs(options),
    WebSocketImpl: options.WebSocketImpl
  });
  if (endpoint.status === CODEX_APP_SERVER_ENDPOINT_STATUS.RESPONSIVE) {
    return {
      metadata: normalized,
      replace: false,
      reusable: true,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.LIVE
    };
  }
  if (endpoint.status === CODEX_APP_SERVER_ENDPOINT_STATUS.MISSING) {
    return {
      metadata: normalized,
      replace: true,
      reusable: false,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.MISSING
    };
  }
  if (endpoint.status === CODEX_APP_SERVER_ENDPOINT_STATUS.TIMEOUT) {
    return {
      metadata: normalized,
      replace: false,
      reusable: true,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.SUSPECT
    };
  }
  return {
    metadata: normalized,
    replace: true,
    reusable: false,
    status: CODEX_APP_SERVER_RUNTIME_STATUS.MISSING
  };
}

async function fileExists(filePath = "") {
  try {
    const entry = await stat(filePath);
    return entry.isSocket() || entry.isFile();
  } catch {
    return false;
  }
}

async function tailTextFile(filePath = "", maxBytes = 4096) {
  try {
    const text = await readFile(filePath, "utf8");
    return text.slice(-maxBytes);
  } catch {
    return "";
  }
}

async function readLockOwner(lockDir = "") {
  try {
    return JSON.parse(await readFile(path.join(lockDir, "owner.json"), "utf8"));
  } catch {
    return {};
  }
}

async function lockIsStale(lockDir = "") {
  const owner = await readLockOwner(lockDir);
  if (owner.pid && processIsAlive(owner.pid)) {
    const createdAtMs = Date.parse(owner.createdAt || "");
    return Number.isFinite(createdAtMs) && Date.now() - createdAtMs > CODEX_APP_SERVER_LOCK_STALE_MS;
  }
  return true;
}

async function acquireRuntimeLock(runtimeDir = "", {
  env = process.env,
  timeoutMs = CODEX_APP_SERVER_LOCK_TIMEOUT_MS
} = {}) {
  await prepareCodexAttachmentRoot({
    env
  });
  await ensureWritablePrivateDirectory(runtimeDir);
  const lockDir = codexAppServerLockDir(runtimeDir);
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await mkdir(lockDir, {
        mode: 0o700
      });
      await writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid
      })}\n`, {
        mode: 0o600
      });
      return async () => {
        await rm(lockDir, {
          force: true,
          recursive: true
        });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await lockIsStale(lockDir)) {
        await rm(lockDir, {
          force: true,
          recursive: true
        });
        continue;
      }
      await delay(100);
    }
  }
  const error = new Error("Codex is still reconnecting: its shared runtime is busy starting or stopping. Please try again shortly.");
  error.code = CODEX_APP_SERVER_RUNTIME_BUSY_CODE;
  error.retryable = true;
  throw error;
}

async function waitForCodexAppServer(endpoint = "", {
  timeoutMs = CODEX_APP_SERVER_READY_TIMEOUT_MS,
  WebSocketImpl = WebSocket
} = {}) {
  const socketPath = socketPathFromCodexAppServerEndpoint(endpoint);
  if (!socketPath) {
    return false;
  }
  const startedAt = Date.now();
  while (!await fileExists(socketPath) && Date.now() - startedAt <= timeoutMs) {
    await delay(100);
  }
  const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
  if (!await fileExists(socketPath) || remainingMs <= 0) {
    return false;
  }
  const client = new CodexAppServerJsonRpcClient({
    endpoint,
    requestTimeoutMs: remainingMs,
    WebSocketImpl
  });
  let timeout = null;
  const handshake = (async () => {
    await client.connect();
    await client.initialize({ clientInfo: { name: "vibe64", title: "Vibe64", version: CODEX_APP_SERVER_CLIENT_VERSION } });
    return true;
  })();
  handshake.catch(() => null);
  try {
    return await Promise.race([
      handshake,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), remainingMs);
        timeout.unref?.();
      })
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    client.close();
  }
}

function codexAppServerProcessCommandHash({
  codexArgs = [],
  codexCommand = "",
  executionMode = "",
  processCwd = "",
  runtimeDir = ""
} = {}) {
  return stableHash(JSON.stringify({
    codexArgs,
    codexCommand: normalizeAgentText(codexCommand),
    executionMode: codexAppServerExecutionMode({ executionMode }),
    processCwd: normalizeAgentText(processCwd),
    runtimeDir: normalizeAgentText(runtimeDir)
  }));
}

async function captureCodexAppServerProcessIdentity({
  commandHash = "",
  pid = null,
  reportedIdentity = null,
  runtimeToken = ""
} = {}) {
  const expectedCommandHash = normalizeAgentText(commandHash);
  const expectedRuntimeToken = normalizeAgentText(runtimeToken);
  const reported = normalizeCodexAppServerProcessIdentity(reportedIdentity);
  if (
    codexAppServerProcessIdentityIsWellFormed(reported) &&
    reported.commandHash === expectedCommandHash &&
    reported.runtimeToken === expectedRuntimeToken
  ) {
    return reported;
  }
  const normalizedPid = Number(pid);
  if (
    process.platform !== "linux" ||
    !Number.isSafeInteger(normalizedPid) ||
    normalizedPid <= 0
  ) {
    const error = new Error("Codex app-server process identity could not be captured.");
    error.code = "vibe64_codex_app_server_process_identity_unavailable";
    throw error;
  }
  const processStat = linuxProcessStat(
    await readFile(`/proc/${normalizedPid}/stat`, "utf8").catch(() => "")
  );
  if (!processStat || processStat.processGroupId !== normalizedPid) {
    const error = new Error("Codex app-server process identity could not be captured.");
    error.code = "vibe64_codex_app_server_process_identity_unavailable";
    throw error;
  }
  return {
    commandHash: expectedCommandHash,
    platform: CODEX_APP_SERVER_PROCESS_IDENTITY_PLATFORM,
    runtimeToken: expectedRuntimeToken,
    startTimeTicks: processStat.startTimeTicks,
    version: CODEX_APP_SERVER_PROCESS_IDENTITY_VERSION
  };
}

async function startCodexAppServerProcess({
  accountIdentitySignature = "",
  authStateSignature = "",
  codexCommand = STUDIO_MANAGED_CODEX_COMMAND,
  commandRunner = defaultCommandRunner,
  env = process.env,
  executionRoot = "",
  executionMode = CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
  killTimeoutMs = 0,
  processIdentityInspector = null,
  readyTimeoutMs = CODEX_APP_SERVER_READY_TIMEOUT_MS,
  signalProcessGroup: signalProcessGroupOverride = null,
  stopExecution = null,
  systemRoot = "",
  project = {},
  session = {},
  terminalEnv = {},
  termTimeoutMs = 0,
  toolHomeSource = "",
  userKey = "",
  WebSocketImpl = WebSocket,
  workdir = "",
  runtimeInstanceId = "",
  runtimes = [],
  socketOwnerDrained = false,
  runtimeDir = codexAppServerRuntimeDir({
    env,
    executionRoot,
    runtimeInstanceId,
    workdir
  })
} = {}) {
  const processLifecycleOptions = {
    killTimeoutMs,
    processIdentityInspector,
    signalProcessGroup: signalProcessGroupOverride,
    stopExecution,
    termTimeoutMs
  };
  await ensureWritablePrivateDirectory(runtimeDir);
  const economy = codexAppServerExecutionMode({ executionMode }) ===
    CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY;
  const normalizedToolHomeSource = normalizeAgentText(toolHomeSource);
  if (normalizedToolHomeSource) {
    await assertExistingDirectory(normalizedToolHomeSource, "Codex credential home");
  }
  const resolvedAuthStateSignature = await currentCodexAuthStateSignature({
    authStateSignature,
    env,
    systemRoot
  });
  await assertCodexAuthGenerationCurrent(resolvedAuthStateSignature, {
    systemRoot
  });
  const socketPath = codexAppServerSocketPath(runtimeDir);
  assertCodexAppServerSocketPathSupported(socketPath);
  const endpoint = codexAppServerUnixEndpoint(socketPath);
  const logPath = codexAppServerLogPath(runtimeDir);
  const economyHome = economy ? codexAppServerEconomyHomeDir(runtimeDir) : "";
  const economyWorkspace = economy ? codexAppServerEconomyWorkspaceDir(runtimeDir) : "";
  if (economy) {
    await Promise.all([
      rm(economyHome, { force: true, recursive: true }),
      rm(economyWorkspace, { force: true, recursive: true })
    ]);
    await Promise.all([
      ensureWritablePrivateDirectory(economyHome),
      ensureWritablePrivateDirectory(economyWorkspace)
    ]);
  }
  const processCwd = economy
    ? economyWorkspace
    : codexAppServerProcessCwd({
        executionRoot,
        runtimeDir,
        workdir
      });
  const projectTrustOverride = economy ? "" : codexAppServerProjectTrustOverride(workdir);
  const normalizedTerminalEnv = normalizeCodexAppServerTerminalEnv(economy ? {} : terminalEnv);
  const normalizedRuntimes = codexAppServerRuntimes(economy ? [] : runtimes);
  const commandBaseEnv = economy
    ? codexAppServerEconomyCommandBaseEnv(env, economyHome)
    : codexAppServerCommandBaseEnv({
        env,
        terminalEnv: normalizedTerminalEnv
      });
  if (await fileExists(socketPath) && !socketOwnerDrained) {
    const endpointStatus = await codexAppServerEndpointStatus(endpoint, {
      timeoutMs: CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS,
      WebSocketImpl
    });
    if (![CODEX_APP_SERVER_ENDPOINT_STATUS.MISSING, CODEX_APP_SERVER_ENDPOINT_STATUS.UNREACHABLE]
      .includes(endpointStatus.status)) {
      const error = new Error("The existing Codex app-server socket still has an unretired owner.");
      error.code = "vibe64_codex_app_server_socket_owner_unverified";
      error.retryable = false;
      throw error;
    }
  }
  await rm(socketPath, {
    force: true
  });
  const codexArgs = [
    // App-server uses config overrides, not the top-level sandbox bypass flag.
    ...(economy ? [] : [
      "-c",
      'approval_policy="never"',
      "-c",
      'sandbox_mode="danger-full-access"',
      "--dangerously-bypass-hook-trust",
      "-c",
      "features.hooks=true",
      "-c",
      codexAppServerSessionCommandHookConfig()
    ]),
    "-c",
    STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
    ...(projectTrustOverride
      ? [
          "-c",
          projectTrustOverride
        ]
      : []),
    "app-server",
    "--listen",
    endpoint
  ];
  const runtimeToken = randomUUID();
  const commandHash = codexAppServerProcessCommandHash({
    codexArgs,
    codexCommand,
    executionMode,
    processCwd,
    runtimeDir
  });
  const baseEnv = {
    ...commandBaseEnv,
    [CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV]: commandHash,
    [CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV]: runtimeToken
  };
  const profileBinary = path.isAbsolute(codexCommand) ? await stat(codexCommand).catch(() => null) : null;
  const startResult = await commandRunner({
    actor: "app",
    allowedRoots: processCwd ? [processCwd] : [],
    args: [
      "-c",
      economy ? CODEX_APP_SERVER_ECONOMY_STARTUP_SCRIPT : CODEX_APP_SERVER_MANAGED_STARTUP_SCRIPT,
      "vibe64-codex-app-server",
      codexCommand,
      ...codexArgs
    ],
    baseEnv,
    command: CODEX_APP_SERVER_MANAGED_SHELL,
    credentialHome: codexAppServerCredentialHome(
      economy ? economyHome : normalizedToolHomeSource,
      baseEnv
    ),
    cwd: processCwd || process.cwd(),
    envPolicy: "auth",
    execution: {
      controlGenerationId: economy ? "" : codexAppServerControlGeneration(normalizedTerminalEnv),
      kind: "assistant",
      label: "Codex assistant",
      lifecycle: "service",
      operationId: "codex-app-server",
      ...(profileBinary?.isFile() ? { resourceProfile: {
        key: economy ? "codex-economy" : "codex-app-server",
        environment: "development",
        compatibilityKey: createHash("sha256").update(JSON.stringify({
          command: codexCommand, economy, executionMode, runtimes: normalizedRuntimes,
          binary: [profileBinary.dev, profileBinary.ino, profileBinary.size, profileBinary.mtimeMs, profileBinary.ctimeMs],
          platform: process.platform, architecture: process.arch,
          startup: economy ? CODEX_APP_SERVER_ECONOMY_STARTUP_SCRIPT : CODEX_APP_SERVER_MANAGED_STARTUP_SCRIPT
        })).digest("hex")
      } } : {}),
      ownerId: normalizeAgentText(runtimeInstanceId || session?.sessionId || session?.id) ||
        stableHash(runtimeDir)
    },
    logPath,
    inheritProcessEnv: false,
    mode: "detached",
    project: economy ? {} : project,
    purpose: "codex",
    runtimes: normalizedRuntimes,
    session: economy ? {} : session,
    shimDirs: economy ? [] : codexAppServerShimDirs(normalizedTerminalEnv),
    timeout: readyTimeoutMs,
    userKey: economy ? "" : normalizeAgentText(userKey)
  });
  if (!startResult.ok) {
    const failedProcessIdentity = await captureCodexAppServerProcessIdentity({
      commandHash,
      pid: startResult.pid,
      reportedIdentity: startResult.processIdentity,
      runtimeToken
    }).catch(() => null);
    const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
      economy,
      executionId: startResult.execution?.id,
      neverStarted: !Number.isSafeInteger(Number(startResult.pid)),
      pid: startResult.pid,
      processIdentity: failedProcessIdentity
    }, processLifecycleOptions);
    const error = new Error(
      startResult.output || startResult.error ||
      (economy ? "Codex isolated economy runtime failed to start." : "Codex app-server failed to start.")
    );
    error.code = cleanup.cleanupFailed
      ? (economy
          ? "vibe64_codex_economy_runtime_cleanup_required"
          : "vibe64_codex_app_server_cleanup_required")
      : (startResult.code || (economy
          ? "vibe64_codex_economy_runtime_start_failed"
          : "vibe64_codex_app_server_start_failed"));
    error.cleanupRequired = cleanup.cleanupFailed;
    error.execution = startResult.execution;
    error.retryable = cleanup.cleanupFailed ? false : startResult.retryable === true;
    throw error;
  }

  let processIdentity;
  try {
    processIdentity = await captureCodexAppServerProcessIdentity({
      commandHash,
      pid: startResult.pid,
      reportedIdentity: startResult.processIdentity,
      runtimeToken
    });
  } catch (cause) {
    const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
      economy,
      executionId: startResult.execution?.id,
      pid: startResult.pid,
      processIdentity: startResult.processIdentity
    }, processLifecycleOptions);
    const error = new Error("Codex app-server process ownership could not be recorded.", {
      cause
    });
    error.code = cleanup.cleanupFailed
      ? "vibe64_codex_app_server_cleanup_required"
      : "vibe64_codex_app_server_process_identity_unavailable";
    error.cleanupRequired = cleanup.cleanupFailed;
    throw error;
  }

  const ready = await waitForCodexAppServer(endpoint, {
    timeoutMs: readyTimeoutMs,
    WebSocketImpl
  });
  if (!ready) {
    const logTail = await tailTextFile(logPath);
    const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
      economy,
      executionId: startResult.execution?.id,
      pid: startResult.pid,
      processIdentity
    }, processLifecycleOptions);
    if (!cleanup.cleanupFailed && !economy && codexAuthOutputRequiresReconnect(logTail)) {
      await markCodexAppServerReconnectRequired({
        env,
        systemRoot,
        toolHomeSource: normalizedToolHomeSource
      }, {
        observed: logTail,
        reason: "codex-app-server-start"
      });
    }
    const error = new Error([
      economy
        ? "Codex isolated economy runtime did not become ready."
        : `Codex app-server did not become ready at ${endpoint}.`,
      logTail ? `Recent log output:\n${logTail}` : ""
    ].filter(Boolean).join("\n"));
    error.code = cleanup.cleanupFailed
      ? (economy
          ? "vibe64_codex_economy_runtime_cleanup_required"
          : "vibe64_codex_app_server_cleanup_required")
      : (economy
          ? "vibe64_codex_economy_runtime_start_failed"
          : "vibe64_codex_app_server_ready_timeout");
    error.cleanupRequired = cleanup.cleanupFailed;
    error.retryable = false;
    throw error;
  }

  try {
    await assertCodexAuthGenerationCurrent(resolvedAuthStateSignature, {
      systemRoot
    });
  } catch (cause) {
    const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
      economy,
      executionId: startResult.execution?.id,
      pid: startResult.pid,
      processIdentity
    }, processLifecycleOptions);
    if (cleanup.cleanupFailed) {
      const error = new Error("Codex app-server authentication changed and its execution could not be drained.", {
        cause
      });
      error.code = "vibe64_codex_app_server_cleanup_required";
      error.cleanupRequired = true;
      error.retryable = false;
      throw error;
    }
    throw cause;
  }

  return {
    accountIdentitySignature: normalizeAgentText(accountIdentitySignature),
    attachmentHostRoot: codexAttachmentHostRoot({
      env
    }),
    authStateSignature: resolvedAuthStateSignature,
    endpoint,
    executionId: normalizeAgentText(startResult.execution?.id),
    executionMode: economy
      ? CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
      : CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
    executionContextHash: codexAppServerExecutionContextHash({
      project: economy ? {} : project,
      session: economy ? {} : session,
      userKey: economy ? "" : userKey
    }),
    healthz: "",
    logPath,
    pid: Number.isSafeInteger(Number(startResult.pid)) ? Number(startResult.pid) : null,
    processCwd,
    processIdentity,
    processState: CODEX_APP_SERVER_PROCESS_STATE.RUNNING,
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    readyz: "",
    runtimeDir,
    runtimesHash: economy
      ? codexAppServerEffectiveRuntimesHash({ executionMode })
      : codexAppServerRuntimesHash(normalizedRuntimes),
    schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
    socketPath,
    startedAt: new Date().toISOString(),
    terminalEnvHash: codexAppServerTerminalEnvHash(normalizedTerminalEnv),
    toolHomeSource: economy ? "" : normalizedToolHomeSource,
    transport: CODEX_APP_SERVER_TRANSPORT.UNIX
  };
}

const codexAppServerRuntimePreparations = new Map();

async function ensureCodexAppServerRuntime(options = {}) {
  const runtimeDir = path.resolve(options.runtimeDir || codexAppServerRuntimeDir(options));
  while (codexAppServerRuntimePreparations.has(runtimeDir)) {
    await codexAppServerRuntimePreparations.get(runtimeDir);
  }
  // Each waiter rechecks its own auth and runtime configuration after startup.
  const operation = prepareCodexAppServerRuntime({ ...options, runtimeDir });
  codexAppServerRuntimePreparations.set(runtimeDir, operation);
  try {
    return await operation;
  } finally {
    codexAppServerRuntimePreparations.delete(runtimeDir);
  }
}

async function prepareCodexAppServerRuntime(options) {
  const { runtimeDir } = options;
  const [accountIdentitySignature, authStateSignature] = await Promise.all([
    currentCodexAccountIdentitySignature(options),
    currentCodexAuthStateSignature(options)
  ]);
  const runtimeOptions = {
    ...options,
    accountIdentitySignature,
    authStateSignature
  };
  const runtimeMetadataWriter = typeof options.runtimeMetadataWriter === "function"
    ? options.runtimeMetadataWriter
    : writeCodexAppServerMetadata;
  await ensureWritablePrivateDirectory(runtimeDir);

  const existing = await readCodexAppServerMetadata(runtimeDir);
  const existingStatus = existing ? await codexAppServerRuntimeStatus(existing, runtimeOptions) : null;
  if (existingStatus?.reusable) {
    return {
      ...existingStatus.metadata,
      reused: true,
      runtimeStatus: existingStatus.status
    };
  }

  const releaseLock = await acquireRuntimeLock(runtimeDir, runtimeOptions);
  try {
    let socketOwnerDrained = false;
    const afterLock = await readCodexAppServerMetadata(runtimeDir);
    const afterLockStatus = afterLock ? await codexAppServerRuntimeStatus(afterLock, runtimeOptions) : null;
    if (afterLockStatus?.reusable) {
      return {
        ...afterLockStatus.metadata,
        reused: true,
        runtimeStatus: afterLockStatus.status
      };
    }

    if (afterLock && (!afterLockStatus || afterLockStatus.replace !== false)) {
      const stopped = await stopCodexAppServerProcess(runtimeDir, {
        ...runtimeOptions,
        allowDeadLegacyRuntimeReplacement: true
      });
      if (stopped.processExitVerified !== true) {
        const error = new Error(
          "Vibe64 found an earlier Codex app-server but could not prove that its owned execution was stopped. It refused to start a replacement because two assistant processes could damage the session or worsen resource pressure."
        );
        error.code = "vibe64_codex_app_server_process_identity_unverified";
        error.cleanupRequired = true;
        error.retryable = false;
        throw error;
      }
      socketOwnerDrained = true;
    }

    const started = await startCodexAppServerProcess({
      ...runtimeOptions,
      runtimeDir,
      socketOwnerDrained
    });
    try {
      await assertCodexAuthGenerationCurrent(started.authStateSignature, runtimeOptions);
      await runtimeMetadataWriter(runtimeDir, started);
      await assertCodexAuthGenerationCurrent(started.authStateSignature, runtimeOptions);
    } catch (error) {
      const economy = codexAppServerIsEconomy(runtimeOptions);
      const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
        economy,
        executionId: started.executionId,
        pid: started.pid,
        processIdentity: started.processIdentity
      }, runtimeOptions);
      const failure = new Error(
        economy
          ? "Codex isolated economy runtime metadata could not be recorded."
          : "Codex app-server runtime could not be published safely.",
        { cause: error }
      );
      failure.code = cleanup.cleanupFailed
        ? (economy
            ? "vibe64_codex_economy_runtime_cleanup_required"
            : "vibe64_codex_app_server_cleanup_required")
        : (error?.code || (economy
            ? "vibe64_codex_economy_runtime_metadata_failed"
            : "vibe64_codex_app_server_metadata_failed"));
      failure.cleanupRequired = cleanup.cleanupFailed;
      failure.retryable = false;
      throw failure;
    }
    return {
      ...started,
      reused: false
    };
  } finally {
    await releaseLock();
  }
}

function codexTextInput(text = "") {
  return {
    text: String(text ?? ""),
    text_elements: [],
    type: "text"
  };
}

function codexTurnInput(input = []) {
  const values = Array.isArray(input) ? input : [input];
  return values.map((item) => {
    if (isPlainObject(item) && item.type === "localImage" && typeof item.path === "string") {
      return { type: "localImage", path: item.path };
    }
    if (isPlainObject(item) && item.type === "text") {
      return codexTextInput(item.text);
    }
    return codexTextInput(item);
  });
}

function shellQuote(value = "") {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}

function codexCliResumeCommand({
  codexCommand = "",
  endpoint = "",
  threadId = ""
} = {}) {
  const normalizedEndpoint = codexAppServerEndpointForTarget(endpoint);
  const resolvedCodexCommand = normalizeAgentText(codexCommand) || STUDIO_MANAGED_CODEX_COMMAND;
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedEndpoint) {
    throw new Error("Codex app-server endpoint is required for the native CLI command.");
  }
  if (!normalizedThreadId) {
    throw new Error("Codex thread id is required for the native CLI command.");
  }
  const argv = [
    resolvedCodexCommand,
    "-c",
    STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
    "--remote",
    normalizedEndpoint,
    "resume",
    normalizedThreadId
  ];
  return {
    argv,
    command: argv.map(shellQuote).join(" ")
  };
}

function codexAppServerThreadInventoryError(errorCode, label, detail) {
  const error = new Error(`Codex ${label} thread inventory ${detail}.`);
  error.code = errorCode;
  return error;
}

async function listBoundedCodexAppServerThreadIds({
  archived = false,
  client,
  cwd = "",
  errorCode = "",
  label = "",
  requestLabel = "",
  runRequest,
  signal = null,
  state,
  verifyCwd = false
} = {}) {
  const seenCursors = new Set();
  let cursor = "";
  for (let page = 0; page < CODEX_APP_SERVER_THREAD_INVENTORY_MAX_PAGES; page += 1) {
    if (cursor && seenCursors.has(cursor)) {
      throw codexAppServerThreadInventoryError(
        errorCode,
        label,
        "repeated a pagination cursor"
      );
    }
    if (cursor) {
      seenCursors.add(cursor);
    }
    const response = await runRequest(
      () => client.request("thread/list", {
        archived,
        ...(cursor ? { cursor } : {}),
        cwd,
        limit: CODEX_APP_SERVER_THREAD_INVENTORY_PAGE_LIMIT,
        sourceKinds: ["appServer"],
        useStateDbOnly: false
      }, { signal }),
      requestLabel
    );
    if (
      !Array.isArray(response?.data) ||
      response.data.length > CODEX_APP_SERVER_THREAD_INVENTORY_PAGE_LIMIT ||
      state.entryCount + response.data.length > CODEX_APP_SERVER_THREAD_INVENTORY_MAX_COUNT
    ) {
      throw codexAppServerThreadInventoryError(
        errorCode,
        label,
        "exceeded its entry limit"
      );
    }
    for (const entry of response.data) {
      const threadId = normalizeAgentText(entry?.id);
      const threadCwd = normalizeAgentText(entry?.cwd);
      let entryBytes = 0;
      try {
        entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
      } catch {
        entryBytes = CODEX_APP_SERVER_THREAD_INVENTORY_MAX_ENTRY_BYTES + 1;
      }
      if (
        !isPlainObject(entry) ||
        !threadId ||
        threadId.length > CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH ||
        codexAppServerTextHasControlCharacters(threadId) ||
        (verifyCwd && threadCwd !== cwd) ||
        entryBytes > CODEX_APP_SERVER_THREAD_INVENTORY_MAX_ENTRY_BYTES ||
        state.totalBytes + entryBytes > CODEX_APP_SERVER_THREAD_INVENTORY_MAX_TOTAL_BYTES
      ) {
        throw codexAppServerThreadInventoryError(
          errorCode,
          label,
          "contained an invalid entry"
        );
      }
      state.entryCount += 1;
      state.totalBytes += entryBytes;
      state.threadIds.add(threadId);
    }
    const nextCursor = response.nextCursor === undefined || response.nextCursor === null || response.nextCursor === ""
      ? ""
      : typeof response.nextCursor === "string"
        ? response.nextCursor.trim()
        : null;
    if (
      nextCursor === null ||
      nextCursor.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH ||
      (nextCursor && seenCursors.has(nextCursor))
    ) {
      throw codexAppServerThreadInventoryError(
        errorCode,
        label,
        "returned an invalid pagination cursor"
      );
    }
    if (!nextCursor) {
      return state;
    }
    cursor = nextCursor;
  }
  throw codexAppServerThreadInventoryError(
    errorCode,
    label,
    "exceeded its page limit"
  );
}

function codexPlanUsage(limits = {}) {
  if (limits?.limitId && limits.limitId !== "codex") return { status: "unavailable", windows: [], checkedAt: Date.now() };
  const windows = ["primary", "secondary"].flatMap((id) => {
    const value = limits?.[id];
    if (typeof value?.usedPercent !== "number" || !Number.isFinite(value.usedPercent) || value.usedPercent < 0) return [];
    return [{
      id,
      remainingPercent: Math.max(0, 100 - Math.min(100, value.usedPercent)),
      windowDurationMins: Number.isInteger(value.windowDurationMins) && value.windowDurationMins > 0 ? value.windowDurationMins : null,
      resetsAt: Number.isSafeInteger(value.resetsAt) && value.resetsAt > 0 ? value.resetsAt : null
    }];
  });
  return { status: windows.length ? "available" : "unavailable", windows, checkedAt: Date.now() };
}

class CodexAppServerAgentProvider {
  constructor(options = {}) {
    this.planUsage = null;
    this.planUsagePending = null;
    this.planUsageAuthGeneration = 0;
    this.availabilityPromise = null;
    this.options = options;
    this.client = null;
    this.connectPromise = null;
    this.connectionGeneration = 0;
    this.notificationSubscribers = new Set();
    this.economyAuth = null;
    this.economyAuthBlocked = false;
    this.initializeResult = null;
    this.runtime = null;
    this.runtimeStopOwner = null;
    this.runtimePromise = null;
    this.serverRequestHandler = null;
    this.threadEnvironments = new Map();
    this.threadEnvironmentTasks = new Map();
    this.goalChanges = new Map();
    this.threadEnvironmentGeneration = 0;
    this.threadControlProbes = new Map();
  }

  isEconomyProvider() {
    return codexAppServerIsEconomy(this.options);
  }

  async selectedEconomyAuth() {
    if (!this.isEconomyProvider()) {
      return null;
    }
    return readCodexSelectedAccountAuth(this.options);
  }

  async assertEconomyAccountIdentityCurrent() {
    if (!this.isEconomyProvider() || !this.economyAuth) {
      return;
    }
    if (this.economyAuthBlocked) {
      throw codexAppServerEconomyAuthError(
        "vibe64_codex_economy_auth_changed",
        "The selected Codex account changed during economy work. Retry the task with the current account."
      );
    }
    const current = await this.selectedEconomyAuth();
    if (current.identitySignature !== this.economyAuth.identitySignature) {
      this.economyAuthBlocked = true;
      throw codexAppServerEconomyAuthError(
        "vibe64_codex_economy_auth_changed",
        "The selected Codex account changed during economy work. Retry the task with the current account."
      );
    }
  }

  async authenticateEconomyClient(client, runtime = {}) {
    if (!this.isEconomyProvider()) {
      return null;
    }
    const auth = await this.selectedEconomyAuth();
    if (
      !runtime.accountIdentitySignature ||
      auth.identitySignature !== runtime.accountIdentitySignature
    ) {
      throw codexAppServerEconomyAuthError(
        "vibe64_codex_economy_auth_changed",
        "The selected Codex account changed while economy execution was starting. Retry the task."
      );
    }
    this.economyAuth = auth;
    this.economyAuthBlocked = false;
    try {
      const login = await client.request(
        "account/login/start",
        codexAppServerEconomyLoginParams(auth)
      );
      if (normalizeAgentText(login?.type) !== codexAppServerEconomyLoginResponseType(auth)) {
        throw new Error("invalid login response");
      }
      const account = await client.request("account/read", {
        refreshToken: false
      });
      if (
        account?.requiresOpenaiAuth !== true ||
        normalizeAgentText(account?.account?.type) !== codexAppServerEconomyAccountType(auth)
      ) {
        throw new Error("invalid account response");
      }
      return auth;
    } catch {
      this.economyAuth = null;
      this.economyAuthBlocked = true;
      throw codexAppServerEconomyAuthError(
        "vibe64_codex_economy_auth_unavailable",
        "Codex could not activate the selected account for isolated economy work. Reconnect Codex and retry."
      );
    }
  }

  async refreshEconomyChatgptAuth(params = {}) {
    const currentAuth = this.economyAuth;
    const previousAccountId = params.previousAccountId;
    if (
      !this.isEconomyProvider() ||
      currentAuth?.authMode !== "chatgpt" ||
      params.reason !== "unauthorized" ||
      typeof previousAccountId !== "string" ||
      previousAccountId.length === 0 ||
      previousAccountId.length > CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH ||
      previousAccountId !== currentAuth.accountId
    ) {
      this.economyAuthBlocked = true;
      throw codexAppServerEconomyAuthError(
        "vibe64_codex_economy_auth_refresh_rejected",
        "Codex economy authentication refresh was rejected. Reconnect Codex and retry."
      );
    }
    const refreshed = await this.selectedEconomyAuth();
    if (
      refreshed.authMode !== "chatgpt" ||
      refreshed.identitySignature !== currentAuth.identitySignature
    ) {
      this.economyAuthBlocked = true;
      throw codexAppServerEconomyAuthError(
        "vibe64_codex_economy_auth_changed",
        "The selected Codex account changed during economy work. Retry the task with the current account."
      );
    }
    if (refreshed.secretSignature === currentAuth.secretSignature) {
      this.economyAuthBlocked = true;
      throw codexAppServerEconomyAuthError(
        "vibe64_codex_economy_auth_refresh_pending",
        "The selected Codex account has not produced a newer access token yet. Reconnect Codex and retry."
      );
    }
    this.economyAuth = refreshed;
    return {
      accessToken: refreshed.accessToken,
      chatgptAccountId: refreshed.accountId,
      chatgptPlanType: refreshed.planType || null
    };
  }

  async handleServerRequest(request = {}) {
    if (
      this.isEconomyProvider() &&
      request.method === CODEX_APP_SERVER_CHATGPT_REFRESH_METHOD
    ) {
      return this.refreshEconomyChatgptAuth(request.params);
    }
    if (this.isEconomyProvider()) {
      const error = new Error("Codex isolated economy execution does not accept server requests.");
      error.code = -32601;
      throw error;
    }
    if (typeof this.serverRequestHandler === "function") {
      return this.serverRequestHandler(request);
    }
    const error = new Error("Codex app-server request is not supported by this client.");
    error.code = -32601;
    throw error;
  }

  async ensureRuntime() {
    if (this.runtimePromise) {
      return this.runtimePromise;
    }
    const operation = this.prepareRuntime();
    this.runtimePromise = operation;
    try {
      return await operation;
    } finally {
      if (this.runtimePromise === operation) {
        this.runtimePromise = null;
      }
    }
  }

  async prepareRuntime() {
    const previousRuntime = this.runtime;
    const nextRuntime = await ensureCodexAppServerRuntime(this.options);
    if (
      this.client &&
      previousRuntime &&
      codexAppServerRuntimeIdentity(previousRuntime) !== codexAppServerRuntimeIdentity(nextRuntime)
    ) {
      this.client.close();
      this.client = null;
      this.initializeResult = null;
    }
    this.runtime = nextRuntime;
    this.runtimeStopOwner = nextRuntime;
    await this.assertRuntimeAuthReady("codex-app-server-runtime");
    return this.runtime;
  }

  async preflightAuth(reason = "codex-auth-preflight") {
    await this.assertRuntimeAuthReady(reason);
    try {
      return await assertCodexAuthPreflightReady(this.options, {
        reason
      });
    } catch (error) {
      if (error?.code === CODEX_RECONNECT_REQUIRED_CODE && this.runtime?.runtimeDir) {
        await this.stopRuntimeAndRequireDrain(reason);
      }
      throw error;
    }
  }

  async assertRuntimeAuthReady(reason = "codex-app-server") {
    if (this.isEconomyProvider()) {
      return;
    }
    const runtime = this.runtime || {};
    let generationError = null;
    try {
      await assertCodexAuthGenerationCurrent(runtime.authStateSignature, this.options);
    } catch (error) {
      generationError = error;
    }
    const logTail = await tailTextFile(runtime.logPath || "");
    const reconnectRequired = codexAuthOutputRequiresReconnect(logTail);
    if (!generationError && !reconnectRequired) {
      return;
    }
    await this.stopRuntimeAndRequireDrain(reason);
    if (reconnectRequired) {
      await markCodexAppServerReconnectRequired({
        ...this.options,
        toolHomeSource: runtime.toolHomeSource || this.options.toolHomeSource
      }, {
        observed: logTail,
        reason
      });
      throw codexReconnectRequiredError({
        observed: logTail
      });
    }
    throw generationError;
  }

  async runRequest(operation, reason = "codex-app-server-request") {
    try {
      await this.assertEconomyAccountIdentityCurrent();
      const result = await operation();
      await this.assertEconomyAccountIdentityCurrent();
      await this.assertRuntimeAuthReady(reason);
      return result;
    } catch (error) {
      if (this.isEconomyProvider()) {
        throw codexAppServerEconomyRequestError(error, reason);
      }
      const observed = [
        error?.message || "",
        error?.observed || "",
        await tailTextFile(this.runtime?.logPath || "")
      ].filter(Boolean).join("\n");
      if (codexAuthOutputRequiresReconnect(observed)) {
        const runtime = this.runtime || {};
        if (runtime.runtimeDir) {
          await this.stopRuntimeAndRequireDrain(reason);
        }
        await markCodexAppServerReconnectRequired({
          ...this.options,
          toolHomeSource: runtime.toolHomeSource || this.options.toolHomeSource
        }, {
          observed,
          reason
        });
      }
      throw error;
    }
  }

  async stopRuntimeAndRequireDrain(reason = "codex-app-server-stop") {
    const result = await this.stopRuntime({
      preserveProcessExitProof: !this.isEconomyProvider()
    });
    if (
      result?.processExitVerified === true ||
      result?.runtimeDirRemoved === true ||
      result?.stopped === true
    ) {
      return result;
    }
    const error = new Error("Codex app-server execution could not be proven empty.");
    error.code = this.isEconomyProvider()
      ? "vibe64_codex_economy_runtime_cleanup_required"
      : "vibe64_codex_app_server_cleanup_required";
    error.cleanupRequired = true;
    error.reason = normalizeAgentText(reason);
    error.retryable = false;
    throw error;
  }

  async connect() {
    if (this.observationFailure) throw this.observationFailure;
    if (this.client?.isOpen?.() && this.runtime) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    const operation = this.openConnection();
    this.connectPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.connectPromise === operation) {
        this.connectPromise = null;
      }
    }
  }

  async openConnection() {
    if (this.client?.isOpen?.() && this.runtime) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    const runtime = await this.ensureRuntime();
    if (this.client?.isOpen?.()) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime
      };
    }
    this.client?.close?.();
    this.client = null;
    this.initializeResult = null;
    const client = new CodexAppServerJsonRpcClient({
      endpoint: runtime.endpoint,
      onDisconnect: (error) => {
        if (this.client === client) this.failObservation(error);
      },
      ...(this.isEconomyProvider()
        ? { maxMessageBytes: CODEX_APP_SERVER_ECONOMY_MAX_MESSAGE_BYTES }
        : {}),
      requestTimeoutMs: this.options.requestTimeoutMs,
      WebSocketImpl: this.options.WebSocketImpl
    });
    client.setRequestHandler((request) => this.handleServerRequest(request));
    let initializeResult = null;
    try {
      await client.connect();
      initializeResult = await this.runRequest(
        () => client.initialize({ clientInfo: { name: "vibe64", title: "Vibe64", version: CODEX_APP_SERVER_CLIENT_VERSION }, ...this.options.initialize }),
        "codex-app-server-initialize"
      );
      await this.authenticateEconomyClient(client, runtime);
    } catch (error) {
      client.close();
      if (!runtime.runtimeDir) {
        throw error;
      }
      const economy = this.isEconomyProvider();
      const cleanup = await cleanupFailedCodexAppServerStart(runtime.runtimeDir, {
        economy,
        executionId: runtime.executionId,
        pid: runtime.pid,
        processIdentity: runtime.processIdentity
      }, this.options);
      this.runtimeStopOwner = cleanup.processExitVerified === true
        ? {
          ...runtime,
          processExitVerifiedAt: new Date().toISOString(),
          processState: CODEX_APP_SERVER_PROCESS_STATE.STOPPED
        }
        : runtime;
      this.runtime = null;
      if (economy) {
        this.economyAuth = null;
        this.economyAuthBlocked = true;
      }
      if (cleanup.cleanupFailed) {
        const failure = new Error(
          economy
            ? "Codex isolated economy runtime could not be retired after startup failed."
            : "Codex app-server runtime could not be retired after initialization failed.",
          { cause: error }
        );
        failure.code = economy
          ? "vibe64_codex_economy_runtime_cleanup_required"
          : "vibe64_codex_app_server_cleanup_required";
        failure.cleanupRequired = true;
        failure.retryable = false;
        throw failure;
      }
      throw error;
    }
    this.client = client;
    this.planUsage = null;
    this.planUsagePending = null;
    client.subscribe((notification = {}) => {
      if (this.client !== client || this.observationFailure) return;
      if (notification.method === "account/updated") {
        this.planUsage = null;
        this.planUsageAuthGeneration += 1;
      }
      if (notification.method === "account/rateLimits/updated") {
        const limits = notification.params?.rateLimits;
        if (!limits?.limitId || limits.limitId === "codex") this.planUsage = codexPlanUsage(limits);
      }
      this.publishNotification(notification);
    });
    this.initializeResult = normalizeCodexAppServerInfo(initializeResult);
    this.connectionGeneration += 1;
    return {
      initializeResult: this.isEconomyProvider() ? this.initializeResult : initializeResult,
      runtime
    };
  }

  currentConnectionGeneration() {
    return this.connectionGeneration;
  }

  publishNotification(notification) {
    const threadId = notification.params?.threadId;
    const probe = this.threadControlProbes.get(threadId);
    const method = notification.method;
    if (probe && (/^(turn|item)\//u.test(method) || method === "thread/status/changed")) {
      const turnId = notification.params?.turnId || notification.params?.turn?.id;
      if (method === "turn/started" && probe.turnId && probe.turnId !== turnId) {
        this.threadControlProbes.delete(threadId);
      } else if (probe.verified) {
        return;
      } else {
        if (method === "turn/started") probe.turnId = turnId;
        probe.pending.push(notification);
        if (method === "item/started" || probe.pending.length >= 32) {
          const item = notification.params?.item;
          if (item?.type === "commandExecution" && item.command?.includes(probe.marker)) {
            probe.verified = true;
            probe.pending = [];
          } else {
            // A concurrent native user turn must retain every event. Only a
            // positively identified control probe may be hidden from chat.
            this.threadControlProbes.delete(threadId);
            for (const pending of probe.pending) this.publishNotification(pending);
          }
        }
        return;
      }
    }
    for (const subscriber of this.notificationSubscribers) {
      try {
        subscriber(notification);
      } catch (error) {
        this.failObservation(error);
      }
    }
  }

  currentServerInfo() {
    return this.initializeResult;
  }

  async currentRuntimeInfo() {
    const runtime = this.runtime || {};
    const executionMode = codexAppServerExecutionMode(this.options);
    const effective = codexAppServerEffectiveRuntimeInput(this.options);
    return Object.freeze({
      accountIdentitySignature: await currentCodexAccountIdentitySignature({
        ...this.options,
        executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
      }),
      authStateSignature: await currentCodexAuthStateSignature(this.options),
      endpoint: normalizeAgentText(runtime.endpoint),
      executionMode,
      executionContextHash: normalizeAgentText(runtime.executionContextHash) ||
        codexAppServerExecutionContextHash(effective),
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      runtimeDir: normalizeAgentText(
        runtime.runtimeDir || this.options.runtimeDir || codexAppServerRuntimeDir(this.options)
      ),
      runtimesHash: normalizeAgentText(runtime.runtimesHash) ||
        codexAppServerEffectiveRuntimesHash(this.options),
      terminalEnvHash: normalizeAgentText(runtime.terminalEnvHash) ||
        codexAppServerTerminalEnvHash(effective.terminalEnv),
      toolHomeSource: executionMode === CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
        ? ""
        : normalizeAgentText(this.options.toolHomeSource),
      transport: normalizeAgentText(runtime.transport) || CODEX_APP_SERVER_TRANSPORT.UNIX
    });
  }

  async currentEconomyExecutionContext() {
    const runtime = await this.ensureRuntime();
    const cwd = normalizeAgentText(this.options.economyWorkdir)
      ? path.resolve(this.options.economyWorkdir)
      : codexAppServerEconomyWorkspaceDir(runtime.runtimeDir);
    if (!runtime.runtimeDir) {
      throw codexAppServerEconomyAuthError(
        "vibe64_codex_economy_runtime_invalid",
        "Codex economy runtime isolation could not be verified."
      );
    }
    await ensureWritablePrivateDirectory(cwd);
    return Object.freeze({
      accountIdentitySignature: await currentCodexAccountIdentitySignature({
        ...this.options,
        executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
      }),
      cwd,
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY
    });
  }

  isAvailable() {
    return Boolean(this.client?.isOpen?.() && this.runtime);
  }

  async activeClient() {
    if (this.observationFailure) throw this.observationFailure;
    if (this.client?.isOpen?.()) {
      return this.client;
    }
    await this.connect();
    return this.client;
  }

  async ensureAvailable() {
    if (this.observationFailure) throw this.observationFailure;
    if (this.isAvailable()) {
      return {
        client: this.client,
        ok: true,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    if (this.availabilityPromise) {
      return this.availabilityPromise;
    }
    const operation = (async () => {
      if (!this.isEconomyProvider()) {
        await this.preflightAuth("codex-app-server-ensure-available");
      }
      const client = await this.activeClient();
      return {
        client,
        ok: true,
        runtime: this.runtime
      };
    })();
    this.availabilityPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.availabilityPromise === operation) {
        this.availabilityPromise = null;
      }
    }
  }

  async readPlanUsage() {
    const client = this.client;
    if (!client?.isOpen?.()) return { status: "unavailable", windows: [] };
    if (this.planUsage && Date.now() - this.planUsage.checkedAt < 60_000) return this.planUsage;
    if (this.planUsagePending) return this.planUsagePending;
    const previous = this.planUsage;
    const authGeneration = this.planUsageAuthGeneration;
    const signal = AbortSignal.timeout(10_000);
    const operation = (async () => {
      try {
        const account = await client.request("account/read", { refreshToken: false }, { signal });
        if (this.client !== client || this.planUsageAuthGeneration !== authGeneration) return { status: "unavailable", windows: [] };
        if (account?.account?.type !== "chatgpt") {
          this.planUsage = { status: "unsupported", windows: [], checkedAt: Date.now() };
        } else {
          const result = await client.request("account/rateLimits/read", {}, { signal });
          if (this.client !== client || this.planUsageAuthGeneration !== authGeneration) return { status: "unavailable", windows: [] };
          // A live event received during the read is newer than this request.
          if (this.planUsage === previous) this.planUsage = codexPlanUsage(result.rateLimitsByLimitId?.codex || result.rateLimits);
        }
        return this.planUsage;
      } catch {
        return { status: "unavailable", windows: [] };
      }
    })();
    this.planUsagePending = operation;
    try { return await operation; }
    finally { if (this.planUsagePending === operation) this.planUsagePending = null; }
  }

  subscribe(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Codex app-server observer must be a function.");
    }
    // Observation belongs to this provider, not one replaceable socket.
    this.notificationSubscribers.add(callback);
    return () => this.notificationSubscribers.delete(callback);
  }

  failObservation(cause) {
    const message = cause?.code === "vibe64_agent_control_recovery_failed"
      ? cause.message
      : "Codex observation failed. Work must be stopped before it can continue.";
    this.observationFailure ||= Object.assign(
      new Error(message, { cause }),
      { code: "vibe64_codex_observation_lost" }
    );
    return this.options.onObservationLost?.(this.observationFailure);
  }

  async stopThreadForObservationLoss(threadId, turnId) {
    // Control uses only this existing socket. It must not spawn or resume work
    // to find out whether the work we lost sight of has stopped.
    const client = this.client;
    if (!client?.isOpen()) throw new Error("Codex control connection is unavailable.");
    const signal = AbortSignal.timeout(5_000);
    const request = (method, params) => client.request(method, params, { signal });
    const { goal } = await request("thread/goal/get", { threadId });
    if (goal?.status === "active") {
      const result = await request("thread/goal/set", { threadId, status: "paused" });
      if (result.goal?.status !== "paused" || result.goal?.createdAt !== goal.createdAt || result.goal?.objective !== goal.objective) {
        throw new Error("Codex did not confirm that the same goal was paused.");
      }
    }
    const readStatus = async () => {
      const { thread } = await request("thread/read", { threadId, includeTurns: false });
      return typeof thread?.status === "string" ? thread.status : thread?.status?.type;
    };
    if (!["idle", "notLoaded"].includes(await readStatus())) {
      if (!turnId) {
        const page = await request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "summary" });
        turnId = page.data?.[0]?.id;
      }
      if (!turnId) throw new Error("Codex's running turn could not be identified.");
      await request("turn/interrupt", { threadId, turnId });
      if (await readStatus() !== "idle") throw new Error("Codex did not confirm that its turn stopped.");
    }
  }

  setServerRequestHandler(callback) {
    const handler = typeof callback === "function" ? callback : null;
    this.serverRequestHandler = handler;
    this.client?.setRequestHandler?.((request) => this.handleServerRequest(request));
    return () => {
      if (this.serverRequestHandler === handler) {
        this.serverRequestHandler = null;
        this.client?.setRequestHandler?.((request) => this.handleServerRequest(request));
      }
    };
  }

  async startThread(params = {}) {
    const client = await this.activeClient();
    const environment = this.options.prepareThreadEnvironment
      ? await this.options.prepareThreadEnvironment(this.options.threadEnv || {})
      : this.options.threadEnv;
    const requestParams = codexAppServerThreadRequestParams(params, environment);
    const response = await this.runRequest(
      () => client.request("thread/start", requestParams),
      "codex-app-server-thread-start"
    );
    if (response?.thread?.historyMode === "paginated" && response.thread.ephemeral !== true) {
      const threadId = normalizeAgentText(response.thread.id);
      // A new paginated thread needs its metadata and empty rollout persisted
      // before it can be resumed. This initializes only the just-created,
      // empty thread; it never hydrates an existing conversation.
      await this.runRequest(async () => {
        await client.request("thread/name/set", { threadId, name: threadId });
        await client.request("thread/read", { threadId, includeTurns: true });
      }, "codex-app-server-thread-initialize-history");
    }
    if (this.options.prepareThreadEnvironment && response?.thread?.id) {
      this.threadEnvironments.set(response.thread.id, {
        client,
        params: requestParams, managed: !Object.hasOwn(params.config || {}, "shell_environment_policy")
      });
    }
    return {
      ...normalizeAgentThread({
        id: response?.thread?.id,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.thread
      }),
      response
    };
  }

  async resumeThread(threadId = "", params = {}) {
    await this.options.beforeResumeThread?.(threadId);
    const client = await this.activeClient();
    let response;
    if (this.options.prepareThreadEnvironment) {
      response = await this.withThreadEnvironment(threadId, params, (requestParams, resumed) =>
        resumed || client.request("thread/resume", { excludeTurns: true, ...requestParams, threadId }));
    } else {
      const requestParams = codexAppServerThreadRequestParams(params, this.options.threadEnv);
      response = await this.runRequest(
        () => client.request("thread/resume", {
          excludeTurns: true,
          ...requestParams,
          threadId: normalizeAgentText(threadId || requestParams.threadId)
        }),
        "codex-app-server-thread-resume"
      );
    }
    return {
      ...normalizeAgentThread({
        id: response?.thread?.id,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.thread
      }),
      response
    };
  }

  // A loaded native thread can ignore shell_environment_policy on resume.
  // Detaching alone is insufficient when another subscriber retains it: prove
  // the effective managed environment before recording a new binding.
  async withThreadEnvironment(threadId, params, operation) {
    const previous = this.threadEnvironmentTasks.get(threadId) || Promise.resolve();
    const task = previous.catch(() => null).then(() => this.runRequest(async () => {
      const client = await this.activeClient();
      const generation = this.threadEnvironmentGeneration;
      const signal = AbortSignal.timeout(this.options.threadControlTimeoutMs || 10_000);
      const assertRecoveryOpen = () => {
        signal.throwIfAborted();
        if (generation !== this.threadEnvironmentGeneration) {
          throw new Error("The assistant connection closed during recovery.");
        }
      };
      const request = (method, input) => {
        assertRecoveryOpen();
        return client.request(method, input, { signal });
      };
      const bound = this.threadEnvironments.get(threadId);
      if (bound?.managed === false || Object.hasOwn(params?.config || {}, "shell_environment_policy")) {
        return operation(codexAppServerThreadRequestParams({ ...bound?.params, ...params }, {}));
      }
      const environment = await this.options.prepareThreadEnvironment(
        bound?.params?.config?.shell_environment_policy?.set || this.options.threadEnv || {}
      );
      const requestParams = {
        ...bound?.params,
        ...params,
        config: {
          ...bound?.params?.config,
          ...params?.config,
          shell_environment_policy: { inherit: "none", set: environment }
        }
      };
      const readStatus = async () => {
        const { thread } = await request("thread/read", { threadId, includeTurns: false });
        return typeof thread?.status === "string" ? thread.status : thread?.status?.type;
      };
      const nativeStatus = await readStatus();
      const bindingMatches = bound?.client === client &&
        JSON.stringify(bound.params.config.shell_environment_policy) === JSON.stringify(requestParams.config.shell_environment_policy);
      let pausedGoal = null;
      let resumed = null;
      const goalChange = this.goalChanges.get(threadId);
      const isSamePausedGoal = (goal, original) => goal?.status === "paused" &&
        goal.createdAt === original.createdAt && goal.objective === original.objective;
      const log = (event, fields = {}) => logOperationalEvent(this.options.logger, event === "recovery_failed" ? "warn" : "info", {
        component: "vibe64.codex_controls", event: `vibe64.codex_controls.${event}`,
        threadId, sessionId: environment.VIBE64_AGENT_SESSION_COMMAND_SESSION_ID || "",
        generations: Object.fromEntries(Object.entries(environment).filter(([key, value]) =>
          key.endsWith("_COMMAND_GENERATION") && /^[0-9a-f-]{36}$/iu.test(value))),
        connectionGeneration: this.connectionGeneration, ...fields
      }, "Codex managed controls changed.");
      try {
        if (!bindingMatches || nativeStatus === "notLoaded") {
          log("reload_started", { reason: bound ? "control-environment-changed" : "unverified-thread-binding", nativeStatus });
          if (nativeStatus !== "notLoaded") {
            const { goal } = await request("thread/goal/get", { threadId });
            if (goal?.status === "active") {
              const result = await request("thread/goal/set", { threadId, status: "paused" });
              pausedGoal = result.goal;
              if (!isSamePausedGoal(pausedGoal, goal)) {
                throw new Error("Codex did not confirm that the same goal stopped scheduling work.");
              }
            }
            if (await readStatus() !== "idle") {
              const page = await request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "summary" });
              const turnId = page.data?.[0]?.id;
              if (!turnId) throw new Error("Codex's running turn could not be identified for control recovery.");
              await request("turn/interrupt", { threadId, turnId });
              while (await readStatus() !== "idle") {
                signal.throwIfAborted();
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
            }
            if (pausedGoal) {
              const { goal } = await request("thread/goal/get", { threadId });
              pausedGoal = isSamePausedGoal(goal, pausedGoal) ? goal : null;
            }
            const detached = await request("thread/unsubscribe", { threadId });
            if (!["unsubscribed", "notSubscribed", "notLoaded"].includes(detached?.status)) {
              throw new Error("Codex did not confirm detachment before control recovery.");
            }
          }
          this.threadEnvironments.delete(threadId);
          await this.options.beforeResumeThread?.(threadId);
          resumed = await request("thread/resume", { excludeTurns: true, ...requestParams, threadId });
          if (!["idle", "active"].includes(await readStatus())) throw new Error("Codex did not confirm the thread loaded.");
          if (nativeStatus !== "notLoaded") {
            await this.#verifyThreadEnvironment(threadId, environment, request, signal);
          }
          const checked = await this.options.prepareThreadEnvironment(environment);
          if (JSON.stringify(checked) !== JSON.stringify(environment)) {
            throw new Error("Managed controls changed again during thread recovery.");
          }
          this.threadEnvironments.set(threadId, { client, params: requestParams, managed: true });
          log("ready");
        }
      } catch (cause) {
        const probe = this.threadControlProbes.get(threadId);
        if (probe && !probe.verified) {
          this.threadControlProbes.delete(threadId);
          for (const pending of probe.pending) this.publishNotification(pending);
        }
        this.threadEnvironments.delete(threadId);
        log("recovery_failed", { code: cause?.code || "", reason: cause.message });
        throw Object.assign(new Error(cause?.code === "vibe64_agent_control_binding_retained"
          ? `${cause.message} Your conversation and work are preserved.`
          : "Assistant tool recovery could not be verified. Work is preserved; retry Resume after checking the assistant connection.", { cause }), {
          code: "vibe64_agent_control_recovery_failed", retryable: true
        });
      }
      // Never retry the caller's operation: its outcome may already be durable.
      assertRecoveryOpen();
      const result = await operation(requestParams, resumed);
      if (pausedGoal && this.goalChanges.get(threadId) === goalChange) {
        const { goal } = await request("thread/goal/get", { threadId });
        if (isSamePausedGoal(goal, pausedGoal) && goal.updatedAt === pausedGoal.updatedAt) {
          await request("thread/goal/set", { threadId, status: "active" });
        }
      }
      return result;
    }, "codex-app-server-thread-controls"));
    this.threadEnvironmentTasks.set(threadId, task);
    try {
      return await task;
    } finally {
      if (this.threadEnvironmentTasks.get(threadId) === task) this.threadEnvironmentTasks.delete(threadId);
    }
  }

  async #verifyThreadEnvironment(threadId, environment, request, signal) {
    const keys = Object.keys(environment).filter((key) => key.startsWith("VIBE64_")).sort();
    if (!keys.length) return;

    const marker = `VIBE64_CONTROL_CHECK_${randomUUID()}:`;
    this.threadControlProbes.set(threadId, { marker, pending: [], verified: false, turnId: "" });
    const expected = createHash("sha256").update(JSON.stringify(keys.map((key) => [key, environment[key]]))).digest("hex");
    const source = [
      "const {createHash}=require('node:crypto');",
      `const keys=${JSON.stringify(keys)};`,
      `process.stdout.write(${JSON.stringify(marker)}+createHash('sha256').update(JSON.stringify(keys.map(key=>[key,process.env[key]]))).digest('hex'))`
    ].join("");
    // This bounded native shell check uses no model and prints only a digest,
    // never credentials or environment values.
    await request("thread/shellCommand", {
      threadId, command: `${shellQuote(process.execPath)} -e ${shellQuote(source)}`, timeoutMs: 2000
    });
    while (true) {
      signal.throwIfAborted();
      const page = await request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "full" });
      const turn = page.data?.[0];
      const probe = turn?.items?.find((item) => item.type === "commandExecution" && item.aggregatedOutput?.startsWith(marker));
      if (probe && turn.status !== "inProgress") {
        if (probe.exitCode !== 0 || probe.aggregatedOutput.trim() !== `${marker}${expected}`) {
          throw Object.assign(new Error("Another native subscriber retained the previous tool environment. Close the native assistant terminal and retry Resume."), {
            code: "vibe64_agent_control_binding_retained"
          });
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async ensureThreadControls(threadId) {
    if (!this.options.prepareThreadEnvironment) return;
    return this.withThreadEnvironment(threadId, {}, async (_params, resumed) => ({ ok: true, recovered: Boolean(resumed) }));
  }

  async rewindConversation(threadId, input = {}) {
    const client = await this.activeClient();
    const { thread } = await client.request("thread/read", { threadId, includeTurns: false });
    if (thread.historyMode !== "paginated") throw new Error("This older Codex conversation does not support Undo.");
    const readTurns = () => this.listThreadTurns(threadId, { limit: 2, sortDirection: "desc", itemsView: "full" });
    const turns = (await readTurns()).data.toReversed();
    const last = turns.at(-1);
    const previous = turns.at(-2);
    const busy = thread.status?.type === "active" || thread.status === "active" || last?.status === "inProgress";
    const { goal } = await this.readGoal(threadId);
    if (busy || goal?.status === "active") throw new Error("Stop Codex and pause its goal before undoing a turn.");
    const checkpoint = input.checkpoint || { threadId, turnId: last?.id, previousTurnId: previous?.id };
    const matches = (turn, messageId) => {
      const users = (turn?.items || []).filter((item) => item.type === "userMessage");
      return users.length === 1 && (users[0].clientId || users[0].client_id || users[0].clientUserMessageId) === messageId;
    };
    if (!input.checkpoint) {
      if (!matches(last, input.messageId) || !matches(previous, input.previousMessageId)) {
        throw new Error("Codex cannot undo this exchange as one turn. Steered messages share a native turn.");
      }
      return { ok: true, checkpoint };
    }
    if (checkpoint.threadId !== threadId) throw new Error("The Codex conversation changed. Refresh before undoing.");
    if (last?.id === checkpoint.previousTurnId && !turns.some((turn) => turn.id === checkpoint.turnId)) return { ok: true };
    if (last?.id !== checkpoint.turnId || previous?.id !== checkpoint.previousTurnId) {
      throw new Error("Codex's last turn changed. Refresh before undoing.");
    }
    // Revert has an exact, exclusive boundary and preserves the logical thread
    // identity. It does not restore workspace files.
    const result = await this.runRequest(() => client.request("thread/revert", { threadId, beforeTurnId: checkpoint.turnId }),
      "codex-app-server-conversation-rewind");
    if (result.thread?.id !== threadId || (await readTurns()).data[0]?.id !== checkpoint.previousTurnId) {
      throw new Error("Codex did not confirm the rewind. Retry Undo last turn to check it.");
    }
    return { ok: true };
  }

  async readGoal(threadId = "") {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/goal/get", { threadId: normalizeAgentText(threadId) }),
      "codex-app-server-goal-read"
    );
  }

  async setGoal(threadId, { objective, tokenBudget } = {}) {
    if (typeof objective !== "string" || !objective.trim() ||
        (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0))) {
      throw new TypeError("A Codex goal requires an objective and an optional positive token budget.");
    }
    this.goalChanges.set(threadId, (this.goalChanges.get(threadId) || 0) + 1);
    const operation = async () => {
      const client = await this.activeClient();
      return client.request("thread/goal/set", {
        threadId: normalizeAgentText(threadId), objective: objective.trim(), status: "active",
        ...(tokenBudget === undefined ? {} : { tokenBudget })
      });
    };
    return this.options.prepareThreadEnvironment
      ? this.withThreadEnvironment(threadId, {}, operation)
      : this.runRequest(operation, "codex-app-server-goal-set");
  }

  async setGoalStatus(threadId = "", status = "") {
    if (!["active", "paused"].includes(status)) {
      throw new TypeError("Invalid Codex goal status.");
    }
    this.goalChanges.set(threadId, (this.goalChanges.get(threadId) || 0) + 1);
    const operation = async () => {
      const client = await this.activeClient();
      return client.request("thread/goal/set", { threadId: normalizeAgentText(threadId), status });
    };
    return status === "active" && this.options.prepareThreadEnvironment
      ? this.withThreadEnvironment(threadId, {}, operation)
      : this.runRequest(operation, "codex-app-server-goal-status");
  }

  async clearGoal(threadId = "") {
    this.goalChanges.set(threadId, (this.goalChanges.get(threadId) || 0) + 1);
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/goal/clear", { threadId: normalizeAgentText(threadId) }),
      "codex-app-server-goal-clear"
    );
  }

  async readThread(threadId = "") {
    const client = await this.activeClient();
    const response = await this.runRequest(
      () => client.request("thread/read", {
        includeTurns: true,
        threadId: normalizeAgentText(threadId)
      }),
      "codex-app-server-thread-read"
    );
    return {
      ...normalizeAgentThread({
        id: response?.thread?.id || threadId,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.thread || response
      }),
      response
    };
  }

  async readThreadStatus(threadId = "") {
    const client = await this.activeClient();
    const response = await this.runRequest(
      () => client.request("thread/read", {
        includeTurns: false,
        threadId: normalizeAgentText(threadId)
      }),
      "codex-app-server-thread-status"
    );
    return {
      ...normalizeAgentThread({
        id: response?.thread?.id || threadId,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.thread || response
      }),
      response
    };
  }

  async listThreadTurns(threadId = "", params = {}) {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/turns/list", {
        ...params,
        threadId: normalizeAgentText(threadId || params.threadId)
      }),
      "codex-app-server-thread-turns-list"
    );
  }

  async listLoadedThreads(params = {}) {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/loaded/list", params),
      "codex-app-server-thread-loaded-list"
    );
  }

  async listAppServerThreadsForCwd({
    cwd = "",
    signal = null
  } = {}) {
    const normalizedCwd = normalizeAgentText(cwd);
    if (!normalizedCwd || codexAppServerTextHasControlCharacters(normalizedCwd)) {
      const error = new Error("Codex session thread inventory requires an exact cwd.");
      error.code = "vibe64_codex_session_thread_inventory_invalid";
      throw error;
    }
    const client = await this.activeClient();
    const state = await listBoundedCodexAppServerThreadIds({
      archived: false,
      client,
      cwd: normalizedCwd,
      errorCode: "vibe64_codex_session_thread_inventory_invalid",
      label: "session",
      requestLabel: "codex-app-server-session-thread-list",
      runRequest: this.runRequest.bind(this),
      signal,
      state: {
        entryCount: 0,
        threadIds: new Set(),
        totalBytes: 0
      },
      verifyCwd: true
    });
    return Object.freeze({
      cwd: normalizedCwd,
      threadIds: Object.freeze([...state.threadIds].sort())
    });
  }

  async listEconomyThreads({
    signal = null
  } = {}) {
    const client = await this.activeClient();
    const execution = await this.currentEconomyExecutionContext();
    const state = {
      entryCount: 0,
      threadIds: new Set(),
      totalBytes: 0
    };
    for (const archived of [false, true]) {
      await listBoundedCodexAppServerThreadIds({
        archived,
        client,
        cwd: execution.cwd,
        errorCode: "vibe64_codex_economy_thread_inventory_invalid",
        label: "economy",
        requestLabel: "codex-app-server-economy-thread-list",
        runRequest: this.runRequest.bind(this),
        signal,
        state
      });
    }
    return Object.freeze({
      threadIds: Object.freeze([...state.threadIds].sort())
    });
  }

  async listModels(params = {}, {
    signal = null
  } = {}) {
    const client = await this.activeClient();
    const data = [];
    const seenCursors = new Set();
    const includeHidden = params.includeHidden === true;
    const limit = normalizePositiveInteger(
      params.limit,
      CODEX_APP_SERVER_MODEL_CATALOG_PAGE_LIMIT
    );
    const boundedLimit = Math.min(limit, CODEX_APP_SERVER_MODEL_CATALOG_PAGE_LIMIT);
    let totalBytes = 0;
    let cursor = params.cursor === undefined || params.cursor === null || params.cursor === ""
      ? ""
      : typeof params.cursor === "string"
        ? params.cursor.trim()
        : null;
    if (cursor === null || cursor.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH) {
      throw codexAppServerModelCatalogError("Codex model catalog cursor is invalid.");
    }
    for (let page = 0; page < CODEX_APP_SERVER_MODEL_CATALOG_MAX_PAGES; page += 1) {
      if (cursor && seenCursors.has(cursor)) {
        throw codexAppServerModelCatalogError("Codex model catalog repeated a pagination cursor.");
      }
      if (cursor) {
        seenCursors.add(cursor);
      }
      const response = await this.runRequest(
        () => client.request("model/list", {
          ...(cursor ? { cursor } : {}),
          includeHidden,
          limit: boundedLimit
        }, { signal }),
        "codex-app-server-model-list"
      );
      if (!Array.isArray(response?.data)) {
        throw codexAppServerModelCatalogError(
          "Codex model catalog response did not contain a data array."
        );
      }
      if (
        response.data.length > boundedLimit ||
        data.length + response.data.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRIES
      ) {
        throw codexAppServerModelCatalogError("Codex model catalog exceeded its entry limit.");
      }
      for (const entry of response.data) {
        if (!isPlainObject(entry)) {
          throw codexAppServerModelCatalogError("Codex model catalog contained an invalid entry.");
        }
        let entryBytes = 0;
        try {
          entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
        } catch {
          throw codexAppServerModelCatalogError("Codex model catalog contained an invalid entry.");
        }
        if (
          entryBytes > CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRY_BYTES ||
          totalBytes + entryBytes > CODEX_APP_SERVER_MODEL_CATALOG_MAX_TOTAL_BYTES
        ) {
          throw codexAppServerModelCatalogError("Codex model catalog exceeded its response limit.");
        }
        totalBytes += entryBytes;
        data.push(entry);
      }
      const nextCursor = response.nextCursor === undefined || response.nextCursor === null || response.nextCursor === ""
        ? ""
        : typeof response.nextCursor === "string"
          ? response.nextCursor.trim()
          : null;
      if (nextCursor === null || nextCursor.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH) {
        throw codexAppServerModelCatalogError("Codex model catalog cursor is invalid.");
      }
      if (!nextCursor) {
        return {
          data,
          nextCursor: null
        };
      }
      if (seenCursors.has(nextCursor)) {
        throw codexAppServerModelCatalogError("Codex model catalog repeated a pagination cursor.");
      }
      cursor = nextCursor;
    }
    throw codexAppServerModelCatalogError(
      `Codex model catalog exceeded ${CODEX_APP_SERVER_MODEL_CATALOG_MAX_PAGES} pages.`
    );
  }

  async readConfig(params = {}) {
    const client = await this.activeClient();
    const cwd = normalizeAgentText(params.cwd);
    return this.runRequest(
      () => client.request("config/read", {
        ...(cwd ? { cwd } : {}),
        includeLayers: params.includeLayers === true
      }),
      "codex-app-server-config-read"
    );
  }

  async listHooks(cwds = []) {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("hooks/list", {
        cwds: (Array.isArray(cwds) ? cwds : [cwds])
          .map(normalizeAgentText)
          .filter(Boolean)
      }),
      "codex-app-server-hooks-list"
    );
  }

  async writeHookTrustState(state = {}) {
    if (!isPlainObject(state) || Object.keys(state).length === 0) {
      return null;
    }
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("config/batchWrite", {
        edits: [{
          keyPath: "hooks.state",
          mergeStrategy: "upsert",
          value: state
        }],
        expectedVersion: null,
        filePath: null,
        reloadUserConfig: true
      }),
      "codex-app-server-hook-trust-write"
    );
  }

  async unsubscribeThread(threadId = "") {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/unsubscribe", {
        threadId: normalizeAgentText(threadId)
      }),
      "codex-app-server-thread-unsubscribe"
    );
  }

  async deleteThread(threadId = "") {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/delete", {
        threadId: normalizeAgentText(threadId)
      }),
      "codex-app-server-thread-delete"
    );
  }

  async sendTurn(threadId = "", input = [], params = {}) {
    const operation = async () => {
      const client = await this.activeClient();
      return client.request("turn/start", {
        ...params,
        input: codexTurnInput(input),
        threadId: normalizeAgentText(threadId || params.threadId)
      });
    };
    const response = this.options.prepareThreadEnvironment
      ? await this.withThreadEnvironment(threadId || params.threadId, {}, operation)
      : await this.runRequest(operation, "codex-app-server-turn-start");
    return {
      ...normalizeAgentTurn({
        id: response?.turn?.id || response?.turnId,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.turn || response
      }),
      response
    };
  }

  async steerTurn(threadId = "", turnId = "", input = [], params = {}) {
    const client = await this.activeClient();
    const response = await this.runRequest(
      () => client.request("turn/steer", {
        ...params,
        expectedTurnId: normalizeAgentText(turnId || params.expectedTurnId),
        input: codexTurnInput(input),
        threadId: normalizeAgentText(threadId || params.threadId)
      }),
      "codex-app-server-turn-steer"
    );
    return {
      ...normalizeAgentTurn({
        id: response?.turn?.id || response?.turnId || turnId,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.turn || response
      }),
      response
    };
  }

  async interruptTurn(threadId = "", turnId = "") {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("turn/interrupt", {
        threadId: normalizeAgentText(threadId),
        turnId: normalizeAgentText(turnId)
      }),
      "codex-app-server-turn-interrupt"
    );
  }

  nativeCliResumeCommand(threadId = "") {
    const runtime = this.runtime || {};
    return codexCliResumeCommand({
      codexCommand: this.options.codexCommand || "codex",
      endpoint: runtime.endpoint,
      threadId
    });
  }

  close() {
    this.threadEnvironmentGeneration += 1;
    this.options.onClose?.();
    this.threadEnvironments.clear();
    this.threadControlProbes.clear();
    this.planUsage = null;
    this.planUsagePending = null;
    this.notificationSubscribers.clear();
    this.client?.close();
    this.client = null;
    this.initializeResult = null;
    this.economyAuth = null;
    this.economyAuthBlocked = false;
  }

  async stopRuntime({
    expectedAccountIdentitySignature = "",
    preserveProcessExitProof = false
  } = {}) {
    this.close();
    this.runtimeStopOwner = this.runtime || this.runtimeStopOwner;
    const runtime = this.runtimeStopOwner || {};
    const result = await stopCodexAppServerRuntime({
      ...this.options,
      expectedAccountIdentitySignature,
      ownedRuntime: runtime,
      preserveProcessExitProof,
      runtimeDir: runtime.runtimeDir || this.options.runtimeDir
    });
    if (result.processExitVerified === true && this.runtimeStopOwner === runtime) {
      this.runtimeStopOwner = {
        ...runtime,
        processExitVerifiedAt: runtime.processExitVerifiedAt || new Date().toISOString(),
        processState: CODEX_APP_SERVER_PROCESS_STATE.STOPPED
      };
    }
    if (this.runtime === runtime) {
      this.runtime = null;
    }
    return result;
  }
}

function createCodexAppServerAgentProvider(options = {}) {
  return new CodexAppServerAgentProvider(options);
}

export {
  CODEX_APP_SERVER_EXECUTION_MODES,
  CODEX_APP_SERVER_INVALID_REQUEST_CODE,
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE,
  CODEX_APP_SERVER_PROVIDER_ID,
  CODEX_APP_SERVER_RUNTIME_BUSY_CODE,
  CODEX_APP_SERVER_TRANSPORT,
  CodexAppServerAgentProvider,
  assertCodexAuthPreflightReady,
  codexAppServerEndpointForTarget,
  codexAppServerEconomyHomeDir,
  codexAppServerEconomyWorkspaceDir,
  codexAppServerMetadataIsLive,
  codexAppServerRequestIsInvalid,
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  currentCodexAccountIdentitySignature,
  readCodexSelectedAccountAccess,
  codexCliResumeCommand,
  codexTextInput,
  codexTurnInput,
  createCodexAppServerAgentProvider,
  ensureCodexAppServerRuntime,
  startCodexAppServerProcess,
  stopCodexAppServerRuntime
};
