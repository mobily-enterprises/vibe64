// The wrapper owns the preview CLI surface, so help works without the
// control socket; the session command service reuses this text.
const AGENT_PREVIEW_USAGE = [
  "Usage:",
  "  vibe64-helper preview ensure [--target <target-id>] [--wait] [--json] [--timeout-ms <ms>]",
  "  vibe64-helper preview targets [--json]",
  "  vibe64-helper preview status [--json]",
  "  vibe64-helper preview stop [--json]",
  "  vibe64-helper preview inspect-url",
  "  vibe64-helper preview screenshot [--output <path>]",
  "  vibe64-helper preview browser ensure",
  "  vibe64-helper preview browser eval < playwright-code.js",
  "  vibe64-helper preview browser identity <default|guest|configured-name>",
  "  vibe64-helper preview browser storage-state <default|guest|configured-name> --output <new-path>",
  "  vibe64-helper preview browser screenshot [--output <path>]",
  "  vibe64-helper preview browser status",
  "  vibe64-helper preview browser reset",
  "  vibe64-helper preview browser close",
  "  vibe64-helper preview identities",
  "  vibe64-helper preview identities save < identities.json",
  "  vibe64-helper preview logs [--lines <count>] [--json]",
  "  vibe64-helper preview restart [--wait] [--json] [--timeout-ms <ms>]",
  "  vibe64-helper playwright [--target <target-id>] [--identity <default|guest|configured-name>] test [playwright test arguments]",
  "  vibe64-helper playwright [--target <target-id>] [--identity <default|guest|configured-name>] npm-run <package-script> [-- script arguments]",
  "",
  "JSON output:",
  "  status/ensure/restart/stop --json: ready, stoppedIntent, stale, outputTargetId, endpoints.browser {url, hostname, port}, currentPage {url, route, title, observedAt}, terminal {id, status, running, exitCode, command, createdAt}, defaultIdentity, identities [{name, type}], identityTypes, diagnostics {latest, log, directApplicationEndpoint}.",
  "  screenshot: outputPath, byteLength, sha256, capturedAt, url, title, width, height, luminance, darkPixelPercentage, domTextLength, domTextSummary.",
  "  browser eval: result (the code's JSON-safe return value), logs [{level, values}] from console, url (the page afterwards).",
  "  identities: the project's Managed app identities [{name, type, value}] (first is the default) and the Stack's declared Preview identity types.",
  "  identities save: replaces the whole ordered list with the JSON array on stdin (or {\"identities\": [...]}); each type must be declared. Save only names and accounts the person asked for or confirmed; never create app accounts or change roles for this. Then verify each with preview browser identity <name>.",
  "  browser storage-state: writes the identity's Playwright storage state to a new file at --output; the interactive browser keeps its identity.",
  "",
  "Screenshot commands emit JSON metadata for a uniquely named, immutable PNG.",
  "For browser navigation, use preview inspect-url or the status Browser URL; these use the managed Preview proxy.",
  "Inside browser eval, navigate with await page.goto(new URL('/your-path', preview.url).href).",
  "The direct application endpoint in diagnostics bypasses Preview identity; do not use it for interactive browsing.",
  "The browser keeps its page between browser commands. After each command the page keeps running for 30 seconds, then pauses (no timers, animations or network handling) until the next browser command. For a longer wait, wait inside the command, for example with await page.waitForSelector(...).",
  "Five minutes after the last browser command ends, the browser closes; the next command opens a fresh page, so select its identity again if needed.",
  "Managed Playwright suites and live preview browser actions are sequential. Wait on the suite through cleanup and restoration before browser actions or Preview ensure/restart/target changes; confirm playwright status has no active run and preview status is ready. Read-only status and logs are safe during a suite.",
  "For background commands, wait on the existing execution/session with about a 30-second window where supported: set yield_time_ms: 30000 for an empty command poll. Reserve shorter waits for interactive input or a specific immediate check; do not repeatedly reread empty or unchanged logs between brief waits.",
  "This is the canonical preview server for the configured primary application.",
  "Do not start a duplicate copy of that application on another port.",
  "A distinct secondary application explicitly requested by the user, such as a reference app, may run separately without replacing this preview."
].join("\n") + "\n";

