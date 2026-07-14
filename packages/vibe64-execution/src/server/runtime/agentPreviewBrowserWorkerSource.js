function agentPreviewBrowserWorkerSource({
  contractVersion = "1",
  controlHealthFailureLimit = 4,
  controlHealthIntervalMs = 15_000,
  idleTimeoutMs = 5 * 60 * 1000,
  playwrightModulePath = ""
} = {}) {
  return `#!/usr/bin/env node
import crypto from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import process from "node:process";

const socketPath = String(process.argv[2] || "").trim();
const metadataPath = String(process.argv[3] || "").trim();
const controlSocketPath = String(process.argv[4] || "").trim();
const workerToken = String(process.env.VIBE64_PREVIEW_BROWSER_WORKER_TOKEN || "").trim();
const controlToken = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_TOKEN || "").trim();
const sessionId = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID || "").trim();
const playwrightModulePath = ${JSON.stringify(String(playwrightModulePath || ""))};
const contractVersion = ${JSON.stringify(String(contractVersion || "1"))};
const idleTimeoutMs = ${Number(idleTimeoutMs) || 5 * 60 * 1000};
const requestLimitBytes = 1024 * 1024;
const controlHealthIntervalMs = ${Number(controlHealthIntervalMs) || 15_000};
const controlHealthFailureLimit = ${Number(controlHealthFailureLimit) || 4};

if (!socketPath || !metadataPath || !controlSocketPath || !workerToken || !controlToken || !sessionId || !playwrightModulePath) {
  process.stderr.write("Vibe64 managed browser worker configuration is incomplete.\\n");
  process.exit(64);
}

const require = createRequire(import.meta.url);
const { chromium } = require(playwrightModulePath);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const state = Object.create(null);
let browser = null;
let context = null;
let page = null;
let previewUrl = "";
let previewIdentity = "";
let commandQueue = Promise.resolve();
let closing = false;
let lastUsedAt = Date.now();
let controlHealthFailures = 0;
let shutdownPromise = null;
let browserProcessGroups = [];

function safeUrl(value = "") {
  try {
    const url = new URL(String(value || ""));
    if (url.searchParams.has("vibe64_preview_token")) {
      url.searchParams.set("vibe64_preview_token", "[redacted]");
    }
    return url.toString();
  } catch {
    return "";
  }
}

function redact(text = "") {
  return String(text || "")
    .replace(/(vibe64_preview_token=)[^&\\s]+/gu, "$1[redacted]")
    .split(previewUrl).join(previewUrl ? "[managed preview URL redacted]" : "");
}

function jsonValue(value) {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function processIdentity(pid) {
  try {
    const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
    const closeIndex = stat.lastIndexOf(") ");
    const fields = stat.slice(closeIndex + 2).trim().split(/\\s+/u);
    return {
      groupId: Number(fields[2]),
      parentId: Number(fields[1]),
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

async function writeWorkerMetadata() {
  let metadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch {
    return false;
  }
  if (
    Number(metadata?.pid) !== process.pid ||
    metadata?.socketPath !== socketPath ||
    metadata?.contractVersion !== contractVersion ||
    metadata?.signature !== metadataSignature(metadata)
  ) {
    return false;
  }
  const nextMetadata = {
    ...metadata,
    browserProcessGroups: normalizedBrowserProcessGroups(browserProcessGroups)
  };
  nextMetadata.signature = metadataSignature(nextMetadata);
  const temporaryPath = metadataPath + "." + process.pid + ".tmp";
  await writeFile(temporaryPath, JSON.stringify(nextMetadata) + "\\n", { mode: 0o600 });
  await rename(temporaryPath, metadataPath);
  return true;
}

function descendantBrowserProcessGroups() {
  const processes = [];
  try {
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\\d+$/u.test(entry.name)) continue;
      const pid = Number(entry.name);
      const identity = processIdentity(pid);
      if (identity) processes.push({ pid, ...identity });
    }
  } catch {
    return [];
  }
  const descendantIds = new Set([process.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) {
      if (!descendantIds.has(entry.pid) && descendantIds.has(entry.parentId)) {
        descendantIds.add(entry.pid);
        changed = true;
      }
    }
  }
  const groups = [];
  for (const entry of processes) {
    if (!descendantIds.has(entry.pid) || entry.groupId === process.pid) continue;
    const leader = processIdentity(entry.groupId);
    if (leader?.groupId === entry.groupId && leader.startTimeTicks) {
      groups.push({
        groupId: entry.groupId,
        startTimeTicks: leader.startTimeTicks
      });
    }
  }
  return normalizedBrowserProcessGroups(groups);
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

async function terminateBrowserProcessGroups() {
  const groups = normalizedBrowserProcessGroups(browserProcessGroups)
    .filter(trackedProcessGroupAlive);
  for (const entry of groups) {
    try {
      process.kill(-entry.groupId, "SIGTERM");
    } catch {
      // The browser process group already exited.
    }
  }
  for (let attempt = 0; attempt < 20 && groups.some(trackedProcessGroupAlive); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (const entry of groups.filter(trackedProcessGroupAlive)) {
    try {
      process.kill(-entry.groupId, "SIGKILL");
    } catch {
      // The browser process group exited before the fallback signal.
    }
  }
  browserProcessGroups = [];
  await writeWorkerMetadata().catch(() => false);
}

function statusPayload() {
  return {
    browserProcessGroupCount: browserProcessGroups.length,
    contractVersion,
    connected: Boolean(browser?.isConnected?.()),
    contextReady: Boolean(context),
    pageReady: Boolean(page && !page.isClosed()),
    pid: process.pid,
    previewIdentity,
    started: Boolean(browser),
    url: safeUrl(page && !page.isClosed() ? page.url() : previewUrl)
  };
}

async function closeBrowser() {
  const currentBrowser = browser;
  page = null;
  context = null;
  browser = null;
  if (currentBrowser) {
    await currentBrowser.close().catch(() => null);
  }
  await terminateBrowserProcessGroups();
}

async function ensureBrowser(url = "", {
  identity = "",
  reset = false
} = {}) {
  const requestedUrl = String(url || "").trim();
  const requestedIdentity = String(identity || "").trim();
  if (!requestedUrl) {
    throw new Error("The managed preview URL is unavailable.");
  }
  if (
    reset ||
    !browser?.isConnected?.() ||
    !context ||
    !page ||
    page.isClosed() ||
    (requestedIdentity && previewIdentity && requestedIdentity !== previewIdentity)
  ) {
    await closeBrowser();
    try {
      browser = await chromium.launch({ headless: true });
      browserProcessGroups = descendantBrowserProcessGroups();
      await writeWorkerMetadata();
      context = await browser.newContext();
      page = await context.newPage();
      previewUrl = requestedUrl;
      previewIdentity = requestedIdentity;
      await page.goto(requestedUrl, {
        waitUntil: "domcontentloaded"
      });
    } catch (error) {
      await closeBrowser();
      error.code = error.code || "vibe64_managed_browser_navigation_failed";
      throw error;
    }
  }
  return statusPayload();
}

function outputPathFromInput(input = {}) {
  return String(input.outputPath || "").trim();
}

async function evaluateCode(input = {}) {
  const code = String(input.code || "");
  if (!code.trim()) {
    throw new Error("Playwright code is required on stdin.");
  }
  if (!page || page.isClosed()) {
    throw new Error("The managed preview browser is not ready.");
  }
  const logs = [];
  const consoleProxy = Object.freeze({
    error: (...values) => logs.push({ level: "error", values: values.map(jsonValue) }),
    info: (...values) => logs.push({ level: "info", values: values.map(jsonValue) }),
    log: (...values) => logs.push({ level: "log", values: values.map(jsonValue) }),
    warn: (...values) => logs.push({ level: "warn", values: values.map(jsonValue) })
  });
  const execute = new AsyncFunction(
    "browser",
    "context",
    "page",
    "state",
    "preview",
    "outputPath",
    "console",
    '"use strict";\\n' + code
  );
  const result = await execute(
    browser,
    context,
    page,
    state,
    Object.freeze({ url: safeUrl(page.url()) }),
    outputPathFromInput(input),
    consoleProxy
  );
  return {
    logs,
    result: jsonValue(result),
    url: safeUrl(page.url())
  };
}

async function runCommand(input = {}) {
  lastUsedAt = Date.now();
  const command = String(input.command || "").trim();
  if (command === "status") {
    return statusPayload();
  }
  if (command === "ensure") {
    return ensureBrowser(input.previewUrl, {
      identity: input.previewIdentity
    });
  }
  if (command === "reset") {
    for (const key of Object.keys(state)) {
      delete state[key];
    }
    return ensureBrowser(input.previewUrl, {
      identity: input.previewIdentity,
      reset: true
    });
  }
  if (command === "reconnect") {
    return ensureBrowser(input.previewUrl, {
      identity: input.previewIdentity,
      reset: true
    });
  }
  if (command === "eval") {
    await ensureBrowser(input.previewUrl, {
      identity: input.previewIdentity
    });
    return evaluateCode(input);
  }
  if (command === "screenshot") {
    await ensureBrowser(input.previewUrl, {
      identity: input.previewIdentity
    });
    const outputPath = outputPathFromInput(input);
    if (!outputPath) {
      throw new Error("A screenshot output path is required.");
    }
    await page.screenshot({
      fullPage: true,
      path: outputPath
    });
    return {
      outputPath,
      url: safeUrl(page.url())
    };
  }
  if (command === "close") {
    await closeBrowser();
    return {
      closed: true
    };
  }
  throw new Error("Unknown managed browser command: " + (command || "(missing)"));
}

function readRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > requestLimitBytes) {
        reject(new Error("Managed browser command input is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Managed browser command input must be valid JSON."));
      }
    });
  });
}

function send(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json"
  });
  response.end(body);
}

async function shutdown() {
  if (shutdownPromise) {
    return shutdownPromise;
  }
  closing = true;
  shutdownPromise = (async () => {
    await closeBrowser();
    await rm(socketPath, { force: true }).catch(() => null);
    await rm(metadataPath, { force: true }).catch(() => null);
  })();
  return shutdownPromise;
}

function controlHealthRequest() {
  const body = JSON.stringify({ sessionId, token: controlToken });
  return new Promise((resolve) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/agent-preview-command/health",
      socketPath: controlSocketPath,
      timeout: 3000
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode === 200));
    });
    request.once("error", () => resolve(false));
    request.once("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.end(body);
  });
}

function closeServerAndExit() {
  if (closing) {
    return;
  }
  closing = true;
  server.close(() => {
    void shutdown().finally(() => process.exit(0));
  });
}

await rm(socketPath, { force: true });
const server = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/command") {
    send(response, 404, { error: "Unknown managed browser route.", ok: false });
    return;
  }
  let input;
  try {
    input = await readRequest(request);
  } catch (error) {
    send(response, 400, { error: redact(error?.message || error), ok: false });
    return;
  }
  if (String(input.token || "") !== workerToken) {
    send(response, 403, { error: "Managed browser token is invalid.", ok: false });
    return;
  }
  const task = commandQueue.then(async () => {
    try {
      return {
        ok: true,
        value: await runCommand(input)
      };
    } catch (error) {
      return {
        code: String(error?.code || "vibe64_managed_browser_command_failed"),
        error: redact(error?.stack || error?.message || error),
        ok: false
      };
    }
  });
  commandQueue = task.then(() => null, () => null);
  const result = await task;
  send(response, result.ok ? 200 : 500, result);
  if (input.command === "close") {
    closeServerAndExit();
  }
});

server.listen(socketPath);
const idleTimer = setInterval(() => {
  if (Date.now() - lastUsedAt < idleTimeoutMs) {
    return;
  }
  closeServerAndExit();
}, Math.min(60_000, idleTimeoutMs));
idleTimer.unref?.();

const controlHealthTimer = setInterval(async () => {
  if (closing) {
    return;
  }
  const healthy = await controlHealthRequest();
  controlHealthFailures = healthy ? 0 : controlHealthFailures + 1;
  if (controlHealthFailures >= controlHealthFailureLimit) {
    closeServerAndExit();
  }
}, controlHealthIntervalMs);
controlHealthTimer.unref?.();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    closeServerAndExit();
  });
}
`;
}

export {
  agentPreviewBrowserWorkerSource
};
