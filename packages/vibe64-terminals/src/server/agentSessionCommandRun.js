// The shell side of an agent session command: its environment contract, the wrapper, runner and
// rename scripts it installs, and reading a run's bounded output and result.

import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { pathInsideOrEqual } from "@local/vibe64-core/server/core";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { commandLineFailure } from "./commandFailure.js";

const AGENT_SESSION_COMMAND_NAME = "vibe64-session-command";

const AGENT_SESSION_COMMAND_CONTRACT_VERSION = "1";

const AGENT_SESSION_COMMAND_OUTPUT_MAX_BYTES = 20 * 1024 * 1024;
const AGENT_SESSION_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
const AGENT_SESSION_COMMAND_POLL_MS = 25;
const VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV = "VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION";
const VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV = "VIBE64_AGENT_SESSION_COMMAND_GENERATION";
const VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_SESSION_COMMAND_SESSION_ID";
const VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV = "VIBE64_AGENT_SESSION_COMMAND_SOCKET";
const VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV = "VIBE64_AGENT_SESSION_COMMAND_TOKEN";
const VIBE64_WRAPPER_ENV = "VIBE64_WRAPPER";
const VIBE64_AGENT_SESSION_RUN_COMMAND_ENV = "VIBE64_AGENT_SESSION_RUN_COMMAND_BASE64";
const VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV = "VIBE64_AGENT_SESSION_RUN_OUTPUT_PATH";
const VIBE64_AGENT_SESSION_RUN_RESULT_ENV = "VIBE64_AGENT_SESSION_RUN_RESULT_PATH";
// This capability permits session status, rename, project messages and role-checked plan commands. It
// does not expose the shell-execution token stripped from managed child commands.
const SESSION_RENAME_CONTROL_ENV = "VIBE64_SESSION_RENAME_CONTROL";

const AGENT_SESSION_CONTROL_ENV_NAMES = new Set([
  VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV,
  VIBE64_WRAPPER_ENV,
  "VIBE64_EXECUTION_ID"
]);
const AGENT_SESSION_DESKTOP_BUS_ENV_NAMES = new Set([
  "DBUS_SESSION_BUS_ADDRESS",
  "DBUS_STARTER_ADDRESS",
  "DBUS_STARTER_BUS_TYPE"
]);


function commandWrapperSource() {
  return `#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import process from "node:process";

const expectedName = ${JSON.stringify(AGENT_SESSION_COMMAND_NAME)};
const expectedVersion = ${JSON.stringify(AGENT_SESSION_COMMAND_CONTRACT_VERSION)};
const socketPath = String(process.env.${VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV} || "").trim();
const sessionId = String(process.env.${VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV} || "").trim();
const token = String(process.env.${VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV} || "").trim();
const generationId = String(process.env.${VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV} || "").trim();
const version = String(process.env.${VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV} || "").trim();
const command = String(process.argv[2] || "");

function fail(message, code = 1) {
  process.stderr.write(String(message || "Vibe64 session command failed.") + "\\n");
  process.exit(code);
}

function requestSocket(body) {
  const requestBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/agent-session-command/run",
      socketPath,
      timeout: ${AGENT_SESSION_COMMAND_TIMEOUT_MS + 30_000}
    }, (response) => {
      let responseText = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseText += chunk; });
      response.once("end", () => resolve(responseText));
    });
    request.once("error", reject);
    request.once("timeout", () => {
      const error = new Error("Vibe64 session command timed out.");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.end(requestBody);
  });
}

if (path.basename(process.argv[1] || "") !== expectedName) fail("Unsupported Vibe64 session command wrapper.");
if (!socketPath || !sessionId || !token || !generationId) fail("vibe64_agent_control_unavailable: Session command control is unavailable. Reconnect the assistant.");
if (version !== expectedVersion) fail("vibe64_agent_control_unavailable: Session command control is outdated. Reconnect the assistant.");
if (!command || process.argv.length !== 3) fail("Vibe64 session command input is invalid.", 2);

const responseText = await requestSocket({
  commandBase64: Buffer.from(command, "utf8").toString("base64url"),
  cwd: process.cwd(),
  env: process.env,
  generationId,
  sessionId,
  token
}).catch((error) => fail(error?.message || error));

let payload;
try {
  payload = JSON.parse(responseText || "{}");
} catch {
  fail("Vibe64 session command returned invalid JSON.");
}
if (payload.stdout) process.stdout.write(String(payload.stdout));
if (payload.stderr) process.stderr.write(String(payload.stderr));
else if (payload.ok === false && payload.error) process.stderr.write(String(payload.error) + "\\n");
process.exit(Number.isInteger(payload.exitCode) ? payload.exitCode : (payload.ok === false ? 1 : 0));
`;
}

