// Shown where no managed browser runtime exists, so the project's own
// Playwright is the way to run browser tests.
const LOCAL_PLAYWRIGHT_MESSAGE =
  "This computer has no managed browser runtime for vibe64-playwright. Run the project's own Playwright instead: " +
  "npx playwright test. If its browser is missing, report that and ask the person before running npx playwright install chromium.";
// Shown when a project's Playwright config reads or edits the login state the runner supplies; JSKIT's
// playwright-login-unchanged lint rule gives the same three sentences.
const LOGIN_STATE_OWNERSHIP_MESSAGE =
  "The login state belongs to the host. Pass process.env.PLAYWRIGHT_STORAGE_STATE unchanged to use.storageState. " +
  "If tests run signed out with it, that is a host defect: report it with the evidence; do not work around it.";

// The runner's check that a project's Playwright config passes the supplied login on unchanged, as script source for
// agentPlaywrightCommandSource (its escapes are the script's own).
const LOGIN_TAMPERING_SOURCE = `// A config's code without its comments and prose: string text stays only when it is one word, which can name a
// variable or a property (process.env["PLAYWRIGHT_STORAGE_STATE"], state["cookies"]).
function configCode(source = "") {
  let code = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1] || "";
    if (char === "/" && next === "/") {
      const end = source.indexOf("\\n", index);
      index = end < 0 ? source.length : end;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
    } else if (char === "\\"" || char === "'" || char === "\\u0060") {
      let end = index + 1;
      while (end < source.length && source[end] !== char) {
        end += source[end] === "\\\\" ? 2 : 1;
      }
      const text = source.slice(index + 1, end);
      code += /^[A-Za-z_$][\\w$]*$/u.test(text) ? " " + text + " " : " \\"\\" ";
      index = end + 1;
    } else {
      const length = char === "\\\\" ? 2 : 1;
      code += source.slice(index, index + length);
      index += length;
    }
  }
  return code;
}

// The text of one call's arguments, from just after its opening parenthesis.
function callArguments(code = "", start = 0) {
  let depth = 1;
  let end = start;
  while (end < code.length && depth > 0) {
    depth += code[end] === "(" ? 1 : code[end] === ")" ? -1 : 0;
    end += 1;
  }
  return code.slice(start, end - 1);
}

// The variables that carry the supplied login: the state file, and the list of a run's app servers with each one's
// state file (PLAYWRIGHT_WORKER_TARGETS, which JSKIT's browserTestConfig() reads).
const LOGIN_VARIABLES = ["PLAYWRIGHT_STORAGE_STATE", "PLAYWRIGHT_WORKER_TARGETS"];

// Why a config tampers with the supplied login, or "" when it does not. Ignoring comments, a config that names
// PLAYWRIGHT_STORAGE_STATE or PLAYWRIGHT_WORKER_TARGETS tampers when it mentions cookies or origins (the state's
// contents) or passes the variable, or a variable assigned from it, to a file read: readFileSync, readFile,
// createReadStream, open, openSync, copyFile, copyFileSync, require or import.
function loginTampering(source = "") {
  const code = configCode(source);
  const words = (text = "") => text.match(/[A-Za-z_$][\\w$]*/gu) || [];
  if (!words(code).some((word) => LOGIN_VARIABLES.includes(word))) {
    return "";
  }
  if (words(code).some((word) => word === "cookies" || word === "origins")) {
    return "it works on the state's cookies or origins";
  }
  const names = new Set(LOGIN_VARIABLES);
  for (const [, renamed] of code.matchAll(/(?<![\\w$.])(?:PLAYWRIGHT_STORAGE_STATE|PLAYWRIGHT_WORKER_TARGETS)\\s*:\\s*([A-Za-z_$][\\w$]*)/gu)) {
    names.add(renamed);
  }
  const mentionsLogin = (text = "") => words(text).some((word) => names.has(word));
  const declarations = [...code.matchAll(
    /\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=([^;]*?)(?=;|\\n\\s*(?:const|let|var|function|export|import|async|class|if|for|while|return)\\b|$)/gu
  )];
  let grew = true;
  while (grew) {
    grew = false;
    for (const [, name, value] of declarations) {
      if (!names.has(name) && mentionsLogin(value)) {
        names.add(name);
        grew = true;
      }
    }
  }
  for (const call of code.matchAll(/(?<![\\w$])(?:readFileSync|readFile|createReadStream|openSync|open|copyFileSync|copyFile|require|import)\\s*\\(/gu)) {
    if (mentionsLogin(callArguments(code, call.index + call[0].length))) {
      return "it reads the state file";
    }
  }
  return "";
}

// The login state belongs to the host, which already fits it to the tested site. A config that reads or edits it
// copies that host logic and hides a host defect behind its own patch, so the suite is refused before it starts.
// Every playwright*.config.* file at the application root is checked, since a script can select any of them.
function refuseConfigTamperingWithLogin(applicationRoot = "") {
  const configNames = readdirSync(applicationRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^playwright(?:\\.[\\w-]+)?\\.config\\.[cm]?[jt]s$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const configName of configNames) {
    const reason = loginTampering(readFileSync(path.join(applicationRoot, configName), "utf8"));
    if (reason) {
      fail(
        "Vibe64 refused to run these browser tests: " + configName +
        " reads or changes the signed-in browser state in PLAYWRIGHT_STORAGE_STATE or PLAYWRIGHT_WORKER_TARGETS (" + reason + "). " +
        LOGIN_STATE_OWNERSHIP_MESSAGE + " Project tests were not started."
      );
    }
  }
}
`;

