// The git and gh wrappers an agent session gets: their folder, script and environment.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { normalizeText } from "@local/vibe64-execution/server";
import { codexAttachmentHostRoot } from "@local/vibe64-runtime/server/codexAttachmentPaths";
import { writeExecutableFileIfChanged } from "./writeExecutableFileIfChanged.js";
import { shortCommandHash, unixCommandSocketPath } from "./unixJsonCommand.js";

const CODEX_GIT_COMMAND_DIR_NAME = "codex-git-command";
const CODEX_GIT_COMMAND_WRAPPER_NAMES = Object.freeze(["git", "gh", "vibe64-github"]);

const CODEX_GIT_COMMAND_HEALTH_TIMEOUT_MS = 2000;

const VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV = "VIBE64_CODEX_GIT_COMMAND_SESSION_ID";
const VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV = "VIBE64_CODEX_GIT_COMMAND_SOCKET";
const VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV = "VIBE64_CODEX_GIT_COMMAND_TOKEN";
const VIBE64_CODEX_GIT_COMMAND_GENERATION_ENV = "VIBE64_CODEX_GIT_COMMAND_GENERATION";
const VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV = "VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR";

function attachmentRuntimeKey({
  sessionId = "",
  stateRoot = ""
} = {}) {
  return shortCommandHash([
    normalizeText(stateRoot),
    normalizeText(sessionId)
  ].join("\n"));
}

function commandHostDir({
  env = process.env,
  sessionId = "",
  stateRoot = ""
} = {}) {
  return path.join(
    codexAttachmentHostRoot({
      env
    }),
    CODEX_GIT_COMMAND_DIR_NAME,
    attachmentRuntimeKey({
      sessionId,
      stateRoot
    })
  );
}

function commandSocketHostPath({
  env = process.env,
  sessionId = "",
  stateRoot = ""
} = {}) {
  const hostDir = commandHostDir({ env, sessionId, stateRoot });
  return unixCommandSocketPath(path.join(hostDir, "git-command.sock"), { env });
}

function wrapperHostPath(options = {}, command = "") {
  return path.join(commandHostDir(options), command);
}

