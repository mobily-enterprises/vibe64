import crypto from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  CODEX_ATTACHMENT_CONTAINER_ROOT,
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";
import {
  redactLogValue
} from "@local/vibe64-core/server/logging";

const GITHUB_BROKER_HELPER_DIR_NAME = ".vibe64-github-broker";
const GITHUB_BROKER_HELPER_SOCKET_NAME = "github-broker.sock";
const GITHUB_BROKER_HELPER_SCRIPT_NAME = "vibe64-github-broker.mjs";
const MAX_GITHUB_BROKER_HELPER_BODY_BYTES = 128 * 1024;
const helperServers = new Map();

function helperRuntimeKey(stateRoot = "") {
  return crypto
    .createHash("sha256")
    .update(`${process.pid}:${path.resolve(normalizeText(stateRoot) || ".")}`)
    .digest("hex")
    .slice(0, 16);
}

function helperRuntimeHostDir({
  env = process.env,
  stateRoot = ""
} = {}) {
  return path.join(
    codexAttachmentHostRoot({
      env
    }),
    GITHUB_BROKER_HELPER_DIR_NAME,
    helperRuntimeKey(stateRoot)
  );
}

function helperRuntimeContainerDir(stateRoot = "") {
  return path.posix.join(
    CODEX_ATTACHMENT_CONTAINER_ROOT,
    GITHUB_BROKER_HELPER_DIR_NAME,
    helperRuntimeKey(stateRoot)
  );
}

function helperSocketHostPath(options = {}) {
  return path.join(helperRuntimeHostDir(options), GITHUB_BROKER_HELPER_SOCKET_NAME);
}

function helperSocketContainerPath(stateRoot = "") {
  return path.posix.join(helperRuntimeContainerDir(stateRoot), GITHUB_BROKER_HELPER_SOCKET_NAME);
}

function helperScriptHostPath(options = {}) {
  return path.join(helperRuntimeHostDir(options), GITHUB_BROKER_HELPER_SCRIPT_NAME);
}

function helperScriptContainerPath(stateRoot = "") {
  return path.posix.join(helperRuntimeContainerDir(stateRoot), GITHUB_BROKER_HELPER_SCRIPT_NAME);
}

async function readRequestJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_GITHUB_BROKER_HELPER_BODY_BYTES) {
      const error = new Error("Vibe64 GitHub broker helper input is too large.");
      error.code = "vibe64_github_broker_helper_input_too_large";
      throw error;
    }
  }
  try {
    const parsed = JSON.parse(body || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    const error = new Error("Vibe64 GitHub broker helper input must be valid JSON.");
    error.code = "vibe64_github_broker_helper_invalid_json";
    throw error;
  }
}

