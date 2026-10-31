// A session's registered Preview browser worker: starting, finding and stopping it with its process
// groups, and running the project's Playwright tests through it.

import crypto from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathInsideOrEqual } from "@local/vibe64-core/server/core";
import { vibe64ErrorResponse } from "@local/vibe64-core/server/serverResponses";
import {
  LOCAL_PLAYWRIGHT_MESSAGE,
  computerPlaywrightModulePath,
  processGroupHasLiveMember,
  readProcessStart,
  runVibe64Command,
  stopVibe64Execution,
  stopVibe64OwnedExecutions
} from "@local/vibe64-execution/server";
import { removeDeadUnixJsonCommandSocket, requestUnixJsonCommand, unixCommandSocketIsPresent } from "./unixJsonCommand.js";
import { trimmedText as normalizeText } from "./trimmedText.js";
import { isRecord } from "./isRecord.js";

const PROJECT_PLAYWRIGHT_MISSING_MESSAGE =
  "Browser checks need Playwright, and neither this project nor this computer has it. Report this and ask the person " +
  "to install it on this computer (npm install -g playwright, then playwright install chromium). Do not add Playwright " +
  "to a project that is not already a Node.js project just for these checks.";

const DEFAULT_PLAYWRIGHT_RUN_TIMEOUT_MS = 30 * 60 * 1000;

function responseError(message = "", code = "vibe64_agent_preview_command_failed", extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    ok: false
  };
}

function normalizedBrowserProcessGroups(value = []) {
  const groups = new Map();
  for (const entry of Array.isArray(value) ? value : []) {
    const groupId = Number(entry?.groupId);
    const startTimeTicks = normalizeText(entry?.startTimeTicks);
    if (Number.isSafeInteger(groupId) && groupId > 1 && startTimeTicks) {
      groups.set(groupId, {
        groupId,
        startTimeTicks
      });
    }
  }
  return [...groups.values()].sort((left, right) => left.groupId - right.groupId);
}

function browserWorkerMetadataSignature(metadata = {}, token = "") {
  return crypto
    .createHash("sha256")
    .update([
      normalizeText(token),
      normalizeText(metadata.contractVersion),
      normalizeText(metadata.executionId),
      String(metadata.pid || ""),
      normalizeText(metadata.socketPath),
      normalizeText(metadata.startTimeTicks),
      normalizeText(metadata.startedAt),
      normalizeText(metadata.workerScriptPath),
      JSON.stringify(normalizedBrowserProcessGroups(metadata.browserProcessGroups))
    ].join("\n"))
    .digest("hex");
}

async function browserWorkerRequest({
  input = {},
  socketPath = "",
  token = "",
  timeoutMs = 2000
} = {}) {
  const response = await requestUnixJsonCommand({
    body: {
      ...input,
      token
    },
    path: "/command",
    socketPath,
    timeoutMs
  });
  return response.payload || responseError(
    "Managed browser returned an invalid response.",
    "vibe64_managed_browser_response_invalid"
  );
}

async function registeredProcessGroupIsAlive(entry = {}) {
  const groupId = Number(entry?.groupId);
  const leader = await readProcessStart(groupId);
  if (
    leader.status !== "exact" ||
    leader.groupId !== groupId ||
    leader.startTimeTicks !== normalizeText(entry?.startTimeTicks)
  ) {
    return false;
  }
  return processGroupHasLiveMember(groupId);
}