function agentPreviewWrapperSource({
  browserSocketPath = "",
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
const browserSocketPath = ${JSON.stringify(String(browserSocketPath || ""))};
const controlSocketPath = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_SOCKET || "").trim();
const controlToken = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_TOKEN || "").trim();
const controlGeneration = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_GENERATION || "").trim();
const sessionId = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID || "").trim();
const usage = ${JSON.stringify(AGENT_PREVIEW_USAGE)};
const browserEvalUsage = "Usage: vibe64-helper preview browser eval < playwright-code.js\\nNavigate through Preview: await page.goto(new URL('/your-path', preview.url).href);\\npreview.url is the managed proxy; direct application ports bypass Preview identity.";
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
  if (payload.ok === false && payload.details?.admission) {
    process.stderr.write("Resource admission: " + JSON.stringify(payload.details.admission) + "\\n");
  }
}

async function controlRequest(requestPath, input = {}) {
  let response;
  try {
    response = await requestSocket({
      body: {
        // The parent command identity scopes workflow approval waits.
        parentExecutionId: String(process.env.VIBE64_EXECUTION_ID || "").trim(),
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
    parentExecutionId: String(process.env.VIBE64_EXECUTION_ID || "").trim(),
    ...input,
    generationId: controlGeneration,
    sessionId,
    token: controlToken
  });
  return new Promise((resolve, reject) => {
    let buffer = "";
    let finalPayload = null;
    const handleLine = (line = "") => {
      const value = String(line || "").trim();
      if (!value) {
        return;
      }
      const payload = JSON.parse(value);
      if (payload.type === "output" && payload.data) {
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
          writePayload(finalPayload);
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

async function remoteCommand(args = [], extra = {}) {
  return controlRequest("/agent-preview-command/run", {
    ...extra,
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
  const currentResponse = await remoteCommand(["status", "--json"]);
  if (payloadExitCode(currentResponse) !== 0) {
    writePayload(currentResponse);
    process.exit(payloadExitCode(currentResponse));
  }
  const current = JSON.parse(String(currentResponse.stdout || "{}"));
  if (current.stoppedIntent === true) {
    throw new Error("Preview was stopped explicitly. Run vibe64-helper preview ensure --wait to start it before browser inspection.");
  }
  const statusResponse = await remoteCommand(process.env.VIBE64_PLAYWRIGHT_TARGET_RUN
    ? ["status", "--json"]
    : ["ensure", "--wait", "--json"]);
  if (payloadExitCode(statusResponse) !== 0) {
    writePayload(statusResponse);
    process.exit(payloadExitCode(statusResponse));
  }
  const inspected = await remoteCommand(["inspect-url"]);
  if (payloadExitCode(inspected) !== 0) {
    writePayload(inspected);
    process.exit(payloadExitCode(inspected));
  }
  let status = {};
  try {
    status = JSON.parse(String(statusResponse.stdout || "{}"));
  } catch {
    status = {};
  }
  if (status.ready !== true) {
    throw new Error("The managed preview is not ready.");
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
const args = process.argv.slice(2);
const isHelp = (value) => ["help", "--help", "-h"].includes(String(value || ""));
if (!args.length || isHelp(args[0]) || (args[0] === "browser" && isHelp(args[1]))) {
  process.stdout.write(usage);
  process.exit(0);
}
if (args[0] === "browser" && !String(args[1] || "").trim()) {
  process.stderr.write("A managed preview browser command is required.\\n" + usage);
  process.exit(64);
}
if (!controlSocketPath || !controlToken || !controlGeneration || !sessionId || !path.isAbsolute(managedNodePath) || !path.isAbsolute(workerScriptPath)) {
  fail("vibe64_agent_control_unavailable: Managed preview control identity is unavailable. Reconnect the assistant.", 64);
}

try {
  if (args[0] === "playwright-status" || args[0] === "playwright-cancel") {
    const payload = await controlRequest("/agent-preview-command/" + args[0], { runId: args[1] || "" });
    printJson(payload);
    process.exit(payloadExitCode(payload));
  }
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
      restorePreview: process.env.VIBE64_PLAYWRIGHT_RESTORE_PREVIEW === "1",
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
        fail("Usage: vibe64-helper preview browser identity <default|guest|configured-name>", 64);
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
    fail("Unknown managed preview browser command: " + browserCommand + "\\n" + usage, 64);
  }
  if (args[0] === "screenshot") {
    const outputPath = screenshotOutputPath(args.slice(1));
    printJson(await interactiveCommand("screenshot", { outputPath }));
    process.exit(0);
  }
  const payload = args[0] === "identities" && args[1] === "save"
    ? await remoteCommand(args, { stdin: await readStdin() })
    : await remoteCommand(args);
  writePayload(payload);
  process.exit(payloadExitCode(payload));
} catch (error) {
  fail(errorText(error));
}
`;
}

export {
  AGENT_PREVIEW_USAGE,
  agentPreviewWrapperSource
};
