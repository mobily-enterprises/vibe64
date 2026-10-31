// The browser worker program's commands: application identities, browser
// commands, idle expiry and the HTTP server that receives them. Text of the
// program agentPreviewBrowserWorkerSource writes, not code run here.
const WORKER_COMMANDS_SOURCE = `async function exchangeApplicationIdentity(requestContext, targetUrl, grantValue = "") {
  const grant = String(grantValue || "").trim();
  if (!grant) {
    throw new Error("A preview identity grant is required.");
  }
  const response = await requestContext.post(
    new URL(identityControlPath, targetUrl).toString(),
    {
      data: { grant },
      failOnStatusCode: false
    }
  );
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok() || payload?.ok !== true) {
    const error = new Error(String(
      payload?.error || "Preview identity exchange failed (HTTP " + response.status() + ")."
    ));
    error.code = String(payload?.code || "vibe64_preview_identity_exchange_failed");
    error.signedOut = payload?.signedOut === true;
    throw error;
  }
  return payload;
}

async function selectApplicationIdentity(input = {}) {
  await ensureBrowser(input.previewUrl, {
    instance: input.previewInstance
  });
  const managedUrl = new URL(input.previewUrl);
  if (new URL(page.url()).origin !== managedUrl.origin) {
    await page.goto(managedUrl.href, { waitUntil: "load" });
  }
  let payload;
  try {
    payload = await exchangeApplicationIdentity(context.request, managedUrl.href, input.grant);
  } catch (error) {
    if (error?.signedOut === true) {
      applicationIdentity = {
        mode: "guest"
      };
      await page.reload({ waitUntil: "load" }).catch(() => null);
    }
    throw error;
  }
  const requestedIdentity = input.requestedIdentity && typeof input.requestedIdentity === "object"
    ? input.requestedIdentity
    : {};
  const mode = String(requestedIdentity.mode || "").trim();
  const identity = payload?.identity && typeof payload.identity === "object"
    ? payload.identity
    : {};
  const selector = identity.selector && typeof identity.selector === "object"
    ? identity.selector
    : requestedIdentity.selector && typeof requestedIdentity.selector === "object"
      ? requestedIdentity.selector
      : null;
  applicationIdentity = mode === "guest"
    ? { mode: "guest" }
    : {
        displayName: String(
          identity.displayName || identity.username || identity.login || requestedIdentity.displayName ||
          selector?.value || ""
        ).trim(),
        email: String(identity.email || (selector?.type === "email" ? selector.value : "")).trim().toLowerCase(),
        login: String(identity.login || (selector?.type === "login" ? selector.value : "")).trim(),
        mode,
        name: String(requestedIdentity.name || "").trim(),
        selector,
        userId: String(identity.userId || (selector?.type === "user-id" ? selector.value : "")).trim(),
        username: String(identity.username || "").trim()
      };
  await page.reload({ waitUntil: "load" });
  return {
    identity: applicationIdentity,
    url: safeUrl(page.url())
  };
}

async function writePlaywrightStorageState(input = {}) {
  const outputPath = outputPathFromInput(input);
  if (!outputPath || !path.isAbsolute(outputPath)) {
    throw new Error("Managed Playwright storage state requires an absolute output path.");
  }
  const storageContext = await request.newContext();
  try {
    // Establish the host's preview cookie without rendering the application.
    await storageContext.get(input.previewUrl);
    await exchangeApplicationIdentity(storageContext, input.previewUrl, input.grant);
    const storageState = await storageContext.storageState();
    try {
      await writeFile(outputPath, JSON.stringify(storageState) + "\\n", {
        flag: "wx",
        mode: 0o600
      });
    } catch (error) {
      if (error?.code === "EEXIST") {
        const immutablePathError = new Error(
          "Managed Playwright storage-state path already exists: " + outputPath
        );
        immutablePathError.code = "vibe64_managed_playwright_storage_state_exists";
        throw immutablePathError;
      }
      throw error;
    }
    return {
      outputPath
    };
  } finally {
    await storageContext.dispose();
  }
}

async function waitForScreenshotReady() {
  try {
    await page.waitForLoadState("load");
    await page.waitForFunction(documentReadyForScreenshot, undefined, {
      polling: "raf"
    });
  } catch (error) {
    if (error?.name !== "TimeoutError") {
      throw error;
    }
    const readinessError = new Error(
      "The managed preview page did not finish loading and render content."
    );
    readinessError.code = "vibe64_managed_browser_render_not_ready";
    throw readinessError;
  }
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
  // ensureBrowser established the proxy cookie. A redaction placeholder is not
  // a credential: putting it in a navigation URL overrides that valid cookie.
  const navigationUrl = new URL(input.previewUrl);
  navigationUrl.searchParams.delete("vibe64_preview_token");
  const result = await execute(
    browser,
    context,
    page,
    state,
    Object.freeze({ url: navigationUrl.href }),
    outputPathFromInput(input),
    consoleProxy
  );
  return {
    logs,
    result: jsonValue(result),
    url: safeUrl(page.url())
  };
}

function scheduleIdleExpiry() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(closeServerAndExit, idleTimeoutMs);
  idleTimer.unref?.();
}

// The page keeps running briefly after a command, so a short wait outside the
// browser before the next check still sees the page's own work.
function scheduleSuspend() {
  clearTimeout(suspendTimer);
  suspendTimer = setTimeout(() => {
    if (!closing) {
      signalBrowserProcessGroups("SIGSTOP");
    }
  }, suspendAfterMs);
  suspendTimer.unref?.();
}

// Status reads only this worker's own state: it neither runs the browser nor
// counts as use. Every other command runs the browser, and the suspend and
// idle periods start again when it ends.
async function runCommand(input = {}) {
  const command = String(input.command || "").trim();
  if (command === "status") {
    return statusPayload();
  }
  clearTimeout(idleTimer);
  clearTimeout(suspendTimer);
  signalBrowserProcessGroups("SIGCONT");
  try {
    return await runBrowserCommand(command, input);
  } finally {
    if (!closing) {
      scheduleSuspend();
      scheduleIdleExpiry();
    }
  }
}

async function runBrowserCommand(command, input = {}) {
  if (command === "ensure") {
    return ensureBrowser(input.previewUrl, {
      instance: input.previewInstance
    });
  }
  if (command === "reset") {
    for (const key of Object.keys(state)) {
      delete state[key];
    }
    return ensureBrowser(input.previewUrl, {
      instance: input.previewInstance,
      reset: true
    });
  }
  if (command === "reconnect") {
    return ensureBrowser(input.previewUrl, {
      instance: input.previewInstance,
      reset: true
    });
  }
  if (command === "identity") {
    return selectApplicationIdentity(input);
  }
  if (command === "storage-state") {
    return writePlaywrightStorageState(input);
  }
  if (command === "eval") {
    await ensureBrowser(input.previewUrl, {
      instance: input.previewInstance
    });
    return evaluateCode(input);
  }
  if (command === "screenshot") {
    await ensureBrowser(input.previewUrl, {
      instance: input.previewInstance
    });
    const outputPath = outputPathFromInput(input);
    if (!outputPath) {
      throw new Error("A screenshot output path is required.");
    }
    await waitForScreenshotReady();
    const [title, bodyText] = await Promise.all([
      page.title(),
      page.locator("body").innerText()
    ]);
    const screenshotResult = await page.screenshot({
      fullPage: true,
      type: "png"
    });
    const bytes = Buffer.isBuffer(screenshotResult)
      ? screenshotResult
      : Buffer.from(screenshotResult || []);
    const capture = {
      byteLength: bytes.length,
      capturedAt: new Date().toISOString(),
      ...domTextFacts(bodyText),
      ...pngVisualMetrics(bytes, inflateSync),
      outputPath,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      title: String(title || ""),
      url: safeUrl(page.url())
    };
    try {
      await writeFile(outputPath, bytes, { flag: "wx" });
    } catch (error) {
      if (error?.code === "EEXIST") {
        const immutablePathError = new Error(
          "Managed preview screenshot path already exists: " + outputPath
        );
        immutablePathError.code = "vibe64_managed_browser_screenshot_exists";
        throw immutablePathError;
      }
      throw error;
    }
    return capture;
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
  const body = JSON.stringify({
    generationId: controlGeneration,
    sessionId,
    token: controlToken
  });
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

await createWorkerMetadata();
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
scheduleIdleExpiry();

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

export { WORKER_COMMANDS_SOURCE };