function sendJson(response, statusCode, payload = {}) {
  const safePayload = redactLogValue(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(safePayload, null, 2)}\n`);
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

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) {
    return "";
  }
  const value = args[index + 1] || "";
  return value && !value.startsWith("--") ? value : "";
}

async function payloadTextFromArgs(args) {
  if (args.includes("--json")) {
    return optionValue(args, "--json") || readStdin();
  }
  return readStdin();
}

function parsePayload(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim() || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error("Usage: vibe64-github-broker --json '{\\"operation\\":\\"git_status\\"}' or pipe JSON on stdin.");
  }
}

function usageError() {
  return new Error("Usage: vibe64-github-broker --list, --schema <operation>, or --json '{\\"operation\\":\\"git_status\\"}'.");
}

function requestSocket({ body = null, method = "GET", path, socketPath }) {
  const requestBody = body === null ? "" : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: requestBody
        ? {
            "Content-Length": Buffer.byteLength(requestBody),
            "Content-Type": "application/json"
          }
        : {},
      method,
      path,
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
    request.end(requestBody);
  });
}

const args = process.argv.slice(2);
const socketPath = process.env.VIBE64_GITHUB_BROKER_SOCKET || "";
const sessionId = process.env.VIBE64_GITHUB_BROKER_SESSION_ID || "";
const turnId = process.env.VIBE64_GITHUB_BROKER_TURN_ID || "";

try {
  if (!socketPath || !sessionId) {
    throw new Error("Vibe64 GitHub broker helper environment is not available.");
  }

  let response = null;
  if (args.includes("--list")) {
    response = await requestSocket({
      path: "/github-broker/operations",
      socketPath
    });
  } else if (args.includes("--schema")) {
    const operation = optionValue(args, "--schema");
    if (!operation) {
      throw new Error("Usage: vibe64-github-broker --schema <operation>.");
    }
    response = await requestSocket({
      path: \`/github-broker/operations/\${encodeURIComponent(operation)}/schema\`,
      socketPath
    });
  } else if (args.includes("--json") || !process.stdin.isTTY) {
    const payload = {
      ...parsePayload(await payloadTextFromArgs(args)),
      sessionId
    };
    if (turnId && !payload.turnId) {
      payload.turnId = turnId;
    }
    response = await requestSocket({
      body: payload,
      method: "POST",
      path: "/github-broker/run",
      socketPath
    });
  } else {
    throw usageError();
  }

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

function helperEnvironment({
  sessionId = "",
  stateRoot = "",
  turnId = ""
} = {}) {
  const env = {
    VIBE64_GITHUB_BROKER_HELPER: helperScriptContainerPath(stateRoot),
    VIBE64_GITHUB_BROKER_SESSION_ID: normalizeText(sessionId),
    VIBE64_GITHUB_BROKER_SOCKET: helperSocketContainerPath(stateRoot)
  };
  if (normalizeText(turnId)) {
    env.VIBE64_GITHUB_BROKER_TURN_ID = normalizeText(turnId);
  }
  return env;
}

async function writeHelperScript(options = {}) {
  const scriptPath = helperScriptHostPath(options);
  await mkdir(path.dirname(scriptPath), {
    recursive: true
  });
  await writeFile(scriptPath, helperScriptSource(), "utf8");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function ensureGithubBrokerHelperServer({
  env = process.env,
  githubBroker,
  stateRoot = ""
} = {}) {
  const socketPath = helperSocketHostPath({
    env,
    stateRoot
  });
  const existing = helperServers.get(socketPath);
  if (existing?.githubBroker === githubBroker) {
    return existing.server;
  }
  if (existing?.server) {
    await new Promise((resolve) => {
      existing.server.close(() => resolve());
    }).catch(() => null);
    helperServers.delete(socketPath);
  }

  await mkdir(path.dirname(socketPath), {
    recursive: true
  });
  await rm(socketPath, {
    force: true
  });

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/github-broker/operations") {
        sendJson(response, 200, {
          ok: true,
          operations: githubBroker.listOperations()
        });
        return;
      }
      const schemaMatch = /^\/github-broker\/operations\/([^/]+)\/schema$/u.exec(request.url || "");
      if (request.method === "GET" && schemaMatch) {
        const schema = githubBroker.operationSchema(decodeURIComponent(schemaMatch[1]));
        sendJson(response, schema ? 200 : 404, schema ? {
          ok: true,
          schema
        } : {
          code: "vibe64_github_broker_unknown_operation",
          error: "Unknown Vibe64 GitHub broker operation.",
          ok: false
        });
        return;
      }
      if (request.method === "POST" && request.url === "/github-broker/run") {
        const input = await readRequestJson(request);
        if (!normalizeText(input.turnId) && typeof githubBroker.currentTurnId === "function") {
          input.turnId = await githubBroker.currentTurnId(input.sessionId);
        }
        sendJson(response, 200, await githubBroker.run(input));
        return;
      }
      sendJson(response, 404, {
        code: "vibe64_github_broker_helper_route_not_found",
        error: "Unknown Vibe64 GitHub broker helper route.",
        ok: false
      });
    } catch (error) {
      const payload = vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_github_broker_helper_request_failed",
        fallbackMessage: "Vibe64 GitHub broker helper request failed."
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
  helperServers.set(socketPath, {
    githubBroker,
    server
  });
  return server;
}

async function prepareGithubBrokerHelper({
  env = process.env,
  githubBroker,
  sessionId = "",
  stateRoot = "",
  turnId = ""
} = {}) {
  if (!githubBroker) {
    return {
      env: {},
      ok: false
    };
  }
  await prepareCodexAttachmentRoot({
    env
  });
  await ensureGithubBrokerHelperServer({
    env,
    githubBroker,
    stateRoot
  });
  await writeHelperScript({
    env,
    stateRoot
  });
  return {
    env: helperEnvironment({
      sessionId,
      stateRoot,
      turnId
    }),
    hostScriptPath: helperScriptHostPath({
      env,
      stateRoot
    }),
    hostSocketPath: helperSocketHostPath({
      env,
      stateRoot
    }),
    ok: true
  };
}

export {
  helperEnvironment as githubBrokerHelperEnvironment,
  helperScriptSource as githubBrokerHelperScriptSource,
  prepareGithubBrokerHelper
};