function sessionRenameCommandSource() {
  return `#!/usr/bin/env node
import http from "node:http";

const args = process.argv.slice(2);
const usage = [
  'Usage: vibe64-helper session status [--json] | setup retry | rename "Name" | list-project <project> [--json]',
  "  | update [--resolved <review-id>] [--json]",
  "  | message-project <project> [--session <session-id-or-name>] <message> [message-id: letters, digits, _ or -]",
  "  | project-preview <project> [--session <session-id-or-name>]",
  "update runs this session's Update (rebase onto its saved version), as its Update button does; it never saves.",
  "Without --session, the project's selected session is addressed; in your own project that is often your own session.",
  "To reach another session (by name, or \\"the other session\\"), first run list-project <project>, then pass its ID or name to --session.",
  "If exactly one other active session is listed, use it; ask the person only when several could be meant."
].join("\\n");
if (!args.length || args[0] === "--help" || args[0] === "-h") {
  console.log(usage);
  process.exit(0);
}
const status = args[0] === "status" && (args.length === 1 || args.length === 2 && args[1] === "--json");
const setupRetry = args[0] === "setup" && args[1] === "retry" && args.length === 2;
const listProject = args[0] === "list-project" && args[1]?.trim() &&
  (args.length === 2 || args.length === 3 && args[2] === "--json");
const explicitSession = ["message-project", "project-preview"].includes(args[0]) && args[2] === "--session";
const messageIndex = explicitSession ? 4 : 2;
const messageProject = args[0] === "message-project" &&
  [messageIndex + 1, messageIndex + 2].includes(args.length) &&
  args[1]?.trim() && args[messageIndex]?.trim() && (!explicitSession || args[3]?.trim());
const projectPreview = args[0] === "project-preview" && args.length === (explicitSession ? 4 : 2) &&
  args[1]?.trim() && (!explicitSession || args[3]?.trim());
const updateArgs = args[0] === "update" ? args.slice(1) : [];
const updateJson = updateArgs.includes("--json");
const resolvedAt = updateArgs.indexOf("--resolved");
const reviewedConflictId = resolvedAt >= 0 ? String(updateArgs[resolvedAt + 1] || "").trim() : "";
const update = args[0] === "update" && updateArgs.length === (updateJson ? 1 : 0) + (resolvedAt >= 0 ? 2 : 0) &&
  (resolvedAt < 0 || Boolean(reviewedConflictId) && !reviewedConflictId.startsWith("-"));
if (!status && !setupRetry && !listProject && !messageProject && !projectPreview && !update && (args[0] !== "rename" || args.length !== 2 || !args[1].trim())) {
  console.error(usage);
  process.exit(2);
}
const route = listProject ? "list-project" : messageProject ? "message-project" : projectPreview ? "project-preview" : status ? "status" : setupRetry ? "setup-retry" : update ? "update" : "rename";
try {
  const control = JSON.parse(process.env.${SESSION_RENAME_CONTROL_ENV} || "null");
  if (!control?.socketPath || !control.token || !control.sessionId || !control.generationId) {
    throw new Error("Session control is unavailable. Reconnect the assistant.");
  }
  const body = JSON.stringify({
    name: args[1], projectSlug: args[1],
    ...(messageProject ? { message: args[messageIndex], messageId: args[messageIndex + 1] } : {}),
    ...(explicitSession ? { destinationSessionId: args[3] } : {}),
    ...(reviewedConflictId ? { reviewedConflictId } : {}),
    token: control.token, sessionId: control.sessionId, generationId: control.generationId
  });
  // Update fetches and rebases every repository of the session, so it waits as long as a session command runs.
  const result = await new Promise((resolve, reject) => {
    const request = http.request({
      socketPath: control.socketPath, method: "POST", path: "/agent-session-command/" + route,
      timeout: update ? ${AGENT_SESSION_COMMAND_TIMEOUT_MS} : 15000,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("error", reject);
      response.on("end", () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error(update
      ? "Update is still running. Read vibe64-helper session status --json until repository.updateFirst.reason is no longer running."
      : "Session control timed out.")));
    request.end(body);
  });
  if (update && result.status) {
    console.log(updateJson ? JSON.stringify(result) : [result.message, result.next ? "Next: " + result.next : ""].filter(Boolean).join("\\n"));
    process.exitCode = result.ok === true ? 0 : 1;
  } else if (result.ok !== true) {
    throw new Error(result.error || "The session command failed.");
  } else if (listProject && args[2] !== "--json") {
    for (const session of result.sessions) {
      const marks = [session.own ? "your session" : "", session.selected ? "selected" : ""].filter(Boolean).join(", ");
      console.log([session.sessionId, session.sessionName === session.sessionId ? "" : session.sessionName, marks ? "(" + marks + ")" : ""]
        .filter(Boolean).join("  "));
    }
    if (!result.sessions.some((session) => !session.own)) {
      console.log("No other active session of " + result.projectSlug + " can receive a message.");
    }
  } else {
    console.log(projectPreview ? result.url : JSON.stringify(status || setupRetry || messageProject || listProject ? result : { sessionName: result.sessionName }));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
`;
}

