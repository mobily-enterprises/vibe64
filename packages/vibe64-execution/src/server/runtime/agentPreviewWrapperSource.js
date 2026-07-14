function agentPreviewWrapperSource({
  contractVersion = "1",
  managedNodePath = "",
  workerScriptPath = ""
} = {}) {
  return `#!/usr/bin/env node
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const commandName = path.basename(process.argv[1] || "");
const contractVersion = ${JSON.stringify(String(contractVersion || "1"))};
const managedNodePath = ${JSON.stringify(String(managedNodePath || ""))};
const workerScriptPath = ${JSON.stringify(String(workerScriptPath || ""))};
const wrapperDir = path.dirname(process.argv[1] || "");
const browserSocketPath = path.join(wrapperDir, "preview-browser.sock");
const browserMetadataPath = path.join(wrapperDir, "preview-browser.json");
const browserLockPath = path.join(wrapperDir, "preview-browser.lock");
const controlSocketPath = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_SOCKET || "").trim();
const controlToken = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_TOKEN || "").trim();
const sessionId = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID || "").trim();
const workerToken = crypto.createHash("sha256")
  .update(["vibe64-preview-browser", sessionId, controlToken].join("\\n"))
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

function requestSocket({ body, requestPath, socketPath, timeoutMs = 15_000 }) {
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
    request.once("timeout", () => request.destroy(new Error("Vibe64 preview command timed out.")));
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
    process.stderr.write(errorText(payload.error) + "\\n");
  }
}

async function remoteCommand(args = []) {
  const response = await requestSocket({
    body: {
      args,
      cwd: process.cwd(),
      sessionId,
      token: controlToken
    },
    requestPath: "/agent-preview-command/run",
    socketPath: controlSocketPath
  });
  return parsedResponse(response);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function screenshotOutputPath(args = []) {
  const outputIndex = args.indexOf("--output");
  const outputEntry = args.find((arg) => String(arg || "").startsWith("--output="));
  const requested = outputIndex >= 0
    ? String(args[outputIndex + 1] || "").trim()
    : String(outputEntry || "").slice("--output=".length).trim();
  const safeSessionId = String(sessionId || "session").replace(/[^A-Za-z0-9_.-]+/gu, "-");
  return path.resolve(requested || path.join(process.env.TMPDIR || "/tmp", "vibe64-current-page-" + safeSessionId + ".png"));
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
    previewIdentity: [status.launchTargetId, status.terminal?.id].filter(Boolean).join(":"),
    previewUrl
  };
}

async function readMetadata() {
  try {
    const value = JSON.parse(await readFile(browserMetadataPath, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function normalizedBrowserProcessGroups(value = []) {
  const groups = new Map();
  for (const entry of Array.isArray(value) ? value : []) {
    const groupId = Number(entry?.groupId);
    const startTimeTicks = String(entry?.startTimeTicks || "");
    if (Number.isSafeInteger(groupId) && groupId > 1 && startTimeTicks) {
      groups.set(groupId, { groupId, startTimeTicks });
    }
  }
  return [...groups.values()].sort((left, right) => left.groupId - right.groupId);
}

function metadataSignature(metadata = {}) {
  return crypto.createHash("sha256")
    .update([
      workerToken,
      String(metadata.contractVersion || ""),
      String(metadata.pid || ""),
      String(metadata.socketPath || ""),
      String(metadata.startTimeTicks || ""),
      String(metadata.startedAt || ""),
      String(metadata.workerScriptPath || ""),
      JSON.stringify(normalizedBrowserProcessGroups(metadata.browserProcessGroups))
    ].join("\\n"))
    .digest("hex");
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    return false;
  }
  try {
    const identity = processIdentity(pid);
    if (!identity || identity.state === "Z") return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processIdentity(pid) {
  try {
    const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
    const closeIndex = stat.lastIndexOf(") ");
    const fields = stat.slice(closeIndex + 2).trim().split(/\\s+/u);
    return {
      groupId: Number(fields[2]),
      startTimeTicks: String(fields[19] || ""),
      state: String(fields[0] || "")
    };
  } catch {
    return null;
  }
}

function processGroupAlive(groupId) {
  if (!Number.isSafeInteger(groupId) || groupId <= 1) {
    return false;
  }
  try {
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\\d+$/u.test(entry.name)) continue;
      const identity = processIdentity(Number(entry.name));
      if (identity?.groupId === groupId && identity.state !== "Z") return true;
    }
    return false;
  } catch {
    try {
      process.kill(-groupId, 0);
      return true;
    } catch {
      return false;
    }
  }
}

function trackedProcessGroupAlive(entry = {}) {
  const groupId = Number(entry?.groupId);
  const identity = processIdentity(groupId);
  return Boolean(
    identity &&
    identity.groupId === groupId &&
    identity.startTimeTicks === String(entry?.startTimeTicks || "") &&
    processGroupAlive(groupId)
  );
}

async function metadataOwnsProcess(metadata = {}) {
  const pid = Number(metadata?.pid);
  if (
    metadata?.contractVersion !== contractVersion ||
    metadata?.socketPath !== browserSocketPath ||
    metadata?.workerScriptPath !== workerScriptPath ||
    metadata?.signature !== metadataSignature(metadata)
  ) {
    return false;
  }
  const identity = processIdentity(pid);
  if (!identity) {
    const startedAtMs = Date.parse(String(metadata?.startedAt || ""));
    const ownsLiveGroup = processGroupAlive(pid) ||
      normalizedBrowserProcessGroups(metadata?.browserProcessGroups).some(trackedProcessGroupAlive);
    return Number.isFinite(startedAtMs) &&
      Date.now() - startedAtMs < 24 * 60 * 60 * 1000 &&
      ownsLiveGroup;
  }
  if (
    identity.groupId !== pid ||
    identity.startTimeTicks !== String(metadata?.startTimeTicks || "")
  ) {
    return false;
  }
  if (identity.state === "Z") {
    return true;
  }
  try {
    const commandLine = (await readFile("/proc/" + pid + "/cmdline", "utf8")).split("\\0");
    return commandLine.includes(workerScriptPath) && commandLine.includes(browserSocketPath);
  } catch {
    return metadata?.socketPath === browserSocketPath && metadata?.contractVersion === contractVersion;
  }
}

async function terminateProcessGroup(groupId, expectedStartTimeTicks = "") {
  if (expectedStartTimeTicks) {
    const identity = processIdentity(groupId);
    if (
      !identity ||
      identity.groupId !== groupId ||
      identity.startTimeTicks !== String(expectedStartTimeTicks)
    ) {
      return;
    }
  }
  if (!processGroupAlive(groupId)) {
    return;
  }
  try {
    process.kill(-groupId, "SIGTERM");
  } catch {
    try {
      process.kill(groupId, "SIGTERM");
    } catch {}
  }
  for (let attempt = 0; attempt < 10 && processGroupAlive(groupId); attempt += 1) {
    await delay(50);
  }
  if (processGroupAlive(groupId)) {
    try {
      process.kill(-groupId, "SIGKILL");
    } catch {
      try {
        process.kill(groupId, "SIGKILL");
      } catch {}
    }
  }
}

async function killWorkerGroup(metadata = null) {
  const current = metadata || await readMetadata();
  if (!await metadataOwnsProcess(current || {})) {
    return;
  }
  const pid = Number(current.pid);
  const browserGroups = normalizedBrowserProcessGroups(current.browserProcessGroups)
    .filter(trackedProcessGroupAlive);
  await Promise.all([
    terminateProcessGroup(pid, current.startTimeTicks),
    ...browserGroups.map((entry) => terminateProcessGroup(entry.groupId, entry.startTimeTicks))
  ]);
}

async function removeWorkerFiles() {
  await Promise.all([
    rm(browserSocketPath, { force: true }),
    rm(browserMetadataPath, { force: true })
  ]).catch(() => null);
}

async function workerRequest(input = {}, { timeoutMs = 30_000 } = {}) {
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

async function acquireWorkerLock() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await mkdir(browserLockPath);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await workerStatus()) {
        return false;
      }
      await delay(100);
    }
  }
  await rm(browserLockPath, { force: true, recursive: true });
  await mkdir(browserLockPath);
}

async function startWorker() {
  const acquired = await acquireWorkerLock();
  if (acquired === false) {
    return workerStatus();
  }
  try {
    const existing = await workerStatus();
    if (existing) {
      return existing;
    }
    const metadata = await readMetadata();
    await killWorkerGroup(metadata);
    await removeWorkerFiles();
    const child = spawn(managedNodePath, [
      workerScriptPath,
      browserSocketPath,
      browserMetadataPath,
      controlSocketPath
    ], {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        VIBE64_PREVIEW_BROWSER_WORKER_TOKEN: workerToken
      },
      stdio: "ignore"
    });
    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.unref();
    let identity = processIdentity(child.pid);
    for (let attempt = 0; attempt < 20 && !identity && !spawnError; attempt += 1) {
      await delay(5);
      identity = processIdentity(child.pid);
    }
    const nextMetadata = {
      browserProcessGroups: [],
      contractVersion,
      pid: child.pid,
      socketPath: browserSocketPath,
      startTimeTicks: identity?.startTimeTicks || "",
      startedAt: new Date().toISOString(),
      workerScriptPath
    };
    nextMetadata.signature = metadataSignature(nextMetadata);
    await writeFile(browserMetadataPath, JSON.stringify(nextMetadata) + "\\n", { mode: 0o600 });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (spawnError) {
        break;
      }
      const status = await workerStatus();
      if (status) {
        return status;
      }
      if (!processAlive(child.pid)) {
        break;
      }
      await delay(100);
    }
    await killWorkerGroup(await readMetadata());
    await removeWorkerFiles();
    if (spawnError) {
      throw spawnError;
    }
    throw new Error("Vibe64 managed browser worker did not start.");
  } finally {
    await rm(browserLockPath, { force: true, recursive: true });
  }
}

async function ensureWorker() {
  return await workerStatus() || startWorker();
}

async function closeWorker() {
  const metadata = await readMetadata();
  try {
    await workerRequest({ command: "close" }, { timeoutMs: 2000 });
  } catch {}
  for (let attempt = 0; attempt < 20 && processAlive(Number(metadata?.pid)); attempt += 1) {
    await delay(50);
  }
  await killWorkerGroup(metadata);
  await removeWorkerFiles();
}

async function runWorker(input = {}) {
  await ensureWorker();
  try {
    return await workerRequest(input);
  } catch (error) {
    if (!["ECONNREFUSED", "ENOENT"].includes(String(error?.code || ""))) {
      throw error;
    }
    await killWorkerGroup(await readMetadata());
    await removeWorkerFiles();
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
if (!controlSocketPath || !controlToken || !sessionId || !path.isAbsolute(managedNodePath) || !path.isAbsolute(workerScriptPath)) {
  fail("Vibe64 preview command identity is not available for this session.", 64);
}

const args = process.argv.slice(2);
try {
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
    if (browserCommand === "eval") {
      printJson(await interactiveCommand("eval", {
        code: await readStdin()
      }));
      process.exit(0);
    }
    if (browserCommand === "screenshot") {
      const outputPath = screenshotOutputPath(browserArgs);
      await interactiveCommand("screenshot", { outputPath });
      process.stdout.write("Screenshot saved to " + outputPath + "\\n");
      process.exit(0);
    }
    fail("Unknown managed preview browser command: " + (browserCommand || "(missing)"), 64);
  }
  if (args[0] === "screenshot") {
    const outputPath = screenshotOutputPath(args.slice(1));
    await interactiveCommand("screenshot", { outputPath });
    process.stdout.write("Screenshot saved to " + outputPath + "\\n");
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