async function drainRegisteredProcessGroup(entry = {}) {
  if (!await registeredProcessGroupIsAlive(entry)) {
    return true;
  }
  try {
    process.kill(-Number(entry.groupId), "SIGTERM");
    // The worker stops its browser between commands; a stopped process acts
    // on SIGTERM only once continued.
    process.kill(-Number(entry.groupId), "SIGCONT");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
  for (let attempt = 0; attempt < 60 && await registeredProcessGroupIsAlive(entry); attempt += 1) {
    await delay(50);
  }
  if (await registeredProcessGroupIsAlive(entry)) {
    try {
      process.kill(-Number(entry.groupId), "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw error;
      }
    }
  }
  for (let attempt = 0; attempt < 20 && await registeredProcessGroupIsAlive(entry); attempt += 1) {
    await delay(50);
  }
  return !await registeredProcessGroupIsAlive(entry);
}

async function registeredWorkerMetadata(descriptor = {}) {
  try {
    const metadata = JSON.parse(await readFile(descriptor.metadataPath, "utf8"));
    const executionId = normalizeText(metadata?.executionId);
    if (
      !/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,254}[A-Za-z0-9])?$/u.test(executionId) ||
      (normalizeText(descriptor.executionId) && executionId !== normalizeText(descriptor.executionId)) ||
      metadata?.socketPath !== descriptor.socketPath ||
      metadata?.workerScriptPath !== descriptor.workerScriptPath ||
      metadata?.contractVersion !== descriptor.contractVersion ||
      metadata?.signature !== browserWorkerMetadataSignature(metadata, descriptor.token)
    ) {
      return null;
    }
    return metadata;
  } catch {
    return null;
  }
}

async function registeredWorkerStatus(descriptor = {}) {
  try {
    const payload = await browserWorkerRequest({
      input: { command: "status" },
      socketPath: descriptor.socketPath,
      token: descriptor.token
    });
    return payload?.ok === true &&
      payload.value?.contractVersion === descriptor.contractVersion
      ? payload.value
      : null;
  } catch {
    return null;
  }
}

