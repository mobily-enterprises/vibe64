import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, readdir, readFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "../..");

const EXPECTED_MANAGED_SCRIPTS = Object.freeze({
  devlinks: "jskit app link-local-packages",
  verify: "jskit app verify && npm run --if-present verify:app",
  release: "jskit app release",
  "jskit:update": "jskit app update-packages"
});

const REQUIRED_TOP_LEVEL_ENTRIES = Object.freeze([
  "AGENTS.md",
  "app.json",
  "Procfile",
  "bin",
  "config",
  "eslint.config.mjs",
  "favicon.svg",
  "index.html",
  "jsconfig.json",
  "package.json",
  "packages",
  "scripts",
  "server",
  "server.js",
  "src",
  "tests",
  "vite.config.mjs",
  "vite.shared.mjs"
]);

async function readPackageJson() {
  const packageJsonPath = path.join(APP_ROOT, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw);
}

async function readTopLevelEntries() {
  const entries = await readdir(APP_ROOT, { withFileTypes: true });
  const ignored = new Set([
    "node_modules",
    "dist",
    "coverage",
    "test-results",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock"
  ]);
  return entries
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .filter((name) => !ignored.has(name));
}

async function listFilesRecursive(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(absolutePath)));
      continue;
    }
    files.push(absolutePath);
  }
  return files;
}

test("latest JSKIT app keeps managed wrapper scripts and JSKIT dependency specifiers", async () => {
  const packageJson = await readPackageJson();
  const runtimeDependencies = Object.entries(packageJson.dependencies || {}).filter(([name]) =>
    name.startsWith("@jskit-ai/")
  );
  const devDependencies = Object.entries(packageJson.devDependencies || {}).filter(([name]) =>
    name.startsWith("@jskit-ai/")
  );

  assert.ok(runtimeDependencies.length > 0, "Expected JSKIT runtime dependencies to be present.");
  assert.ok(devDependencies.length > 0, "Expected JSKIT dev dependencies to be present.");

  for (const [name, value] of [...runtimeDependencies, ...devDependencies]) {
    assert.match(value, /^(0\.x|\d+\.\d+\.\d+)$/, `Expected ${name} to use a managed JSKIT version specifier.`);
  }

  for (const [scriptName, expectedValue] of Object.entries(EXPECTED_MANAGED_SCRIPTS)) {
    assert.equal(packageJson.scripts?.[scriptName], expectedValue, `Unexpected ${scriptName} script.`);
  }
});

test("latest JSKIT scaffold files are present at the app root", async () => {
  const entries = await readTopLevelEntries();
  for (const requiredEntry of REQUIRED_TOP_LEVEL_ENTRIES) {
    assert.equal(entries.includes(requiredEntry), true, `Missing top-level scaffold entry: ${requiredEntry}`);
  }
});

test("starter shell keeps the default hosted CI workflow simple", async () => {
  const workflowSource = await readFile(path.join(APP_ROOT, ".github", "workflows", "verify.yml"), "utf8");

  assert.match(workflowSource, /run: npm run verify/);
  assert.doesNotMatch(workflowSource, /jskit app verify --against/);
  assert.doesNotMatch(workflowSource, /jskit app verify-ui/);
});

test("starter shell does not include the app.manifest scaffold", async () => {
  await assert.rejects(access(path.join(APP_ROOT, "framework/app.manifest.mjs")), /ENOENT/);
});

test("local package source avoids brittle deep relative imports", async () => {
  const packageSourceFiles = await listFilesRecursive(path.join(APP_ROOT, "packages"));
  const brittleImportPattern = /\bfrom\s+["'](?:\.\.\/){5,}[^"']+["']/;

  for (const filePath of packageSourceFiles) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".mjs")) {
      continue;
    }
    const source = await readFile(filePath, "utf8");
    assert.equal(
      brittleImportPattern.test(source),
      false,
      `Found brittle deep relative import in ${path.relative(APP_ROOT, filePath)}`
    );
  }
});