function wrapperScriptSource() {
  return `#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import process from "node:process";

const allowedCommands = new Set(${JSON.stringify(CODEX_GIT_COMMAND_WRAPPER_NAMES)});
const command = path.basename(process.argv[1] || "");

function fail(message, code = 1) {
  process.stderr.write(String(message || "Codex git command failed.") + "\\n");
  process.exit(code);
}

function readStdinBase64() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolve(Buffer.concat(chunks).toString("base64")));
  });
}

function requestSocket({ body, socketPath }) {
  const requestBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    let connected = false;
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/codex-git-command/run",
      socketPath
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.once("end", () => resolve({
        statusCode: response.statusCode,
        text
      }));
      response.once("error", rejectTransport);
    });
    // Only connection establishment has a transport deadline. The executor
    // owns the command budget and must finish cleanup before returning a result.
    const connectionTimer = setTimeout(() => {
      const error = new Error("Managed Git control connection timed out.");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    }, ${CODEX_GIT_COMMAND_HEALTH_TIMEOUT_MS});
    function rejectTransport(error) {
      clearTimeout(connectionTimer);
      error.controlConnected = connected;
      reject(error);
    }
    request.once("error", rejectTransport);
    request.once("socket", (socket) => {
      const onConnect = () => {
        connected = true;
        clearTimeout(connectionTimer);
      };
      if (socket.connecting) {
        socket.once("connect", onConnect);
      } else {
        onConnect();
      }
    });
    request.end(requestBody);
  });
}

if (!allowedCommands.has(command)) {
  fail("Codex git command wrapper was invoked with an unsupported command.");
}

const socketPath = process.env.${VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV} || "";
const sessionId = process.env.${VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV} || "";
const token = process.env.${VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV} || "";
const generationId = process.env.${VIBE64_CODEX_GIT_COMMAND_GENERATION_ENV} || "";
const noStdinParentPid = Number.parseInt(
  process.env.VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID || "",
  10
);

if (!socketPath || !sessionId || !token || !generationId) {
  fail("vibe64_agent_control_unavailable: Managed Git control identity is unavailable. The requested command was not submitted. Reconnect the assistant.");
}

const inputBase64 = command === "vibe64-github" || noStdinParentPid === process.ppid
  ? ""
  : await readStdinBase64();
const response = await requestSocket({
  socketPath,
  body: {
    args: process.argv.slice(2),
    command,
    cwd: process.cwd(),
    generationId,
    inputBase64,
    sessionId,
    token
  }
}).catch((error) => {
  const code = String(error?.code || "UNKNOWN");
  if (error.controlConnected) {
    fail("vibe64_codex_git_command_transport_lost: Managed Git command response was lost (" + code + "). Its outcome is unknown. Check the result before retrying a write.");
  }
  if (["ECONNREFUSED", "ENOENT", "ENOTSOCK", "ETIMEDOUT"].includes(code)) {
    fail("vibe64_agent_control_unavailable: Managed Git control connection failed (" + code + "). The requested command was not submitted. Reconnect the assistant.");
  }
  fail(error?.message || error || "Codex git command request failed.");
});

let payload = {};
try {
  payload = JSON.parse(response.text || "{}");
} catch {
  fail("vibe64_codex_git_command_response_invalid: Managed Git returned an unreadable response. Its outcome is unknown. Check the result before retrying a write.");
}
if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.ok !== "boolean") {
  fail("vibe64_codex_git_command_response_invalid: Managed Git returned an incomplete response. Its outcome is unknown. Check the result before retrying a write.");
}

if (payload.stdout) {
  process.stdout.write(Buffer.from(String(payload.stdout), payload.outputEncoding === "base64" ? "base64" : "utf8"));
}
if (payload.stderr) {
  process.stderr.write(Buffer.from(String(payload.stderr), payload.outputEncoding === "base64" ? "base64" : "utf8"));
}
const timedOut = payload.timedOut === true;
const hasPlatformFailure = payload.ok === false && (timedOut || payload.code !== "vibe64_codex_git_command_failed");
if (timedOut) {
  process.stderr.write(String(payload.code || "vibe64_codex_git_command_timed_out") + ": " + String(payload.error || "Managed Git command timed out.") + "\\n");
} else if (hasPlatformFailure && !payload.stderr && payload.error) {
  const prefix = payload.code ? String(payload.code) + ": " : "";
  process.stderr.write(prefix + String(payload.error) + "\\n");
}
if (hasPlatformFailure) {
  if (payload.diagnostic) {
    process.stderr.write("Managed Git diagnostic: " + JSON.stringify(payload.diagnostic) + "\\n");
  }
  if (payload.diagnostic?.commandSubmitted === false) {
    process.stderr.write("The requested command was not submitted.\\n");
  } else if (timedOut) {
    process.stderr.write("The command's effects are unconfirmed. Check the result before retrying a write.\\n");
  }
}

const exitCode = Number.isInteger(payload.exitCode) ? payload.exitCode : (payload.ok === false ? 1 : 0);
process.exitCode = exitCode;
`;
}

async function writeWrappers(options = {}) {
  const dir = commandHostDir(options);
  await mkdir(dir, {
    recursive: true
  });
  const source = wrapperScriptSource();
  await Promise.all(CODEX_GIT_COMMAND_WRAPPER_NAMES.map(async (command) => {
    const filePath = wrapperHostPath(options, command);
    await writeExecutableFileIfChanged(filePath, source);
  }));
}

function commandEnvironment({
  env = process.env,
  generationId = "",
  sessionId = "",
  stateRoot = "",
  token = ""
} = {}) {
  const hostDir = commandHostDir({
    env,
    sessionId,
    stateRoot
  });
  const commandEnv = {
    [VIBE64_CODEX_GIT_COMMAND_GENERATION_ENV]: normalizeText(generationId),
    [VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV]: normalizeText(sessionId),
    [VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV]: commandSocketHostPath({
      env,
      sessionId,
      stateRoot
    }),
    [VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV]: normalizeText(token),
    [VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV]: hostDir
  };
  return commandEnv;
}

export {
  CODEX_GIT_COMMAND_HEALTH_TIMEOUT_MS,
  CODEX_GIT_COMMAND_WRAPPER_NAMES,
  commandEnvironment,
  commandHostDir,
  commandSocketHostPath,
  VIBE64_CODEX_GIT_COMMAND_GENERATION_ENV,
  VIBE64_CODEX_GIT_COMMAND_SESSION_ID_ENV,
  VIBE64_CODEX_GIT_COMMAND_SOCKET_ENV,
  VIBE64_CODEX_GIT_COMMAND_TOKEN_ENV,
  VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV,
  writeWrappers
};