// The wrapper's warnings about a Playwright config that never reads what the host supplies.
const CONFIG_WARNINGS_SOURCE = `// A run with several app servers needs a config that gives each Playwright worker its own: JSKIT's
// browserTestConfig() does, from PLAYWRIGHT_WORKER_TARGETS. Any other config sends every worker to the first server
// and its database, so they overwrite each other's data.
function warnWhenConfigIgnoresWorkers(applicationRoot = "", workerCount = 1) {
  const configName = ["playwright.config.mjs", "playwright.config.js", "playwright.config.ts", "playwright.config.cjs"]
    .find((name) => existsSync(path.join(applicationRoot, name)));
  if (!configName) {
    return;
  }
  const source = readFileSync(path.join(applicationRoot, configName), "utf8");
  const code = configCode(source);
  const jskitHarness = source.includes("@jskit-ai/jskit-catalog/browser-tests") &&
    /(?<![\\w$.])browserTestConfig\\s*\\(/u.test(code);
  if (!jskitHarness && !/(?<![\\w$])PLAYWRIGHT_WORKER_TARGETS(?![\\w$])/u.test(code)) {
    process.stderr.write(
      "Vibe64 serves " + workerCount + " app servers for this run in PLAYWRIGHT_WORKER_TARGETS, but " + configName +
      " never reads it, so every worker uses the first server and its database. Build the config with JSKIT's " +
      "browserTestConfig(), or run with --workers 1.\\n"
    );
  }
}

// JSKIT's browserTestConfig() gives each Playwright worker of a managed run its own server's environment (its copy of
// the test database) from @jskit-ai/jskit-catalog 0.2.113; an older one gives every worker the first server's, so their
// data would mix. The version that harness has, when it is older, else "".
function jskitHarnessWithoutWorkerDatabases(applicationRoot = "") {
  const configName = ["playwright.config.mjs", "playwright.config.js", "playwright.config.ts", "playwright.config.cjs"]
    .find((name) => existsSync(path.join(applicationRoot, name)));
  if (!configName) {
    return "";
  }
  const source = readFileSync(path.join(applicationRoot, configName), "utf8");
  if (!source.includes("@jskit-ai/jskit-catalog/browser-tests") ||
    !/(?<![\\w$.])browserTestConfig\\s*\\(/u.test(configCode(source))) {
    return "";
  }
  // Node's resolution from the application: its own node_modules, else a parent's.
  for (let directory = path.resolve(applicationRoot); ; directory = path.dirname(directory)) {
    const manifest = path.join(directory, "node_modules", "@jskit-ai", "jskit-catalog", "package.json");
    if (existsSync(manifest)) {
      const version = String(JSON.parse(readFileSync(manifest, "utf8")).version || "");
      const parts = version.split(".").map((part) => Number.parseInt(part, 10));
      const first = [0, 2, 113].findIndex((minimum, index) => parts[index] !== minimum);
      return first >= 0 && parts[first] < [0, 2, 113][first] ? version : "";
    }
    if (path.dirname(directory) === directory) {
      return "";
    }
  }
}

// A config that never reads the supplied login runs every test signed out, which looks like broken
// sign-in; saying which variable to read points at the one-line fix. A config reads it when its code, not a
// comment, names PLAYWRIGHT_STORAGE_STATE, or when JSKIT's browserTestConfig() builds it: that harness passes
// the supplied login to use.storageState itself.
function warnWhenConfigIgnoresLogin(applicationRoot = "") {
  const configName = ["playwright.config.mjs", "playwright.config.js", "playwright.config.ts", "playwright.config.cjs"]
    .find((name) => existsSync(path.join(applicationRoot, name)));
  if (!configName) {
    return;
  }
  const source = readFileSync(path.join(applicationRoot, configName), "utf8");
  const code = configCode(source);
  const namesLogin = /(?<![\\w$])PLAYWRIGHT_STORAGE_STATE(?![\\w$])/u.test(code);
  const jskitHarness = source.includes("@jskit-ai/jskit-catalog/browser-tests") &&
    /(?<![\\w$.])browserTestConfig\\s*\\(/u.test(code);
  if (!namesLogin && !jskitHarness) {
    process.stderr.write(
      "Vibe64 supplies the signed-in browser state in PLAYWRIGHT_STORAGE_STATE, but " + configName +
      " never reads it, so these tests run signed out. Pass process.env.PLAYWRIGHT_STORAGE_STATE to use.storageState there.\\n"
    );
  }
}
`;

