import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Vibe64 runs on a person's own computer. A host that provisions its own
// machines passes its values at startup; no public file names its folders.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOST_PROFILE_FILE = "packages/vibe64-execution/src/server/hostProfile.js";
// A named folder inside a system location.
const SYSTEM_LOCATION = /(?<![\w.~$/-])\/(?:var\/lib|var\/cache|opt|etc|usr\/lib|run)\/[\w.-]+/gu;
// Locations other software owns, which local code and its tests may name.
const OTHER_SOFTWARE_LOCATIONS = new Set([
  "/etc/passwd", "/etc/nsswitch.conf", "/etc/codex", "/opt/homebrew", "/run/user", "/run/app",
  // Database and Ruby packages' own install and data folders.
  "/usr/lib/postgresql", "/var/lib/postgres", "/var/lib/pgsql", "/var/lib/mysql", "/opt/mariadb", "/var/lib/gems"
]);
// Known blocker: the privileged helper, its two test files and its release
// packaging still describe the host they run on. They leave this repository
// together in the helper extraction; until then they are the only exceptions.
const ALLOWED_FILES = new Set([
  "packages/vibe64-execution/src/host/execHelper.js",
  "tests/server/executionBoundarySecurity.unit.test.js",
  "tests/server/vibe64ManagedWorkflow.unit.test.js",
  "tooling/release/runtime-package.mjs"
]);

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    // Genesis cities are generated from the sources scanned here.
    .filter((file) => file && !file.startsWith(".genesis/") && file !== "package-lock.json")
    .filter((file) => existsSync(path.join(REPO_ROOT, file)) && lstatSync(path.join(REPO_ROOT, file)).isFile());
}

function readText(file) {
  const content = readFileSync(path.join(REPO_ROOT, file));
  return content.includes(0) ? "" : content.toString("utf8");
}

test("public sources name no folders of their own in system locations", () => {
  const findings = [];
  for (const file of trackedFiles()) {
    if (ALLOWED_FILES.has(file)) continue;
    readText(file).split("\n").forEach((line, index) => {
      for (const [location] of line.matchAll(SYSTEM_LOCATION)) {
        if (!OTHER_SOFTWARE_LOCATIONS.has(location)) findings.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
      }
    });
  }
  assert.deepEqual(findings, []);
});

test("the allowed exceptions still exist", () => {
  for (const file of ALLOWED_FILES) assert.ok(existsSync(path.join(REPO_ROOT, file)), file);
});

// Static import graph that follows the named bindings a module takes from a
// package entry, approximating the code it can call rather than every module
// the package entry happens to load.
const packageEntries = new Map();
for (const file of trackedFiles().filter((entry) => /^packages\/[^/]+\/package\.json$/u.test(entry))) {
  const manifest = JSON.parse(readText(file));
  if (manifest.name?.startsWith("@local/")) packageEntries.set(manifest.name, { root: path.dirname(file), exports: manifest.exports || {} });
}

function exportTarget(target) {
  if (typeof target === "string") return target;
  return target?.import || target?.default || target?.node || "";
}

function resolveSpecifier(fromFile, specifier) {
  if (specifier.startsWith(".")) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
    return existsSync(path.join(REPO_ROOT, resolved)) ? resolved : "";
  }
  const match = /^(@local\/[^/]+)(\/.*)?$/u.exec(specifier);
  const entry = match && packageEntries.get(match[1]);
  const target = entry && exportTarget(entry.exports[`.${match[2] || ""}`]);
  return target ? path.posix.normalize(path.posix.join(entry.root, target)) : "";
}

const IMPORT_PATTERN = /(?:^|[;\s])(import|export)\s*(type\s+)?([\w$*{}\s,]*?)\s*from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gmu;

function bindingNames(clause, kind) {
  const braces = /\{([^}]*)\}/u.exec(clause);
  if (!braces) return clause.includes("*") || kind === "export" ? "*" : ["default"];
  const bindings = braces[1].split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [imported, exported] = part.split(/\s+as\s+/u);
    return { imported, exported: exported || imported };
  });
  return kind === "export" ? bindings : bindings.map((binding) => binding.imported);
}