async function fileExists(filePath = "") {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function browserCleanupFault(message = "The managed browser execution could not be proven empty.") {
  return responseError(message, "vibe64_execution_cleanup_required", {
    retryable: false
  });
}

async function stopRegisteredBrowserWorker(descriptor = {}, {
  reason = "browser-stop",
  skipStartWait = false,
  stopExecution = stopVibe64Execution,
  stopOwnedExecutions = stopVibe64OwnedExecutions
} = {}) {
  if (!skipStartWait && descriptor.startPromise) {
    await descriptor.startPromise.catch(() => null);
  }
  const retiredDescriptors = descriptor.retiredDescriptors || [];
  descriptor.retiredDescriptors = [];
  for (const retired of retiredDescriptors) {
    const retiredResult = await stopRegisteredBrowserWorker(retired, {
      reason: "browser-generation-replaced",
      stopExecution,
      stopOwnedExecutions
    });
    if (retiredResult.ok !== true) {
      descriptor.retiredDescriptors.unshift(retired);
      return retiredResult;
    }
  }
  const metadata = await registeredWorkerMetadata(descriptor);
  await browserWorkerRequest({
    input: {
      command: "close"
    },
    socketPath: descriptor.socketPath,
    token: descriptor.token
  }).catch(() => null);
  const executionIds = [...new Set([
    normalizeText(descriptor.executionId),
    normalizeText(metadata?.executionId)
  ].filter(Boolean))];
  if (executionIds.length === 0 && (
    await unixCommandSocketIsPresent(descriptor.socketPath) ||
    await fileExists(descriptor.metadataPath)
  )) {
    const cleanup = await stopOwnedExecutions({
      kind: "browser",
      ownerId: descriptor.sessionId,
      projectSlug: normalizeText(descriptor.project?.slug),
      sessionId: descriptor.sessionId
    }, { reason });
    if (cleanup?.supported !== true || cleanup?.scopeEmpty !== true) {
      return browserCleanupFault(
        cleanup?.error || "The managed browser has no valid execution ownership record; no replacement was started."
      );
    }
    try {
      await removeDeadUnixJsonCommandSocket(descriptor.socketPath);
    } catch {
      return browserCleanupFault(
        "The managed browser socket still has an unverified listener; no replacement was started."
      );
    }
  }
  for (const executionId of executionIds) {
    const stopped = await stopExecution(executionId, { reason });
    if (stopped?.scopeEmpty !== true) {
      return browserCleanupFault(stopped?.error);
    }
  }
  for (const group of normalizedBrowserProcessGroups(metadata?.browserProcessGroups)) {
    if (!await drainRegisteredProcessGroup(group)) {
      return browserCleanupFault(
        `Managed browser process group ${group.groupId} did not become empty.`
      );
    }
  }
  await Promise.all([
    rm(descriptor.socketPath, {
      force: true
    }),
    rm(descriptor.metadataPath, {
      force: true
    })
  ]).catch(() => null);
  descriptor.executionId = "";
  return {
    ok: true,
    scopeEmpty: true,
    stopped: executionIds.length > 0
  };
}

function registeredBrowserWorkerForInput(sessionId = "", input = {}, browserWorkers = new Map()) {
  const normalizedSessionId = normalizeText(sessionId);
  const socketPath = normalizeText(input.browserSocketPath);
  const descriptor = browserWorkers.get(normalizedSessionId)?.get(socketPath);
  if (!descriptor) {
    return {
      error: responseError(
        "The managed browser is not registered for this assistant session.",
        "vibe64_managed_browser_not_registered"
      )
    };
  }
  if (
    normalizeText(input.managedNodePath) !== descriptor.managedNodePath ||
    normalizeText(input.workerScriptPath) !== descriptor.workerScriptPath
  ) {
    return {
      error: responseError(
        "The managed browser command does not match the registered runtime.",
        "vibe64_managed_browser_runtime_invalid"
      )
    };
  }
  const worktreePath = path.resolve(descriptor.worktreePath);
  const cwd = path.resolve(normalizeText(input.cwd) || worktreePath);
  if (!pathInsideOrEqual(worktreePath, cwd)) {
    return {
      error: responseError(
        "The managed browser working directory is outside this session source.",
        "vibe64_managed_browser_cwd_invalid"
      )
    };
  }
  return { cwd, descriptor };
}

async function runRegisteredPlaywrightCommand(sessionId = "", input = {}, {
  browserWorkers = new Map(),
  onOutput = null,
  signal = null,
  runCommand = runVibe64Command,
  withTarget = null
} = {}) {
  const registered = registeredBrowserWorkerForInput(sessionId, input, browserWorkers);
  if (registered.error) {
    return registered.error;
  }
  const { cwd, descriptor } = registered;
  if (!descriptor.runtimeRoot) {
    return responseError(LOCAL_PLAYWRIGHT_MESSAGE, "vibe64_preview_playwright_local");
  }
  const parentExecutionId = normalizeText(input.parentExecutionId);
  if (!parentExecutionId) {
    return responseError(
      "Browser testing requires a live assistant execution owner.",
      "vibe64_managed_browser_parent_required"
    );
  }
  const runner = normalizeText(input.runner);
  const args = Array.isArray(input.args)
    ? input.args.map((value) => String(value ?? ""))
    : [];
  let command = "";
  let scriptText = "";
  if (runner === "node") {
    const cliPath = path.resolve(normalizeText(args[0]));
    const relativeCliPath = path.relative(path.resolve(descriptor.worktreePath), cliPath);
    if (
      !normalizeText(args[0]) ||
      !pathInsideOrEqual(descriptor.worktreePath, cliPath) ||
      !/node_modules\/(?:@playwright\/test|playwright)\/cli\.js$/u.test(relativeCliPath.split(path.sep).join("/"))
    ) {
      return responseError(
        "The browser-test command does not use this project's Playwright CLI.",
        "vibe64_managed_playwright_cli_invalid"
      );
    }
    command = descriptor.managedNodePath;
  } else if (runner === "npm") {
    const scriptName = normalizeText(args[1]);
    let packageRecord = null;
    try {
      packageRecord = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
    } catch {
      packageRecord = null;
    }
    const declaredScript = normalizeText(packageRecord?.scripts?.[scriptName]);
    if (
      args[0] !== "run" ||
      !scriptName ||
      !declaredScript ||
      (!scriptName.startsWith("test:playwright:") &&
        !declaredScript.includes("playwright"))
    ) {
      return responseError(
        "The requested package script is not a declared Playwright test script.",
        "vibe64_managed_playwright_script_invalid"
      );
    }
    command = descriptor.managedNpmPath;
    scriptText = packageRecord.scripts[scriptName];
  } else {
    return responseError(
      "Browser testing requires the registered managed node or npm runner.",
      "vibe64_managed_playwright_runner_invalid"
    );
  }

  const requestedEnv = isRecord(input.playwrightEnv) ? input.playwrightEnv : {};
  const targetId = normalizeText(input.targetId);
  const scopedPreview = Boolean(targetId || input.restorePreview === true);
  if (targetId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(targetId)) {
    return responseError("Choose an exact declared Preview target id.", "vibe64_preview_target_invalid");
  }
  let baseUrl = "";
  try {
    if (!scopedPreview) {
      const parsed = new URL(normalizeText(requestedEnv.PLAYWRIGHT_BASE_URL));
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Unsupported preview protocol.");
      }
      baseUrl = normalizeText(requestedEnv.PLAYWRIGHT_BASE_URL);
    }
  } catch {
    return responseError(
      "Browser testing requires a valid managed HTTP preview URL.",
      "vibe64_managed_playwright_base_url_invalid"
    );
  }
  const browsersPath = path.resolve(normalizeText(requestedEnv.PLAYWRIGHT_BROWSERS_PATH));
  const runtimeRoot = path.resolve(descriptor.runtimeRoot);
  if (
    !normalizeText(requestedEnv.PLAYWRIGHT_BROWSERS_PATH) ||
    !pathInsideOrEqual(runtimeRoot, browsersPath) ||
    path.basename(browsersPath) !== "browsers"
  ) {
    return responseError(
      "Browser testing requires a registered Vibe64 browser runtime.",
      "vibe64_managed_playwright_runtime_invalid"
    );
  }
  const storageStatePath = normalizeText(requestedEnv.VIBE64_PLAYWRIGHT_STORAGE_STATE);
  if (storageStatePath && !path.isAbsolute(storageStatePath)) {
    return responseError(
      "The managed Playwright storage-state path must be absolute.",
      "vibe64_managed_playwright_storage_state_invalid"
    );
  }
  const request = {
    actor: "daemon",
    allowedRoots: [descriptor.worktreePath],
    args,
    command,
    cwd,
    env: {
      PLAYWRIGHT_BASE_URL: baseUrl,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      VIBE64_MANAGED_PLAYWRIGHT_TEST: "1",
      ...(storageStatePath ? {
        VIBE64_PLAYWRIGHT_STORAGE_STATE: storageStatePath
      } : {})
    },
    envPolicy: "preview",
    execution: {
      controlGenerationId: descriptor.controlGenerationId,
      kind: "browser",
      label: "Browser testing",
      lifecycle: "finite",
      ownerId: descriptor.sessionId,
      parentExecutionId,
      projectSlug: descriptor.project?.slug,
      sessionId: descriptor.sessionId
    },
    maxBuffer: 32 * 1024 * 1024,
    mode: "capture",
    onOutput,
    signal,
    project: descriptor.project,
    purpose: "preview",
    runtimes: ["node26", "playwright", "git"],
    session: {
      sessionId: descriptor.sessionId
    },
    timeout: DEFAULT_PLAYWRIGHT_RUN_TIMEOUT_MS
  };
  if (!scopedPreview) return runCommand(request);
  if (requestedEnv.PLAYWRIGHT_BASE_URL || storageStatePath) {
    return responseError("--target requires its own managed Preview URL and identity; do not supply an external URL or storage state.", "vibe64_preview_target_conflict");
  }
  async function validate() {
    const current = registeredBrowserWorkerForInput(sessionId, input, browserWorkers);
    if (current.error || current.descriptor.token !== descriptor.token ||
        current.descriptor.controlGenerationId !== descriptor.controlGenerationId) {
      throw Object.assign(new Error("The original browser-test command generation has ended. Tests were not run."), {
        code: "vibe64_test_approval_interrupted"
      });
    }
    if (runner === "npm") {
      const latest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
      if (latest.scripts?.[args[1]] !== scriptText) throw new Error("The test script changed while awaiting approval. Run the new command explicitly.");
    }
    return current;
  }
  return withTarget(targetId, (testRunToken) => runCommand({
    ...request,
    execution: { ...request.execution, kind: "control", label: "Browser test setup" },
    command: descriptor.managedNodePath,
    args: [
      descriptor.playwrightWrapperPath,
      ...(input.identity ? ["--identity", String(input.identity)] : []),
      ...(runner === "node" ? ["test", ...args.slice(2)] : ["npm-run", ...args.slice(1)])
    ],
    env: {
      ...request.env, ...descriptor.env,
      VIBE64_PLAYWRIGHT_TARGET_RUN: testRunToken,
      PLAYWRIGHT_BASE_URL: "",
      VIBE64_PLAYWRIGHT_STORAGE_STATE: ""
    }
  }), validate);
}