function commandRunnerSource() {
  return `#!/usr/bin/env bash
set +e

command_base64="\${${VIBE64_AGENT_SESSION_RUN_COMMAND_ENV}:-}"
output_path="\${${VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV}:-}"
result_path="\${${VIBE64_AGENT_SESSION_RUN_RESULT_ENV}:-}"

if [ -z "$command_base64" ] || [ -z "$output_path" ] || [ -z "$result_path" ]; then
  exit 125
fi

unset ${VIBE64_AGENT_SESSION_RUN_COMMAND_ENV}
unset ${VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV}
unset ${VIBE64_AGENT_SESSION_RUN_RESULT_ENV}

exec >>"$output_path" 2>&1

finish() {
  status=$?
  printf '%s\\n' "$status" >"$result_path.tmp"
  mv -f "$result_path.tmp" "$result_path"
}
trap finish EXIT

command_text="$(printf '%s' "$command_base64" | base64 --decode)" || exit 125
eval "$command_text"
`;
}

function sanitizedCommandEnvironment(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => (
      name &&
      !AGENT_SESSION_CONTROL_ENV_NAMES.has(name) &&
      !AGENT_SESSION_DESKTOP_BUS_ENV_NAMES.has(name) &&
      !name.startsWith("VIBE64_CODEX_APP_SERVER_") &&
      name !== "VIBE64_OPENCODE_SESSION_ENV_REGISTRY" &&
      ![
        "OPENCODE_CONFIG_CONTENT",
        "OPENCODE_DB",
        "OPENCODE_SERVER_PASSWORD",
        "OPENCODE_SERVER_USERNAME"
      ].includes(name)
    ))
    .map(([name, item]) => [name, String(item ?? "")]));
}

function decodedCommand(value = "") {
  const normalized = toText(value);
  if (!normalized || !/^[A-Za-z0-9_-]+$/u.test(normalized)) {
    return "";
  }
  try {
    return Buffer.from(normalized, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function validateCommandCwd(cwd = "", sourceRoot = "") {
  const resolvedCwd = path.resolve(toText(cwd) || sourceRoot);
  if (!sourceRoot || !pathInsideOrEqual(sourceRoot, resolvedCwd)) {
    return commandLineFailure(
      "Agent commands must run inside the active session source.",
      "vibe64_agent_session_command_cwd_invalid",
      {
        cwd: resolvedCwd,
        sourceRoot
      }
    );
  }
  return {
    cwd: resolvedCwd,
    ok: true
  };
}

async function readBoundedFile(filePath = "", maxBytes = AGENT_SESSION_COMMAND_OUTPUT_MAX_BYTES) {
  const handle = await open(filePath, "r");
  try {
    const fileSize = Number((await handle.stat()).size || 0);
    const readSize = Math.min(Math.max(0, fileSize), maxBytes);
    if (readSize === 0) {
      return "";
    }
    const buffer = Buffer.allocUnsafe(readSize);
    const { bytesRead } = await handle.read(buffer, 0, readSize, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function waitForCommandResult(resultPath = "", options = {}) {
  const {
    signal = null,
    timeoutMs = AGENT_SESSION_COMMAND_TIMEOUT_MS
  } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      const error = new Error("Vibe64 session command was cancelled.");
      error.code = "vibe64_agent_session_command_cancelled";
      throw error;
    }
    try {
      return toText(await readFile(resultPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, AGENT_SESSION_COMMAND_POLL_MS));
  }
  const error = new Error("Vibe64 session command timed out.");
  error.code = "vibe64_agent_session_command_timeout";
  throw error;
}

export {
  AGENT_SESSION_COMMAND_CONTRACT_VERSION,
  AGENT_SESSION_COMMAND_NAME,
  AGENT_SESSION_COMMAND_TIMEOUT_MS,
  commandRunnerSource,
  commandWrapperSource,
  decodedCommand,
  readBoundedFile,
  sanitizedCommandEnvironment,
  SESSION_RENAME_CONTROL_ENV,
  sessionRenameCommandSource,
  validateCommandCwd,
  VIBE64_AGENT_SESSION_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_SESSION_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_SESSION_COMMAND_TOKEN_ENV,
  VIBE64_AGENT_SESSION_RUN_COMMAND_ENV,
  VIBE64_AGENT_SESSION_RUN_OUTPUT_ENV,
  VIBE64_AGENT_SESSION_RUN_RESULT_ENV,
  VIBE64_WRAPPER_ENV,
  waitForCommandResult
};
