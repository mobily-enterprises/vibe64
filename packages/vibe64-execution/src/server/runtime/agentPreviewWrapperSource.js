function agentPreviewWrapperSource({
  contractVersion = "1",
  managedNodePath = "",
  workerScriptPath = ""
} = {}) {
  return `#!/usr/bin/env node
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const commandName = path.basename(process.argv[1] || "");
const contractVersion = ${JSON.stringify(String(contractVersion || "1"))};
const managedNodePath = ${JSON.stringify(String(managedNodePath || ""))};
const workerScriptPath = ${JSON.stringify(String(workerScriptPath || ""))};
const wrapperDir = path.dirname(process.argv[1] || "");
const browserSocketPath = path.join(wrapperDir, "preview-browser.sock");
const controlSocketPath = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_SOCKET || "").trim();
const controlToken = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_TOKEN || "").trim();
const controlGeneration = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_GENERATION || "").trim();
const sessionId = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID || "").trim();
const browserEvalUsage = "Usage: vibe64-preview browser eval < playwright-code.js";
const workerToken = crypto.createHash("sha256")
  .update(["vibe64-preview-browser", sessionId, controlGeneration, controlToken].join("\\n"))
  .digest("hex");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error) {
  return String(error?.message || error || "Vibe64 preview command failed.")
    .replace(/(vibe64_preview_token=)[^&\\s]+/gu, "$1[redacted]");
}

function fail(message, code = 1) {
  process.stderr.write(errorText(message) + "\\n");
  process.exit(code);
}

function requestSocket({ body, requestPath, socketPath, timeoutMs = 0 }) {
  const requestBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: requestPath,
      socketPath,
      timeout: timeoutMs
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
    request.once("timeout", () => {
      const error = new Error("Vibe64 preview command timed out.");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.end(requestBody);
  });
}

function parsedResponse(response = {}) {
  try {
    return JSON.parse(response.text || "{}");
  } catch {
    throw new Error(response.text || "Vibe64 preview command returned invalid JSON.");
  }
}

function payloadExitCode(payload = {}) {
  return Number.isInteger(payload.exitCode) ? payload.exitCode : (payload.ok === false ? 1 : 0);
}

function writePayload(payload = {}) {
  if (payload.stdout) {
    process.stdout.write(String(payload.stdout));
    if (!String(payload.stdout).endsWith("\\n")) {
      process.stdout.write("\\n");
    }
  }
  if (payload.stderr) {
    process.stderr.write(String(payload.stderr));
    if (!String(payload.stderr).endsWith("\\n")) {
      process.stderr.write("\\n");
    }
  }
  if (payload.ok === false && !payload.stderr && payload.error) {
    const prefix = payload.code === "vibe64_agent_control_unavailable"
      ? "vibe64_agent_control_unavailable: "
      : "";
    process.stderr.write(prefix + errorText(payload.error) + "\\n");
  }
}

async function controlRequest(requestPath, input = {}) {
  let response;
  try {
    response = await requestSocket({
      body: {
        ...input,
        generationId: controlGeneration,
        sessionId,
        token: controlToken
      },
      requestPath,
      socketPath: controlSocketPath
    });
  } catch (error) {
    const errorCode = String(error?.code || "");
    if (errorCode === "ETIMEDOUT") {
      const timedOut = new Error("vibe64_agent_control_timeout: Managed preview control timed out. Retry the command.");
      timedOut.code = "vibe64_agent_control_timeout";
      throw timedOut;
    }
    if (["ECONNREFUSED", "ENOENT", "ENOTSOCK"].includes(errorCode)) {
      const unavailable = new Error("vibe64_agent_control_unavailable: Managed preview control is unavailable. Reconnect the assistant.");
      unavailable.code = "vibe64_agent_control_unavailable";
      throw unavailable;
    }
    throw error;
  }
  return parsedResponse(response);
}

async function streamingControlRequest(requestPath, input = {}) {
  const requestBody = JSON.stringify({
    ...input,
    generationId: controlGeneration,
    sessionId,
    token: controlToken
  });
  return new Promise((resolve, reject) => {
    let buffer = "";
    let finalPayload = null;
    let receivedOutput = false;
    const handleLine = (line = "") => {
      const value = String(line || "").trim();
      if (!value) {
        return;
      }
      const payload = JSON.parse(value);
      if (payload.type === "output" && payload.data) {
        receivedOutput = true;
        process.stdout.write(Buffer.from(String(payload.data), "base64"));
        return;
      }
      if (payload.type === "result") {
        finalPayload = payload;
      }
    };
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: requestPath,
      socketPath: controlSocketPath
    }, (response) => {
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          handleLine(line);
        }
      });
      response.once("end", () => {
        try {
          handleLine(buffer);
          if (!finalPayload) {
            throw new Error("Vibe64 browser-test execution returned an incomplete response.");
          }
          if (finalPayload.ok === false && (!receivedOutput || finalPayload.code === "vibe64_preview_restore_failed") && finalPayload.error) {
            process.stderr.write(errorText(finalPayload.error) + "\\n");
          }
          resolve(payloadExitCode(finalPayload));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once("error", (error) => {
      if (["ECONNREFUSED", "ENOENT", "ENOTSOCK"].includes(String(error?.code || ""))) {
        reject(new Error("vibe64_agent_control_unavailable: Managed preview control is unavailable. Reconnect the assistant."));
        return;
      }
      reject(error);
    });
    request.end(requestBody);
  });
}

async function remoteCommand(args = []) {
  return controlRequest("/agent-preview-command/run", {
    args,
    cwd: process.cwd()
  });
}

async function authorizeBrowserIdentity(identity = "") {
  const payload = await controlRequest("/agent-preview-command/identity", {
    identity
  });
  if (payload.ok === false) {
    throw new Error(payload.error || "Vibe64 could not authorize the preview identity exchange.");
  }
  if (!String(payload.grant || "").trim()) {
    throw new Error("Vibe64 preview identity authorization did not return a grant.");
  }
  return payload;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requestedOutputPath(args = []) {
  const outputIndex = args.indexOf("--output");
  const outputEntry = args.find((arg) => String(arg || "").startsWith("--output="));
  const requested = outputIndex >= 0
    ? String(args[outputIndex + 1] || "").trim()
    : String(outputEntry || "").slice("--output=".length).trim();
  return requested ? path.resolve(requested) : "";
}

function screenshotOutputPath(args = []) {
  const requested = requestedOutputPath(args);
  const safeSessionId = String(sessionId || "session").replace(/[^A-Za-z0-9_.-]+/gu, "-");
  const timestamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/gu, "-").replace(/-+$/u, "");
  const nonce = crypto.randomBytes(6).toString("hex");
  const filename = ["vibe64-page", safeSessionId, timestamp, nonce].join("-") + ".png";
  return path.resolve(requested || path.join(process.env.TMPDIR || "/tmp", filename));
}

async function previewSession() {
  const ensured = await remoteCommand(["ensure", "--wait", "--json"]);
  if (payloadExitCode(ensured) !== 0) {
    writePayload(ensured);
    process.exit(payloadExitCode(ensured));
  }
  const inspected = await remoteCommand(["inspect-url"]);
  if (payloadExitCode(inspected) !== 0) {
    writePayload(inspected);
    process.exit(payloadExitCode(inspected));
  }
  let status = {};
  try {
    status = JSON.parse(String(ensured.stdout || "{}"));
  } catch {
    status = {};
  }
  const previewUrl = String(inspected.stdout || "").trim();
  if (!previewUrl) {
    throw new Error("Managed preview inspection URL is unavailable.");
  }
  return {
    previewInstance: [status.outputTargetId, status.terminal?.id].filter(Boolean).join(":"),
    previewUrl
  };
}

async function workerRequest(input = {}, { timeoutMs = 0 } = {}) {
  const response = await requestSocket({
    body: {
      ...input,
      token: workerToken
    },
    requestPath: "/command",
    socketPath: browserSocketPath,
    timeoutMs
  });
  return parsedResponse(response);
}

async function workerStatus() {
  try {
    const response = await workerRequest({ command: "status" }, { timeoutMs: 2000 });
    return response.ok === true && response.value?.contractVersion === contractVersion
      ? response.value
      : null;
  } catch {
    return null;
  }
}

async function startWorker() {
  const existing = await workerStatus();
  if (existing) {
    return existing;
  }
  const started = await controlRequest("/agent-preview-command/browser-start", {
    browserSocketPath,
    cwd: process.cwd(),
    managedNodePath,
    parentExecutionId: String(process.env.VIBE64_EXECUTION_ID || "").trim(),
    workerScriptPath
  });
  if (started.ok === false) {
    const error = new Error(started.error || "Managed browser could not start.");
    error.code = started.code || "vibe64_managed_browser_start_failed";
    throw error;
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await workerStatus();
    if (status) {
      return status;
    }
    await delay(100);
  }
  await controlRequest("/agent-preview-command/browser-stop", { browserSocketPath }).catch(() => null);
  throw new Error("Vibe64 managed browser worker did not become ready.");
}

async function ensureWorker() {
  return await workerStatus() || startWorker();
}

async function closeWorker() {
  try {
    await workerRequest({ command: "close" }, { timeoutMs: 2000 });
  } catch {}
  const stopped = await controlRequest("/agent-preview-command/browser-stop", {
    browserSocketPath
  });
  if (stopped.ok === false) {
    throw new Error(stopped.error || "Managed browser did not stop cleanly.");
  }
}

async function runWorker(input = {}) {
  await ensureWorker();
  try {
    return await workerRequest(input);
  } catch (error) {
    if (!["ECONNREFUSED", "ENOENT"].includes(String(error?.code || ""))) {
      throw error;
    }
    await startWorker();
    return workerRequest(input);
  }
}

async function interactiveCommand(command, input = {}, session = null) {
  let currentSession = session || await previewSession();
  let response = await runWorker({
    ...input,
    command,
    ...currentSession
  });
  if (response.ok === false && response.code === "vibe64_managed_browser_navigation_failed") {
    currentSession = await previewSession();
    await runWorker({
      command: "reconnect",
      ...currentSession
    });
    response = await runWorker({
      ...input,
      command,
      ...currentSession
    });
  }
  if (response.ok === false) {
    throw new Error(response.error || "Vibe64 managed browser command failed.");
  }
  return response.value;
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\\n");
}

if (commandName !== "vibe64-preview") {
  fail("Vibe64 preview command wrapper was invoked with an unsupported command.", 64);
}
if (!controlSocketPath || !controlToken || !controlGeneration || !sessionId || !path.isAbsolute(managedNodePath) || !path.isAbsolute(workerScriptPath)) {
  fail("vibe64_agent_control_unavailable: Managed preview control identity is unavailable. Reconnect the assistant.", 64);
}

const args = process.argv.slice(2);
try {
  if (args[0] === "playwright-run") {
    const runner = String(args[1] || "").trim();
    if (!["node", "npm"].includes(runner)) {
      fail("Vibe64 browser-test execution requires a managed node or npm runner.", 64);
    }
    const exitCode = await streamingControlRequest("/agent-preview-command/playwright-run", {
      args: args.slice(2),
      browserSocketPath,
      cwd: process.cwd(),
      managedNodePath,
      parentExecutionId: String(process.env.VIBE64_EXECUTION_ID || "").trim(),
      targetId: String(process.env.VIBE64_PLAYWRIGHT_OUTPUT_TARGET || "").trim(),
      testRunToken: String(process.env.VIBE64_PLAYWRIGHT_TARGET_RUN || "").trim(),
      identity: String(process.env.VIBE64_PLAYWRIGHT_TARGET_IDENTITY || "").trim(),
      playwrightEnv: Object.fromEntries([
        "PLAYWRIGHT_BASE_URL",
        "PLAYWRIGHT_BROWSERS_PATH",
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD",
        "VIBE64_MANAGED_PLAYWRIGHT_TEST",
        "VIBE64_PLAYWRIGHT_STORAGE_STATE"
      ].filter((name) => Object.hasOwn(process.env, name)).map((name) => [name, process.env[name]])),
      runner,
      workerScriptPath
    });
    process.exit(exitCode);
  }
  if (args[0] === "browser") {
    const browserCommand = String(args[1] || "").trim();
    const browserArgs = args.slice(2);
    if (browserCommand === "status") {
      const status = await workerStatus();
      printJson(status ? { ...status, running: true } : { contractVersion, running: false });
      process.exit(0);
    }
    if (browserCommand === "close") {
      await closeWorker();
      process.stdout.write("Managed preview browser closed.\\n");
      process.exit(0);
    }
    if (browserCommand === "ensure" || browserCommand === "reset") {
      printJson(await interactiveCommand(browserCommand));
      process.exit(0);
    }
    if (browserCommand === "identity") {
      const identity = String(browserArgs[0] || "").trim();
      if (!identity || browserArgs.length !== 1) {
        fail("Usage: vibe64-preview browser identity <default|guest|configured-name>", 64);
      }
      const session = await previewSession();
      const authorization = await authorizeBrowserIdentity(identity);
      printJson(await interactiveCommand("identity", {
        grant: authorization.grant,
        requestedIdentity: authorization.requestedIdentity
      }, session));
      process.exit(0);
    }
    if (browserCommand === "storage-state") {
      const identity = String(browserArgs[0] || "").trim();
      const outputPath = requestedOutputPath(browserArgs.slice(1));
      if (!identity || !outputPath) {
        fail("Managed Playwright storage state requires an identity and --output path.", 64);
      }
      const session = await previewSession();
      const authorization = await authorizeBrowserIdentity(identity);
      printJson(await interactiveCommand("storage-state", {
        grant: authorization.grant,
        outputPath
      }, session));
      process.exit(0);
    }
    if (browserCommand === "eval") {
      if (browserArgs.length === 1 && ["--help", "-h"].includes(browserArgs[0])) {
        process.stdout.write(browserEvalUsage + "\\n");
        process.exit(0);
      }
      if (browserArgs.length > 0) {
        fail("Playwright code must be provided on stdin, not as a positional argument.\\n" + browserEvalUsage, 64);
      }
      const code = await readStdin();
      if (!code.trim()) {
        fail("Playwright code is required on stdin.\\n" + browserEvalUsage, 64);
      }
      printJson(await interactiveCommand("eval", {
        code
      }));
      process.exit(0);
    }
    if (browserCommand === "screenshot") {
      const outputPath = screenshotOutputPath(browserArgs);
      printJson(await interactiveCommand("screenshot", { outputPath }));
      process.exit(0);
    }
    fail("Unknown managed preview browser command: " + (browserCommand || "(missing)"), 64);
  }
  if (args[0] === "screenshot") {
    const outputPath = screenshotOutputPath(args.slice(1));
    printJson(await interactiveCommand("screenshot", { outputPath }));
    process.exit(0);
  }
  const payload = await remoteCommand(args);
  writePayload(payload);
  process.exit(payloadExitCode(payload));
} catch (error) {
  fail(errorText(error));
}
`;
}

export {
  agentPreviewWrapperSource
};