function projectHasPlaywright(worktreePath = "") {
  try {
    createRequire(path.join(worktreePath, "package.json")).resolve("playwright");
    return true;
  } catch {
    return false;
  }
}

async function startRegisteredBrowserWorker(sessionId = "", input = {}, {
  browserWorkers = new Map(),
  runCommand = runVibe64Command,
  stopExecution = stopVibe64Execution,
  stopOwnedExecutions = stopVibe64OwnedExecutions
} = {}) {
  const registered = registeredBrowserWorkerForInput(sessionId, input, browserWorkers);
  if (registered.error) {
    return registered.error;
  }
  const { cwd, descriptor } = registered;
  if (!descriptor.runtimeRoot && !projectHasPlaywright(descriptor.worktreePath) &&
      !computerPlaywrightModulePath(process.env.PATH)) {
    return responseError(PROJECT_PLAYWRIGHT_MISSING_MESSAGE, "vibe64_preview_playwright_missing");
  }
  if (descriptor.startPromise) {
    return descriptor.startPromise;
  }
  const startPromise = (async () => {
    for (const retired of descriptor.retiredDescriptors || []) {
      const retiredResult = await stopRegisteredBrowserWorker(retired, {
        reason: "browser-generation-replaced",
        stopExecution,
        stopOwnedExecutions
      });
      if (retiredResult.ok !== true) {
        return retiredResult;
      }
    }
    descriptor.retiredDescriptors = [];

    const existingStatus = await registeredWorkerStatus(descriptor);
    const existingMetadata = await registeredWorkerMetadata(descriptor);
    if (existingStatus && existingMetadata) {
      descriptor.executionId = existingMetadata.executionId;
      return {
        executionId: descriptor.executionId,
        ok: true,
        value: existingStatus
      };
    }
    if (
      existingMetadata || normalizeText(descriptor.executionId) ||
      await unixCommandSocketIsPresent(descriptor.socketPath) ||
      await fileExists(descriptor.metadataPath)
    ) {
      const drained = await stopRegisteredBrowserWorker(descriptor, {
        reason: "browser-restart",
        skipStartWait: true,
        stopExecution,
        stopOwnedExecutions
      });
      if (drained.ok !== true) {
        return drained;
      }
    }

    const result = await runCommand({
      actor: "daemon",
      allowedRoots: [descriptor.worktreePath],
      args: [
        descriptor.workerScriptPath,
        descriptor.socketPath,
        descriptor.metadataPath,
        descriptor.controlSocketPath
      ],
      command: descriptor.managedNodePath,
      cwd,
      env: descriptor.env,
      envPolicy: "preview",
      execution: {
        controlGenerationId: descriptor.controlGenerationId,
        kind: "browser",
        label: "Managed browser",
        lifecycle: "service",
        ownerId: descriptor.sessionId,
        // The session control owns this reusable browser, not its first tool call.
        projectSlug: descriptor.project?.slug,
        sessionId: descriptor.sessionId
      },
      mode: "detached",
      project: descriptor.project,
      purpose: "preview",
      runtimes: ["node26", "playwright"],
      session: {
        sessionId: descriptor.sessionId
      }
    });
    if (result?.ok !== true) {
      return result;
    }
    descriptor.executionId = normalizeText(result.execution?.id);
    if (!descriptor.executionId) {
      return browserCleanupFault(
        "The managed browser started without an execution ownership record."
      );
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [status, metadata] = await Promise.all([
        registeredWorkerStatus(descriptor),
        registeredWorkerMetadata(descriptor)
      ]);
      if (status && metadata?.executionId === descriptor.executionId) {
        return {
          executionId: descriptor.executionId,
          ok: true,
          value: status
        };
      }
      await delay(100);
    }
    const drained = await stopRegisteredBrowserWorker(descriptor, {
      reason: "browser-readiness-timeout",
      skipStartWait: true,
      stopExecution,
      stopOwnedExecutions
    });
    if (drained.ok !== true) {
      return drained;
    }
    return responseError(
      "The managed browser worker did not become ready.",
      "vibe64_managed_browser_readiness_timeout"
    );
  })();
  descriptor.startPromise = startPromise;
  try {
    return await startPromise;
  } finally {
    if (descriptor.startPromise === startPromise) {
      descriptor.startPromise = null;
    }
  }
}

