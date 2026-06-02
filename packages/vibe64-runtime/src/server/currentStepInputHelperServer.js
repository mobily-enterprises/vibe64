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

function helperRuntimeHostDir(targetRoot = "") {
  return path.join(path.resolve(targetRoot), ".vibe64", "runtime");
}

function helperSocketHostPath(targetRoot = "") {
  return path.join(helperRuntimeHostDir(targetRoot), HELPER_SOCKET_NAME);
}

function helperSocketContainerPath() {
  return path.posix.join(HELPER_SOCKET_CONTAINER_DIR, HELPER_SOCKET_NAME);
}

function helperScriptHostPath(session = {}) {
  return path.join(path.resolve(session.sessionRoot), "helpers", HELPER_SCRIPT_NAME);
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

function helperEnvironment(session = {}, targetRoot = "") {
  const scriptPath = helperScriptHostPath(session);
  return {
    VIBE64_CURRENT_STEP_INPUT_HELPER: scriptPath,
    VIBE64_CURRENT_STEP_INPUT_SESSION: session.sessionId,
    VIBE64_CURRENT_STEP_INPUT_SOCKET: helperSocketContainerPath(targetRoot),
    VIBE64_CURRENT_STEP_INPUT_TOKEN: currentStepInputToken(session.sessionId)
  };
}

function helperMount(targetRoot = "") {
  return {
    source: helperRuntimeHostDir(targetRoot),
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

async function ensureHelperServer({
  onSessionChanged = async () => null,
  projectService,
  targetRoot = ""
} = {}) {
  const socketPath = helperSocketHostPath(targetRoot);
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
    if (request.method !== "POST" || request.url !== "/current-step/input") {
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
      const result = await runtime.submitCurrentStepInput(sessionId, input);
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
  targetRoot = ""
} = {}) {
  await ensureHelperServer({
    onSessionChanged,
    projectService,
    targetRoot
  });
  await writeHelperScript(session);
  return {
    env: helperEnvironment(session, targetRoot),
    mount: helperMount(targetRoot)
  };
}

export {
  HELPER_SOCKET_CONTAINER_DIR,
  currentStepInputToken,
  helperEnvironment,
  helperSocketHostPath,
  helperSocketContainerPath,
  prepareCurrentStepInputHelper
};