function moduleReferences(file) {
  const references = [];
  for (const match of readText(file).matchAll(IMPORT_PATTERN)) {
    const target = resolveSpecifier(file, match[4] || match[5] || match[6]);
    const names = match[4] ? bindingNames(match[3], match[1]) : "*";
    references.push({ kind: match[4] ? match[1] : "import", names, target });
  }
  return references;
}

function declaredExports(file) {
  const names = new Set();
  for (const match of readText(file).matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([\w$]+)/gu)) names.add(match[1]);
  for (const match of readText(file).matchAll(/export\s*\{([^}]*)\}(?!\s*from)/gu)) {
    for (const part of match[1].split(",")) names.add(part.trim().split(/\s+as\s+/u).pop());
  }
  return names;
}

// A module requested for some names reaches everything it imports, and only
// the re-exports that provide those names.
function reachableModules(entry) {
  const files = new Set();
  const seen = new Set();
  const queue = [[entry, "*"]];
  while (queue.length) {
    const [file, names] = queue.shift();
    const key = `${file}|${names === "*" ? "*" : [...names].sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    files.add(file);
    const local = names === "*" ? null : declaredExports(file);
    for (const reference of moduleReferences(file)) {
      if (!reference.target) continue;
      if (reference.kind === "import") {
        queue.push([reference.target, reference.names]);
      } else if (reference.names === "*") {
        const wanted = names === "*" ? "*" : names.filter((name) => !local.has(name));
        if (wanted.length) queue.push([reference.target, wanted]);
      } else {
        const wanted = reference.names
          .filter((binding) => names === "*" || names.includes(binding.exported))
          .map((binding) => binding.imported);
        if (wanted.length) queue.push([reference.target, wanted]);
      }
    }
  }
  return files;
}

// True when the offset sits inside a template literal or a one-line string,
// such as a generated wrapper script or a `node -e` program.
function insideLiteral(text, offset) {
  const before = text.slice(0, offset);
  const backticks = before.match(/(?<!\\)`/gu)?.length || 0;
  if (backticks % 2) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return ["\"", "'"].some((quote) => (line.split(quote).length - 1) % 2 === 1);
}

function readsOwnArguments(text) {
  return [...text.matchAll(/process\.argv\[1\]|process\.argv\.slice\(2\)/gu)]
    .some((match) => !insideLiteral(text, match.index));
}

function childEntryPoints() {
  const sources = trackedFiles().filter((file) => file.startsWith("packages/"));
  const entries = new Set(sources.filter((file) => /^packages\/[^/]+\/bin\//u.test(file)));
  for (const file of sources.filter((entry) => /\.m?js$/u.test(entry))) {
    const text = readText(file);
    if (readsOwnArguments(text)) entries.add(file);
    for (const match of text.matchAll(/new URL\(\s*["'](\.\.?\/[^"']+\.m?js)["']\s*,\s*import\.meta\.url\s*\)/gu)) {
      const target = resolveSpecifier(file, match[1]);
      if (target) entries.add(target);
    }
  }
  return [...entries].sort();
}

test("processes started from a file never read the in-process host profile", () => {
  // A child process starts without the profile its parent was configured
  // with, so it would silently fall back to a person's own computer.
  assert.ok(existsSync(path.join(REPO_ROOT, HOST_PROFILE_FILE)), HOST_PROFILE_FILE);
  const entries = childEntryPoints();
  assert.ok(entries.includes("packages/vibe64-execution/src/server/engines/stdioBridge.js"));
  assert.ok(entries.includes("packages/vibe64-runtime/src/server/codexAppServerProcess.js"));
  assert.ok(entries.includes("packages/vibe64-terminals/src/server/sessionWorkOperationCommand.js"));
  assert.ok(!entries.includes("packages/studio-terminal-core/src/server/launchTargetTerminal.js"));
  // An entry that reads the profile must receive it from its parent first.
  const offenders = entries
    .filter((entry) => reachableModules(entry).has(HOST_PROFILE_FILE))
    .filter((entry) => !/configureVibe64Host\(/u.test(readText(entry)))
    .filter((entry) => !ALLOWED_FILES.has(entry));
  assert.deepEqual(offenders, []);
});

