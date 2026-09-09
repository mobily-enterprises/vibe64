function agentPlaywrightCommandSource({
  managedNodePath = "",
  managedPreviewPath = "",
  runtimeRoot = ""
} = {}) {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const managedNodePath = ${JSON.stringify(String(managedNodePath || ""))};
const managedPreviewPath = ${JSON.stringify(String(managedPreviewPath || ""))};
const runtimeRoot = ${JSON.stringify(String(runtimeRoot || ""))};

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
      "The session's vibe64-preview command is unavailable. Project tests were not started."
    );
  }
  const result = spawnSync(managedNodePath, [
    managedPreviewPath,
    "ensure",
    "--wait",
    "--json"
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
  const endpoint = String(status?.endpoints?.agent?.url || "").trim();
  try {
    const url = new URL(endpoint);
    if (status?.ready !== true || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("Managed preview is not ready.");
    }
    const identityTypes = Array.isArray(status.identityTypes)
      ? status.identityTypes
      : [];
    return {
      baseUrl: url.origin,
      identityTypes,
      identityRequired: identityTypes.length > 0,
      managed: true
    };
  } catch {
    fail(
      "Vibe64 did not provide a ready HTTP managed preview for Playwright tests. " +
      "Project tests were not started."
    );
  }
}

function managedPlaywrightStorageState(applicationRoot = "", identity = "default") {
  const directory = mkdtempSync(path.join(
    path.resolve(process.env.TMPDIR || "/tmp"),
    "vibe64-playwright-auth-"
  ));
  const storageStatePath = path.join(directory, "storage-state.json");
  const result = spawnSync(managedNodePath, [
    managedPreviewPath,
    "browser",
    "storage-state",
    identity,
    "--output",
    storageStatePath
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
  if (result.error || result.status !== 0 || !existsSync(storageStatePath)) {
    rmSync(directory, {
      force: true,
      recursive: true
    });
    fail(
      "Vibe64 could not prepare the managed browser and application identity for Playwright. " +
      "Project tests were not started." +
      (diagnostics ? "\\n" + diagnostics : "")
    );
  }
  return {
    directory,
    storageStatePath
  };
}

function childEnv(runtime = {}, preview = {}, authentication = null) {
  return {
    ...process.env,
    PATH: [path.dirname(runtime.cliPath), process.env.PATH || ""].filter(Boolean).join(":"),
    PLAYWRIGHT_BASE_URL: preview.baseUrl || "",
    VIBE64_PLAYWRIGHT_OUTPUT_TARGET: "",
    VIBE64_PLAYWRIGHT_TARGET_IDENTITY: "",
    PLAYWRIGHT_BROWSERS_PATH: runtime.browsersPath,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    VIBE64_MANAGED_PLAYWRIGHT_TEST: "1",
    ...(preview.managed ? {
      VIBE64_PLAYWRIGHT_STORAGE_STATE: authentication?.storageStatePath || ""
    } : {})
  };
}

function runManaged(runner = "", args = [], options = {}) {
  const cleanup = () => {
    if (options.cleanupRoot) {
      rmSync(options.cleanupRoot, {
        force: true,
        recursive: true
      });
    }
  };
  if (!path.isAbsolute(managedPreviewPath) || !existsSync(managedPreviewPath)) {
    cleanup();
    fail(
      "Vibe64 could not start the isolated browser-test execution. " +
      "The session's vibe64-preview command is unavailable."
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
  cleanup();
  if (result.error) {
    fail(result.error?.message || result.error);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(Number.isInteger(result.status) ? result.status : 1);
}

function managedExecution(runtime = {}, applicationRoot = "", {
  identity = "default",
  identityExplicit = false,
  targetId = ""
} = {}) {
  if (targetId) {
    return {
      env: {
        ...childEnv(runtime),
        VIBE64_PLAYWRIGHT_OUTPUT_TARGET: targetId,
        VIBE64_PLAYWRIGHT_TARGET_IDENTITY: identityExplicit ? identity : ""
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
  const authentication = preview.managed && preview.identityRequired
    ? managedPlaywrightStorageState(applicationRoot, identity)
    : null;
  return {
    cleanupRoot: authentication?.directory || "",
    env: childEnv(runtime, preview, authentication)
  };
}

function parseInvocation(values = []) {
  const args = [...values];
  let identity = "default";
  let identityExplicit = false;
  let targetId = "";
  while (args.length > 0) {
    const option = String(args[0] || "");
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
    targetId
  };
}

const applicationRoot = findApplicationRoot();
if (!applicationRoot) {
  fail("No package.json was found for this Playwright test command.");
}
const project = projectPlaywright(applicationRoot);
if (!project || !existsSync(project.cliPath)) {
  fail("This project does not have a declared and installed @playwright/test dependency.");
}
const runtime = managedRuntime(project.version);
if (!runtime) {
  fail(
    "The project requires Playwright " + project.version +
    ", but Vibe64 does not provide its matching managed browser runtime. " +
    "Do not install a browser in this session."
  );
}

const invocation = parseInvocation(process.argv.slice(2));
const {
  args,
  command,
  identity,
  identityExplicit,
  targetId
} = invocation;
if (!command && (identityExplicit || targetId)) {
  fail("Specify test or npm-run after --target and --identity options.", 64);
}
if (!command || command === "help" || command === "--help" || command === "-h") {
  process.stdout.write([
    "Usage:",
    "  vibe64-playwright [--target <target-id>] [--identity <default|guest|configured-name>] test [playwright test arguments]",
    "  vibe64-playwright [--target <target-id>] [--identity <default|guest|configured-name>] npm-run <package-script> [-- script arguments]",
    "  vibe64-playwright status",
    "",
    "The project keeps ordinary portable Playwright tests. Vibe64 ensures the managed preview, supplies PLAYWRIGHT_BASE_URL, selects the matching managed browser runtime, and uses the project's default managed app identity. Use --identity to select another configured name or guest.",
    "Use --target for a declared web target: Vibe64 waits for it, tests with its identity, and restores the previous Preview after the command ends. The project owns test database isolation, fixtures, and disabling external side effects. List targets with vibe64-preview targets --json."
  ].join("\\n") + "\\n");
  process.exit(0);
}
if (command === "status") {
  if (identityExplicit || targetId) {
    fail("--identity and --target apply only to test and npm-run commands.", 64);
  }
  process.stdout.write(JSON.stringify({
    browsersPath: runtime.browsersPath,
    managed: true,
    applicationRoot,
    version: project.version
  }, null, 2) + "\\n");
  process.exit(0);
}
if (targetId && (String(process.env.PLAYWRIGHT_BASE_URL || "").trim() || String(process.env.VIBE64_PLAYWRIGHT_STORAGE_STATE || "").trim())) {
  fail("--target uses its own managed Preview URL and identity. Remove PLAYWRIGHT_BASE_URL and VIBE64_PLAYWRIGHT_STORAGE_STATE.", 64);
}
let runner;
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
const execution = managedExecution(runtime, applicationRoot, { identity, identityExplicit, targetId });
runManaged(runner, runnerArgs, {
  cleanupRoot: execution.cleanupRoot,
  cwd: applicationRoot,
  env: execution.env
});
`;
}

export {
  agentPlaywrightCommandSource
};