async function stopRegisteredBrowserWorkerForInput(sessionId = "", input = {}, {
  browserWorkers = new Map(),
  stopExecution = stopVibe64Execution,
  stopOwnedExecutions = stopVibe64OwnedExecutions
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const descriptor = browserWorkers
    .get(normalizedSessionId)
    ?.get(normalizeText(input.browserSocketPath));
  if (!descriptor) {
    return responseError(
      "The managed browser is not registered for this assistant session.",
      "vibe64_managed_browser_not_registered"
    );
  }
  return stopRegisteredBrowserWorker(descriptor, {
    reason: "browser-close",
    stopExecution,
    stopOwnedExecutions
  });
}

// Streams the browser-test output as NDJSON frames, ending with its result.
async function streamPlaywrightRun({ commandService, input, response, sessionId }) {
  const cancellation = new AbortController();
  response.once("close", () => {
    if (!response.writableEnded) cancellation.abort(new Error("Browser-test command was cancelled or disconnected."));
  });
  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8"
  });
  const writeFrame = (payload = {}) => {
    if (!response.destroyed && !response.writableEnded) {
      response.write(`${JSON.stringify(payload)}\n`);
    }
  };
  let payload;
  try {
    payload = await commandService.playwrightRun(sessionId, input, {
      signal: cancellation.signal,
      onOutput: (chunk) => writeFrame({
        data: Buffer.from(String(chunk || ""), "utf8").toString("base64"),
        type: "output"
      })
    });
  } catch (error) {
    payload = vibe64ErrorResponse(error, {
      fallbackCode: "vibe64_managed_playwright_run_failed",
      fallbackMessage: "Vibe64 browser-test execution failed."
    });
  }
  writeFrame({
    code: normalizeText(payload?.code),
    error: normalizeText(payload?.error || payload?.stderr),
    ...(isRecord(payload?.details?.admission) ? { details: { admission: payload.details.admission } } : {}),
    exitCode: Number.isInteger(payload?.exitCode) ? payload.exitCode : (payload?.ok === false ? 1 : 0),
    ok: payload?.ok !== false,
    timedOut: payload?.timedOut === true,
    type: "result"
  });
  response.end();
}

export {
  responseError,
  runRegisteredPlaywrightCommand,
  startRegisteredBrowserWorker,
  stopRegisteredBrowserWorker,
  stopRegisteredBrowserWorkerForInput,
  streamPlaywrightRun
};
