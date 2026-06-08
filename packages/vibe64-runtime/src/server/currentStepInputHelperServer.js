import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";

const HELPER_SOCKET_CONTAINER_DIR = "/vibe64-helper";
const HELPER_SOCKET_NAME = `current-step-input-${process.pid}.sock`;
const HELPER_SCRIPT_NAME = "vibe64-current-step-input.mjs";
const TERMINAL_CHAT_HELPER_SCRIPT_NAME = "vibe64-terminal-chat.mjs";
const HOST_HELPER_SCRIPT_NAME = "vibe64-current-step-input-host.mjs";
const HOST_TERMINAL_CHAT_HELPER_SCRIPT_NAME = "vibe64-terminal-chat-host.mjs";
const MAX_HELPER_BODY_BYTES = 128 * 1024;
const TOKEN_SECRET = randomBytes(32);
const helperServers = new Map();

function normalizeText(value = "") {
  return String(value || "").trim();
}

function currentStepInputToken(sessionId = "") {
  return createHmac("sha256", TOKEN_SECRET)
    .update(normalizeText(sessionId))
    .digest("base64url");
}

function tokenMatches(left = "", right = "") {
  const leftBuffer = Buffer.from(normalizeText(left));
  const rightBuffer = Buffer.from(normalizeText(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(headerValue = "") {
  const header = normalizeText(headerValue);
  const match = /^Bearer\s+(.+)$/iu.exec(header);
  return normalizeText(match?.[1]);
}

function helperStateRoot({
  session = {},
  stateRoot = ""
} = {}) {
  const resolvedStateRoot = normalizeText(stateRoot || session.stateRoot);
  if (!resolvedStateRoot) {
    throw new Error("Vibe64 helper state root is required.");
  }
  return path.resolve(resolvedStateRoot);
}

function helperRuntimeHostDir({
  session = {},
  stateRoot = ""
} = {}) {
  return path.join(helperStateRoot({
    session,
    stateRoot
  }), "runtime", "current-step-input");
}

function helperSocketHostPath({
  session = {},
  stateRoot = ""
} = {}) {
  return path.join(helperRuntimeHostDir({
    session,
    stateRoot
  }), HELPER_SOCKET_NAME);
}

function helperSocketContainerPath() {
  return path.posix.join(HELPER_SOCKET_CONTAINER_DIR, HELPER_SOCKET_NAME);
}

function helperScriptHostPath(session = {}) {
  return path.join(path.resolve(session.sessionRoot), "helpers", HELPER_SCRIPT_NAME);
}

function terminalChatHelperScriptHostPath(session = {}) {
  return path.join(path.resolve(session.sessionRoot), "helpers", TERMINAL_CHAT_HELPER_SCRIPT_NAME);
}

function hostHelperScriptHostPath(session = {}) {
  return path.join(path.resolve(session.sessionRoot), "helpers", HOST_HELPER_SCRIPT_NAME);
}

function hostTerminalChatHelperScriptHostPath(session = {}) {
  return path.join(path.resolve(session.sessionRoot), "helpers", HOST_TERMINAL_CHAT_HELPER_SCRIPT_NAME);
}

function helperRequestToken(request) {
  return bearerToken(request.headers.authorization) || normalizeText(request.headers["x-vibe64-helper-token"]);
}

async function readRequestJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_HELPER_BODY_BYTES) {
      const error = new Error("Vibe64 helper input is too large.");
      error.code = "vibe64_helper_input_too_large";
      throw error;
    }
  }
  try {
    const parsed = JSON.parse(body || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    const error = new Error("Vibe64 helper input must be valid JSON.");
    error.code = "vibe64_helper_invalid_json";
    throw error;
  }
}

function sendJson(response, statusCode, payload = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function helperSuccessResponse(result = {}, sessionId = "") {
  return {
    ok: true,
    sessionId: normalizeText(result.sessionId || sessionId),
    currentStep: normalizeText(result.currentStep),
    stepStatus: normalizeText(result.stepMachine?.status),
    status: normalizeText(result.status)
  };
}

function helperScriptSource() {
  return `#!/usr/bin/env node
import http from "node:http";
import process from "node:process";

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolve(text));
  });
}

async function payloadTextFromArgs(args) {
  const jsonIndex = args.indexOf("--json");
  if (jsonIndex >= 0) {
    const nextArg = args[jsonIndex + 1] || "";
    return nextArg && !nextArg.startsWith("--") ? nextArg : readStdin();
  }
  return readStdin();
}

function parsePayload(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim() || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error("Usage: vibe64-current-step-input --json '{\\"kind\\":\\"ready\\", ...}' or pipe JSON on stdin.");
  }
}

function postJsonToSocket({ payload, socketPath, token }) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        Authorization: \`Bearer \${token}\`,
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/current-step/input",
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
    });
    request.once("error", reject);
    request.end(body);
  });
}

const socketPath = process.env.VIBE64_CURRENT_STEP_INPUT_SOCKET || "";
const token = process.env.VIBE64_CURRENT_STEP_INPUT_TOKEN || "";
const sessionId = process.env.VIBE64_CURRENT_STEP_INPUT_SESSION || "";

try {
  if (!socketPath || !token || !sessionId) {
    throw new Error("Vibe64 current-step helper environment is not available.");
  }

  const payload = {
    ...parsePayload(await payloadTextFromArgs(process.argv.slice(2))),
    sessionId,
    source: "codex"
  };
  const response = await postJsonToSocket({
    payload,
    socketPath,
    token
  });
  process.stdout.write(response.text);
  if (Number(response.statusCode) >= 400) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(\`\${error?.message || error}\\n\`);
  process.exitCode = 1;
}
`;
}

function terminalChatHelperScriptSource() {
  return `#!/usr/bin/env node
import http from "node:http";
import process from "node:process";

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolve(text));
  });
}

async function payloadTextFromArgs(args) {
  const jsonIndex = args.indexOf("--json");
  if (jsonIndex >= 0) {
    const nextArg = args[jsonIndex + 1] || "";
    return nextArg && !nextArg.startsWith("--") ? nextArg : readStdin();
  }
  return readStdin();
}

function parsePayload(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim() || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error("Usage: vibe64-terminal-chat --json '{\\"response\\":\\"...\\"}' or pipe JSON on stdin.");
  }
}

function postJsonToSocket({ payload, socketPath, token }) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        Authorization: \`Bearer \${token}\`,
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/terminal-chat/exchange",
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
    });
    request.once("error", reject);
    request.end(body);
  });
}

const socketPath = process.env.VIBE64_TERMINAL_CHAT_SOCKET || "";
const token = process.env.VIBE64_TERMINAL_CHAT_TOKEN || "";
const sessionId = process.env.VIBE64_TERMINAL_CHAT_SESSION || "";

try {
  if (!socketPath || !token || !sessionId) {
    throw new Error("Vibe64 terminal chat helper environment is not available.");
  }

  const payload = {
    ...parsePayload(await payloadTextFromArgs(process.argv.slice(2))),
    sessionId,
    source: "codex-terminal"
  };
  const response = await postJsonToSocket({
    payload,
    socketPath,
    token
  });
  process.stdout.write(response.text);
  if (Number(response.statusCode) >= 400) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(\`\${error?.message || error}\\n\`);
  process.exitCode = 1;
}
`;
}

function helperEnvironment(session = {}, {
  socketPath = helperSocketContainerPath()
} = {}) {
  const scriptPath = helperScriptHostPath(session);
  const terminalChatScriptPath = terminalChatHelperScriptHostPath(session);
  return {
    VIBE64_CURRENT_STEP_INPUT_HELPER: scriptPath,
    VIBE64_CURRENT_STEP_INPUT_SESSION: session.sessionId,
    VIBE64_CURRENT_STEP_INPUT_SOCKET: socketPath,
    VIBE64_CURRENT_STEP_INPUT_TOKEN: currentStepInputToken(session.sessionId),
    VIBE64_TERMINAL_CHAT_HELPER: terminalChatScriptPath,
    VIBE64_TERMINAL_CHAT_SESSION: session.sessionId,
    VIBE64_TERMINAL_CHAT_SOCKET: socketPath,
    VIBE64_TERMINAL_CHAT_TOKEN: currentStepInputToken(session.sessionId)
  };
}

function hostHelperEnvironment(session = {}, {
  stateRoot = ""
} = {}) {
  return helperEnvironment(session, {
    socketPath: helperSocketHostPath({
      session,
      stateRoot
    })
  });
}

function helperMount({
  session = {},
  stateRoot = ""
} = {}) {
  return {
    source: helperRuntimeHostDir({
      session,
      stateRoot
    }),
    target: HELPER_SOCKET_CONTAINER_DIR
  };
}

async function writeHelperScript(session = {}) {
  const scriptPath = helperScriptHostPath(session);
  await mkdir(path.dirname(scriptPath), {
    recursive: true
  });
  await writeFile(scriptPath, helperScriptSource(), "utf8");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeTerminalChatHelperScript(session = {}) {
  const scriptPath = terminalChatHelperScriptHostPath(session);
  await mkdir(path.dirname(scriptPath), {
    recursive: true
  });
  await writeFile(scriptPath, terminalChatHelperScriptSource(), "utf8");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

function hostHelperWrapperScriptSource({
  delegateScriptPath = "",
  env = {}
} = {}) {
  return `#!/usr/bin/env node
import { pathToFileURL } from "node:url";

${Object.entries(env).map(([name, value]) => (
    `process.env.${name} = ${JSON.stringify(String(value || ""))};`
  )).join("\n")}

await import(pathToFileURL(${JSON.stringify(delegateScriptPath)}).href);
`;
}

async function writeHostHelperWrapperScript({
  delegateScriptPath = "",
  env = {},
  scriptPath = ""
} = {}) {
  await mkdir(path.dirname(scriptPath), {
    recursive: true
  });
  await writeFile(scriptPath, hostHelperWrapperScriptSource({
    delegateScriptPath,
    env
  }), "utf8");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

function shellQuote(value = "") {
  const text = String(value || "");
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}

function hostHelperCommands({
  currentStepInputHelper = "",
  terminalChatHelper = ""
} = {}) {
  return {
    currentStepInput: currentStepInputHelper ? `node ${shellQuote(currentStepInputHelper)}` : "",
    terminalChat: terminalChatHelper ? `node ${shellQuote(terminalChatHelper)}` : ""
  };
}

async function ensureHelperServer({
  onSessionChanged = async () => null,
  projectService,
  session = {},
  stateRoot = "",
  targetRoot = ""
} = {}) {
  void targetRoot;
  const socketPath = helperSocketHostPath({
    session,
    stateRoot
  });
  const existingServer = helperServers.get(socketPath);
  if (existingServer) {
    return existingServer;
  }

  await mkdir(path.dirname(socketPath), {
    recursive: true
  });
  await rm(socketPath, {
    force: true
  });

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !["/current-step/input", "/terminal-chat/exchange"].includes(request.url)) {
      sendJson(response, 404, {
        ok: false,
        errors: [
          {
            code: "vibe64_helper_route_not_found",
            message: "Unknown Vibe64 helper route."
          }
        ]
      });
      return;
    }

    try {
      const input = await readRequestJson(request);
      const sessionId = normalizeText(input.sessionId);
      if (!sessionId || !tokenMatches(helperRequestToken(request), currentStepInputToken(sessionId))) {
        sendJson(response, 403, {
          ok: false,
          errors: [
            {
              code: "vibe64_helper_token_invalid",
              message: "Vibe64 helper token is invalid for this session."
            }
          ]
        });
        return;
      }

      const runtime = await projectService.createRuntime();
      const result = request.url === "/terminal-chat/exchange"
        ? await runtime.appendTerminalChatExchange(sessionId, input)
        : await runtime.submitCurrentStepInput(sessionId, input);
      await onSessionChanged(result?.sessionId || sessionId);
      const statusCode = vibe64StatusCode(result);
      sendJson(response, statusCode, statusCode >= 400
        ? result
        : helperSuccessResponse(result, sessionId));
    } catch (error) {
      const payload = vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_helper_request_failed",
        fallbackMessage: "Vibe64 helper request failed."
      });
      sendJson(response, vibe64StatusCode(payload), payload);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.unref?.();
  helperServers.set(socketPath, server);
  return server;
}

async function prepareCurrentStepInputHelper({
  onSessionChanged = async () => null,
  projectService,
  session = {},
  stateRoot = "",
  targetRoot = ""
} = {}) {
  await ensureHelperServer({
    onSessionChanged,
    projectService,
    session,
    stateRoot,
    targetRoot
  });
  const currentStepInputHelper = await writeHelperScript(session);
  const terminalChatHelper = await writeTerminalChatHelperScript(session);
  const hostEnv = hostHelperEnvironment(session, {
    stateRoot
  });
  const hostCurrentStepInputHelper = await writeHostHelperWrapperScript({
    delegateScriptPath: currentStepInputHelper,
    env: {
      VIBE64_CURRENT_STEP_INPUT_SESSION: hostEnv.VIBE64_CURRENT_STEP_INPUT_SESSION,
      VIBE64_CURRENT_STEP_INPUT_SOCKET: hostEnv.VIBE64_CURRENT_STEP_INPUT_SOCKET,
      VIBE64_CURRENT_STEP_INPUT_TOKEN: hostEnv.VIBE64_CURRENT_STEP_INPUT_TOKEN
    },
    scriptPath: hostHelperScriptHostPath(session)
  });
  const hostTerminalChatHelper = await writeHostHelperWrapperScript({
    delegateScriptPath: terminalChatHelper,
    env: {
      VIBE64_TERMINAL_CHAT_SESSION: hostEnv.VIBE64_TERMINAL_CHAT_SESSION,
      VIBE64_TERMINAL_CHAT_SOCKET: hostEnv.VIBE64_TERMINAL_CHAT_SOCKET,
      VIBE64_TERMINAL_CHAT_TOKEN: hostEnv.VIBE64_TERMINAL_CHAT_TOKEN
    },
    scriptPath: hostTerminalChatHelperScriptHostPath(session)
  });
  return {
    env: helperEnvironment(session),
    host: {
      commands: hostHelperCommands({
        currentStepInputHelper: hostCurrentStepInputHelper,
        terminalChatHelper: hostTerminalChatHelper
      }),
      currentStepInputHelper: hostCurrentStepInputHelper,
      terminalChatHelper: hostTerminalChatHelper
    },
    hostEnv,
    mount: helperMount({
      session,
      stateRoot
    })
  };
}

export {
  HELPER_SOCKET_CONTAINER_DIR,
  currentStepInputToken,
  helperEnvironment,
  helperSocketHostPath,
  helperSocketContainerPath,
  hostHelperEnvironment,
  prepareCurrentStepInputHelper
};