function agentPlaywrightCommandSource({
  managedNodePath = "",
  managedPreviewPath = "",
  runtimeRoot = ""
} = {}) {
  return `#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const managedNodePath = ${JSON.stringify(String(managedNodePath || ""))};
const managedPreviewPath = ${JSON.stringify(String(managedPreviewPath || ""))};
const runtimeRoot = ${JSON.stringify(String(runtimeRoot || ""))};
// Without managed browser runtimes the project runs its own Playwright.
const LOCAL_PLAYWRIGHT_MESSAGE = ${JSON.stringify(LOCAL_PLAYWRIGHT_MESSAGE)};
const LOGIN_STATE_OWNERSHIP_MESSAGE = ${JSON.stringify(LOGIN_STATE_OWNERSHIP_MESSAGE)};

function fail(message, code = 1) {
  process.stderr.write(String(message || "Vibe64 managed Playwright test command failed.") + "\\n");
  process.exit(code);
}

function readJson(filePath = "") {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function findApplicationRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return "";
    }
    current = parent;
  }
}

function projectPlaywright(applicationRoot = "") {
  const candidates = [
    path.join(applicationRoot, "node_modules", "@playwright", "test", "package.json"),
    path.join(applicationRoot, "node_modules", "playwright", "package.json")
  ];
  for (const packagePath of candidates) {
    const packageRecord = readJson(packagePath);
    const version = String(packageRecord?.version || "").trim();
    if (!version) {
      continue;
    }
    const cliPath = path.join(applicationRoot, "node_modules", "playwright", "cli.js");
    const testCliPath = path.join(applicationRoot, "node_modules", "@playwright", "test", "cli.js");
    return {
      cliPath: existsSync(testCliPath) ? testCliPath : cliPath,
      packagePath,
      version
    };
  }
  return null;
}

function runtimeManifest(runtimePath = "") {
  const text = (() => {
    try {
      return readFileSync(path.join(runtimePath, "runtime.env"), "utf8");
    } catch {
      return "";
    }
  })();
  const values = Object.fromEntries(text.split(/\\r?\\n/u)
    .map((line) => line.split("="))
    .filter((entry) => entry.length >= 2)
    .map(([name, ...value]) => [name.trim(), value.join("=").trim()]));
  return {
    browsersPath: path.join(runtimePath, "browsers"),
    cliPath: path.join(runtimePath, "bin", "playwright"),
    runtimePath,
    version: String(values.playwright_version || "").trim()
  };
}

function managedRuntime(version = "") {
  const candidates = [
    path.join(runtimeRoot, "playwright-versions", version),
    path.join(runtimeRoot, "playwright")
  ];
  for (const candidate of candidates) {
    const manifest = runtimeManifest(candidate);
    if (
      manifest.version === version &&
      existsSync(manifest.browsersPath) &&
      existsSync(manifest.cliPath)
    ) {
      return manifest;
    }
  }
  return null;
}

// Every session shares the host's one current browser runtime, so a project
// pins its exact version instead of asking for another runtime.
function platformVersion() {
  if (!runtimeRoot) return "";
  const manifest = runtimeManifest(path.join(runtimeRoot, "playwright"));
  return existsSync(manifest.browsersPath) && existsSync(manifest.cliPath) ? manifest.version : "";
}

function unsupportedRecovery() {
  const version = platformVersion();
  const inspection = " Interactive inspection can use vibe64-helper preview browser eval.";
  return version
    ? "Every session shares this host's single browser runtime, Playwright " + version +
      ". Pin the project's @playwright/test dependency to exactly " + version +
      " (package.json and lockfile), run the project's declared Workspace setup, and check vibe64-helper playwright readiness again." +
      inspection
    : "This host has no current managed browser runtime; report that to the platform operator." + inspection;
}

function managedPreview(applicationRoot = "", {
  identityExplicit = false
} = {}) {
  const explicitBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || "").trim();
  if (explicitBaseUrl) {
    if (identityExplicit) {
      fail(
        "Explicit Playwright application identity requires the Vibe64-managed preview. " +
        "Remove PLAYWRIGHT_BASE_URL or omit --identity."
      );
    }
    return {
      baseUrl: explicitBaseUrl,
      identityTypes: [],
      identityRequired: false,
      managed: false
    };
  }
  if (!path.isAbsolute(managedPreviewPath) || !existsSync(managedPreviewPath)) {
    fail(
      "Vibe64 could not select the managed preview for Playwright tests. " +
      "The session's vibe64-helper preview command is unavailable. Project tests were not started."
    );
  }
  const result = spawnSync(managedNodePath, [
    managedPreviewPath,
    ...(process.env.VIBE64_PLAYWRIGHT_TARGET_RUN
      ? ["status", "--json"]
      : ["ensure", "--wait", "--json"])
  ], {
    cwd: applicationRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000
  });
  const diagnostics = [result.error?.message, result.stderr, result.stdout]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\\n");
  if (result.error || result.status !== 0) {
    fail(
      "Vibe64 could not prepare the managed preview for Playwright tests. " +
      "Project tests were not started." +
      (diagnostics ? "\\n" + diagnostics : "")
    );
  }
  let status;
  try {
    status = JSON.parse(String(result.stdout || "{}"));
  } catch {
    fail(
      "Vibe64 returned invalid managed-preview status for Playwright tests. " +
      "Project tests were not started."
    );
  }
  const endpoint = String(status?.diagnostics?.directApplicationEndpoint?.url || "").trim();
  try {
    const url = new URL(endpoint);
    if (status?.ready !== true || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("Managed preview is not ready.");
    }
    const identityTypes = Array.isArray(status.identityTypes)
      ? status.identityTypes
      : [];
    // A browser-test run's target with several app servers lists them, worker i's first being the one above.
    const testWorkers = (Array.isArray(status.diagnostics?.testWorkers) ? status.diagnostics.testWorkers : [])
      .map((worker) => new URL(String(worker?.url || "")))
      .map((workerUrl) => {
        if (!["http:", "https:"].includes(workerUrl.protocol)) throw new Error("A test worker is not an HTTP server.");
        return workerUrl.origin;
      });
    return {
      baseUrl: url.origin,
      identityTypes,
      identityRequired: identityTypes.length > 0,
      managed: true,
      workerUrls: testWorkers.length > 1 ? testWorkers : [url.origin]
    };
  } catch {
    fail(
      "Vibe64 did not provide a ready HTTP managed preview for Playwright tests. " +
      "Project tests were not started."
    );
  }
}

// The identity exchange runs through the Preview proxy, so the login state comes back stamped for
// the proxy's host, while the suite visits the direct application endpoint. A browser sends a
// cookie only to its own host, so the application's cookies and storage move to the tested origin;
// the proxy's own __Host- cookie means nothing there and stays behind. An HTTPS Preview's cookies
// are partitioned (made for the editor's cross-site Preview pane), keyed by the Preview's site,
// which the tested origin is not: they move as the tested origin's own cookies.
function moveStorageStateToBaseUrl(storageState = {}, baseUrl = "") {
  const target = new URL(baseUrl);
  const secure = target.protocol === "https:";
  return {
    ...storageState,
    cookies: (Array.isArray(storageState.cookies) ? storageState.cookies : [])
      .filter((cookie) => !String(cookie?.name || "").startsWith("__Host-"))
      .map(({ partitionKey: _partitionKey, _crHasCrossSiteAncestor: _crossSiteAncestor, ...cookie }) => ({
        ...cookie,
        domain: target.hostname,
        secure,
        // A cookie sent to every site must be secure, so over plain HTTP it stays with the tested site.
        ...(!secure && cookie.sameSite === "None" ? { sameSite: "Lax" } : {})
      })),
    origins: (Array.isArray(storageState.origins) ? storageState.origins : [])
      .map((entry) => ({ ...entry, origin: target.origin }))
  };
}

// One worker's signed-in state, in the run's own directory (the daemon's, which it removes when the run ends): the
// managed browser signs in on that worker's app server, whose database is its own, and the state moves to its origin.
function workerStorageState(applicationRoot = "", identity = "default", baseUrl = "", directory = "", worker = 0) {
  const storageStatePath = path.join(directory, "storage-state-" + worker + ".json");
  return new Promise((resolve) => {
    const child = spawn(managedNodePath, [
      managedPreviewPath,
      "browser",
      "storage-state",
      identity,
      "--output",
      storageStatePath,
      ...(worker > 0 ? ["--worker", String(worker)] : [])
    ], {
      cwd: applicationRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let diagnostics = "";
    const collect = (chunk) => {
      if (diagnostics.length < 16 * 1024 * 1024) diagnostics += chunk;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ diagnostics: error.message });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const storageState = code === 0 ? readJson(storageStatePath) : null;
      if (!storageState) {
        resolve({ diagnostics: diagnostics.trim() });
        return;
      }
      writeFileSync(storageStatePath, JSON.stringify(moveStorageStateToBaseUrl(storageState, baseUrl)) + "\\n", {
        mode: 0o600
      });
      resolve({ storageStatePath });
    });
  });
}

async function managedPlaywrightStorageStates(applicationRoot = "", identity = "default", workerUrls = []) {
  const directory = String(process.env.VIBE64_PLAYWRIGHT_STATE_DIR || "").trim();
  if (!path.isAbsolute(directory) || !existsSync(directory)) {
    fail(
      "Vibe64 did not give this browser test its own directory for the signed-in state. Project tests were not started."
    );
  }
  const states = await Promise.all(workerUrls.map((baseUrl, worker) =>
    workerStorageState(applicationRoot, identity, baseUrl, directory, worker)));
  const failed = states.find((state) => !state.storageStatePath);
  if (failed) {
    fail(
      "Vibe64 could not prepare the managed browser and application identity for Playwright. " +
      "Project tests were not started." +
      (failed.diagnostics ? "\\n" + failed.diagnostics : "")
    );
  }
  return states.map((state) => state.storageStatePath);
}

${CONFIG_WARNINGS_SOURCE}
${LOGIN_TAMPERING_SOURCE}
// A suite's environment. With several app servers, PLAYWRIGHT_WORKER_TARGETS lists each worker's server and signed-in
// state; worker 0's are also PLAYWRIGHT_BASE_URL and PLAYWRIGHT_STORAGE_STATE, as for a run with one.
function childEnv(runtime = {}, preview = {}, storageStatePaths = []) {
  const workerUrls = preview.workerUrls || [];
  return {
    ...process.env,
    PATH: [path.dirname(runtime.cliPath), process.env.PATH || ""].filter(Boolean).join(":"),
    PLAYWRIGHT_BASE_URL: preview.baseUrl || "",
    VIBE64_PLAYWRIGHT_OUTPUT_TARGET: "",
    VIBE64_PLAYWRIGHT_RESTORE_PREVIEW: "",
    VIBE64_PLAYWRIGHT_TARGET_IDENTITY: "",
    VIBE64_PLAYWRIGHT_WORKERS: "",
    PLAYWRIGHT_BROWSERS_PATH: runtime.browsersPath,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    VIBE64_MANAGED_PLAYWRIGHT_TEST: "1",
    PLAYWRIGHT_WORKER_TARGETS: workerUrls.length > 1
      ? JSON.stringify(workerUrls.map((baseURL, worker) => ({
        baseURL,
        ...(storageStatePaths[worker] ? { storageState: storageStatePaths[worker] } : {})
      })))
      : "",
    ...(preview.managed ? {
      PLAYWRIGHT_STORAGE_STATE: storageStatePaths[0] || ""
    } : {})
  };
}

function runManaged(runner = "", args = [], options = {}) {
  if (!path.isAbsolute(managedPreviewPath) || !existsSync(managedPreviewPath)) {
    fail(
      "Vibe64 could not start the isolated browser-test execution. " +
      "The session's vibe64-helper preview command is unavailable."
    );
  }
  const result = spawnSync(managedNodePath, [
    managedPreviewPath,
    "playwright-run",
    runner,
    ...args
  ], {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit"
  });
  if (result.error) {
    fail(result.error?.message || result.error);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(Number.isInteger(result.status) ? result.status : 1);
}

async function managedExecution(runtime = {}, applicationRoot = "", {
  identity = "default",
  identityExplicit = false,
  targetId = "",
  workers = 0
} = {}) {
  // The daemon must capture the prior Preview state before startup or login.
  // The inner scoped wrapper only reads the Preview already owned by that run.
  if (targetId || (!String(process.env.PLAYWRIGHT_BASE_URL || "").trim() && !process.env.VIBE64_PLAYWRIGHT_TARGET_RUN)) {
    return {
      env: {
        ...childEnv(runtime),
        VIBE64_PLAYWRIGHT_OUTPUT_TARGET: targetId,
        VIBE64_PLAYWRIGHT_RESTORE_PREVIEW: "1",
        PLAYWRIGHT_STORAGE_STATE: "",
        VIBE64_PLAYWRIGHT_TARGET_IDENTITY: identityExplicit ? identity : "",
        VIBE64_PLAYWRIGHT_WORKERS: workers ? String(workers) : ""
      }
    };
  }
  const preview = managedPreview(applicationRoot, {
    identityExplicit
  });
  if (preview.managed && identityExplicit && !preview.identityRequired) {
    fail(
      "This managed preview does not support application identity selection. " +
      "Project tests were not started."
    );
  }
  const olderJskit = preview.workerUrls?.length > 1 ? jskitHarnessWithoutWorkerDatabases(applicationRoot) : "";
  if (olderJskit) {
    fail(
      "Vibe64 refused to run this suite on " + preview.workerUrls.length + " app servers: this app's JSKIT " +
      "(@jskit-ai/jskit-catalog " + olderJskit + ") gives every Playwright worker the first server's test database, so " +
      "their data would mix; JSKIT 0.2.113 gives each worker its own. Run npm run jskit:update, or run with " +
      "--workers 1. Project tests were not started."
    );
  }
  const suppliesLogin = preview.managed && preview.identityRequired;
  if (suppliesLogin) {
    refuseConfigTamperingWithLogin(applicationRoot);
  }
  const storageStatePaths = suppliesLogin
    ? await managedPlaywrightStorageStates(applicationRoot, identity, preview.workerUrls)
    : [];
  if (suppliesLogin) {
    warnWhenConfigIgnoresLogin(applicationRoot);
  }
  if (preview.workerUrls?.length > 1) {
    process.stderr.write("Vibe64 runs this suite on " + preview.workerUrls.length + " app servers, one per Playwright worker, " +
      "each with its own copy of the test database.\\n");
    warnWhenConfigIgnoresWorkers(applicationRoot, preview.workerUrls.length);
  }
  return {
    env: childEnv(runtime, preview, storageStatePaths)
  };
}

function parseInvocation(values = []) {
  const args = [...values];
  let identity = "default";
  let identityExplicit = false;
  let targetId = "";
  let workers = 0;
  while (args.length > 0) {
    const option = String(args[0] || "");
    if (option === "--workers" || option.startsWith("--workers=")) {
      if (workers) fail("Specify --workers only once.", 64);
      args.shift();
      const value = option === "--workers" ? String(args.shift() || "") : option.slice("--workers=".length);
      if (!/^[1-9][0-9]?$/u.test(value)) fail("--workers requires a whole number of app servers from 1 to 99.", 64);
      workers = Number(value);
      continue;
    }
    if (option === "--target" || option.startsWith("--target=")) {
      if (targetId) fail("Specify --target only once.", 64);
      args.shift();
      targetId = option === "--target" ? String(args.shift() || "") : option.slice("--target=".length);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(targetId)) fail("--target requires an exact declared Preview target id.", 64);
      continue;
    }
    if (option !== "--identity" && !option.startsWith("--identity=")) {
      break;
    }
    if (identityExplicit) {
      fail("Specify --identity only once.", 64);
    }
    identityExplicit = true;
    args.shift();
    identity = option === "--identity"
      ? String(args.shift() || "").trim()
      : option.slice("--identity=".length).trim();
    if (!identity) {
      fail("--identity requires default, guest, or a configured managed app identity name.", 64);
    }
  }
  return {
    args,
    command: String(args.shift() || "").trim(),
    identity,
    identityExplicit,
    targetId,
    workers
  };
}

const invocation = parseInvocation(process.argv.slice(2));
const {
  args,
  command,
  identity,
  identityExplicit,
  targetId,
  workers
} = invocation;
if (!command && (identityExplicit || targetId || workers)) {
  fail("Specify test or npm-run after --target, --identity and --workers options.", 64);
}
if (workers && !targetId) {
  fail("--workers needs --target: only a test target with {workers} in its Run step serves several app servers.", 64);
}
// Vibe64 decides a target run's workers and gives each its own app server: Playwright's own count would share them.
if (targetId && args.some((arg) => /^(?:--workers|-j)(?:=|$)/u.test(String(arg)))) {
  fail("--target runs one Playwright worker per app server Vibe64 serves. Use vibe64-helper playwright --workers <n> " +
    "before --target, not Playwright's --workers or -j.", 64);
}
if (!command || command === "help" || command === "--help" || command === "-h") {
  process.stdout.write([
    "Usage:",
    "  vibe64-helper playwright [--target <target-id> [--workers <n>]] [--identity <default|guest|configured-name>] test [playwright test arguments]",
    "  vibe64-helper playwright [--target <target-id> [--workers <n>]] [--identity <default|guest|configured-name>] npm-run <package-script> [-- script arguments]",
    "  vibe64-helper playwright status",
    "  vibe64-helper playwright readiness",
    "  vibe64-helper playwright cancel <run-id>",
    "",
    "The project keeps ordinary portable Playwright tests. Vibe64 ensures the managed preview, supplies PLAYWRIGHT_BASE_URL, selects the matching managed browser runtime, and uses the project's default managed app identity. Use --identity to select another configured name or guest.",
    "The signed-in state arrives in PLAYWRIGHT_STORAGE_STATE. " + LOGIN_STATE_OWNERSHIP_MESSAGE + " A playwright config that reads that file or works on its cookies or origins is refused.",
    "Use --target for tests that write: each target is a test server the project's genesis/stack.md Outputs declare. Vibe64 starts it with the project's own Run command and its own disposable data, and PLAYWRIGHT_BASE_URL points the specs at it, so the project's own harness is what runs, not a bypass of it. A spec that needs data creates it in its fixtures. Tests that write never use the person's own development target (often app). Vibe64 waits for the target, tests with its identity, and restores the previous Preview when the turn ends or Preview is next ensured, restarted or stopped, so repeated runs in one turn skip the restore in between. The project owns disabling external side effects. List targets with vibe64-helper preview targets --json.",
    "A target whose Run step takes {workers} runs the suite in parallel: one app server per Playwright worker, each with its own copy of the test database, as many as the machine's test budget and free memory allow (--workers <n> asks for fewer or more, up to the budget). The run closes that target as it ends. vibe64-helper spec browser-tests explains it.",
    "Do not overlap a suite with live preview browser actions or Preview ensure/restart/target changes. Wait on the original command through cleanup, then confirm playwright status has no active run; preview ensure restores the previous Preview before it reports ready. Read-only status and logs are safe during a suite.",
    "For a background command, use its existing execution/session wait with about a 30-second window where supported: set yield_time_ms: 30000 for an empty command poll. Reserve shorter waits for interactive input or a specific immediate check. Do not repeatedly reread empty or unchanged logs between brief waits; inspect new output, changed state or a specific blocker."
  ].join("\\n") + "\\n");
  process.exit(0);
}
const applicationRoot = findApplicationRoot();
if (command === "readiness") {
  if (args.length || identityExplicit || targetId || workers) fail("Use readiness without test arguments.", 64);
  const manifest = applicationRoot ? readJson(path.join(applicationRoot, "package.json")) : null;
  const declaredVersion = String(manifest?.devDependencies?.["@playwright/test"] ||
    manifest?.dependencies?.["@playwright/test"] || manifest?.devDependencies?.playwright ||
    manifest?.dependencies?.playwright || "").trim();
  const project = applicationRoot ? projectPlaywright(applicationRoot) : null;
  const installed = Boolean(project && existsSync(project.cliPath));
  const runtime = installed ? managedRuntime(project.version) : null;
  process.stdout.write(JSON.stringify({
    status: !declaredVersion ? "not-configured" : !installed ? "dependencies-not-prepared" :
      !runtime ? "unsupported-runtime" : "ready",
    declaredVersion, installedVersion: project?.version || "",
    runtimeVersion: runtime?.version || "",
    platformVersion: platformVersion(),
    recovery: !declaredVersion ? "Declare portable project browser tests when needed." :
      !installed ? "Run the project's declared Workspace setup." : !runtime && !runtimeRoot ? LOCAL_PLAYWRIGHT_MESSAGE : !runtime ?
      unsupportedRecovery() : ""
  }) + "\\n");
  process.exit(0);
}
if (!applicationRoot) {
  fail("No package.json was found for this Playwright test command.");
}
if (command === "status" || command === "cancel") {
  if (identityExplicit || targetId || workers) {
    fail("--identity, --target and --workers apply only to test and npm-run commands.", 64);
  }
  if ((command === "status" && args.length) || (command === "cancel" && (args.length !== 1 || !args[0]))) {
    fail("Use status, or cancel <run-id> with the ID from status.", 64);
  }
  const result = spawnSync(managedNodePath, [managedPreviewPath, "playwright-" + command, ...args], {
    cwd: applicationRoot, env: process.env, stdio: "inherit"
  });
  process.exit(Number.isInteger(result.status) ? result.status : 1);
}
const project = projectPlaywright(applicationRoot);
if (!project || !existsSync(project.cliPath)) {
  fail("This project does not have a declared and installed @playwright/test dependency.");
}
const runtime = managedRuntime(project.version);
if (!runtime && !runtimeRoot) {
  fail(LOCAL_PLAYWRIGHT_MESSAGE);
}
if (!runtime) {
  fail(
    "The project requires Playwright " + project.version +
    ", but Vibe64 does not provide its matching managed browser runtime. Browser tests were not started. " +
    unsupportedRecovery() + " Do not install a browser in this session."
  );
}
if (targetId && (String(process.env.PLAYWRIGHT_BASE_URL || "").trim() || String(process.env.PLAYWRIGHT_STORAGE_STATE || "").trim())) {
  fail("--target uses its own managed Preview URL and identity. Remove PLAYWRIGHT_BASE_URL and PLAYWRIGHT_STORAGE_STATE.", 64);
}let runner;
let runnerArgs;
if (command === "test") {
  runner = "node";
  runnerArgs = [project.cliPath, "test", ...args];
} else if (command === "npm-run") {
  const script = String(args.shift() || "").trim();
  if (!script) {
    fail("A package script name is required.", 64);
  }
  runner = "npm";
  runnerArgs = ["run", script, ...args];
} else {
  fail("Unsupported managed Playwright command: " + command + ". Browser installation is never permitted.", 64);
}
const execution = await managedExecution(runtime, applicationRoot, { identity, identityExplicit, targetId, workers });
runManaged(runner, runnerArgs, {
  cwd: applicationRoot,
  env: execution.env
});
`;
}

export {
  LOCAL_PLAYWRIGHT_MESSAGE,
  agentPlaywrightCommandSource
};
