function agentPlaywrightCommandSource({
  managedNodePath = "",
  managedNpmPath = "",
  runtimeRoot = ""
} = {}) {
  return `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const managedNodePath = ${JSON.stringify(String(managedNodePath || ""))};
const managedNpmPath = ${JSON.stringify(String(managedNpmPath || ""))};
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

function findProjectRoot(start = process.cwd()) {
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

function projectPlaywright(projectRoot = "") {
  const candidates = [
    path.join(projectRoot, "node_modules", "@playwright", "test", "package.json"),
    path.join(projectRoot, "node_modules", "playwright", "package.json")
  ];
  for (const packagePath of candidates) {
    const packageRecord = readJson(packagePath);
    const version = String(packageRecord?.version || "").trim();
    if (!version) {
      continue;
    }
    const cliPath = path.join(projectRoot, "node_modules", "playwright", "cli.js");
    const testCliPath = path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js");
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

function childEnv(runtime = {}) {
  return {
    ...process.env,
    PATH: [path.dirname(runtime.cliPath), process.env.PATH || ""].filter(Boolean).join(":"),
    PLAYWRIGHT_BROWSERS_PATH: runtime.browsersPath,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    VIBE64_MANAGED_PLAYWRIGHT_TEST: "1"
  };
}

function run(command = "", args = [], options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit"
  });
  child.once("error", (error) => fail(error?.message || error));
  child.once("close", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(Number.isInteger(code) ? code : 1);
  });
}

const projectRoot = findProjectRoot();
if (!projectRoot) {
  fail("No package.json was found for this Playwright test command.");
}
const project = projectPlaywright(projectRoot);
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

const args = process.argv.slice(2);
const command = String(args.shift() || "").trim();
if (!command || command === "help" || command === "--help" || command === "-h") {
  process.stdout.write([
    "Usage:",
    "  vibe64-playwright test [playwright test arguments]",
    "  vibe64-playwright npm-run <package-script> [-- script arguments]",
    "  vibe64-playwright status",
    "",
    "The project keeps ordinary portable Playwright tests. Vibe64 supplies only the matching managed browser runtime."
  ].join("\\n") + "\\n");
  process.exit(0);
}
if (command === "status") {
  process.stdout.write(JSON.stringify({
    browsersPath: runtime.browsersPath,
    managed: true,
    projectRoot,
    version: project.version
  }, null, 2) + "\\n");
  process.exit(0);
}
if (command === "test") {
  run(managedNodePath, [project.cliPath, "test", ...args], {
    cwd: projectRoot,
    env: childEnv(runtime)
  });
} else if (command === "npm-run") {
  const script = String(args.shift() || "").trim();
  if (!script) {
    fail("A package script name is required.", 64);
  }
  run(managedNpmPath, ["run", script, ...args], {
    cwd: projectRoot,
    env: childEnv(runtime)
  });
} else {
  fail("Unsupported managed Playwright command: " + command + ". Browser installation is never permitted.", 64);
}
`;
}

export {
  agentPlaywrightCommandSource
};
