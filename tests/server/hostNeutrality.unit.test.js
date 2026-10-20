import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Vibe64 runs on a person's own computer. A host that provisions its own
// machines passes its values at startup; nothing here may name such a host.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOST_PROFILE_FILE = "packages/vibe64-execution/src/server/hostProfile.js";
const HOST_TERMS = [
  /\/var\/lib\/vibe64/u,
  /\/opt\/vibe64/u,
  /\/var\/cache\/vibe64/u,
  /\/etc\/vibe64/u,
  /\/run\/vibe64/u,
  /\/usr\/lib\/vibe64/u,
  /v64d_/u,
  /Vibe64 Online/u,
  /vibe64-online/u,
  /\bOnline\b/u,
  /\bVPS\b/u,
  /\b[Tt]enants?\b/u,
  /\b[Ff]leet\b/u
];
// The privileged helper and its release packaging still describe the host
// they run on; both leave this repository in a later extraction. The test
// path guard names the directories it refuses.
const ALLOWED_FILES = new Set([
  "packages/vibe64-execution/src/host/execHelper.js",
  "tooling/release/runtime-package.mjs",
  "tooling/test-host-path-guard.mjs"
]);
// Integration guides keep their provider's own "tenant" vocabulary
// (Microsoft directory IDs, Workday and Xero tenants, multi-tenant apps).
const PROVIDER_VOCABULARY = {
  term: /\b[Tt]enants?\b/u,
  files: /^(?:genesis\/program\/source\/edit-and-review\.md|packages\/vibe64-source-editor\/docs\/)/u
};

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    // Genesis cities are generated from the sources scanned here.
    .filter((file) => file && !file.startsWith("tests/") && !file.startsWith(".genesis/") && file !== "package-lock.json")
    .filter((file) => existsSync(path.join(REPO_ROOT, file)) && lstatSync(path.join(REPO_ROOT, file)).isFile());
}

function readText(file) {
  const content = readFileSync(path.join(REPO_ROOT, file));
  return content.includes(0) ? "" : content.toString("utf8");
}

test("public sources never name a hosting environment", () => {
  const findings = [];
  for (const file of trackedFiles()) {
    if (ALLOWED_FILES.has(file)) continue;
    readText(file).split("\n").forEach((line, index) => {
      for (const term of HOST_TERMS) {
        if (!term.test(line)) continue;
        if (term.source === PROVIDER_VOCABULARY.term.source && PROVIDER_VOCABULARY.files.test(file)) continue;
        findings.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
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

function childEntryPoints() {
  const sources = trackedFiles().filter((file) => file.startsWith("packages/"));
  const entries = new Set(sources.filter((file) => /^packages\/[^/]+\/bin\//u.test(file)));
  for (const file of sources.filter((entry) => /\.m?js$/u.test(entry))) {
    const text = readText(file);
    if (/process\.argv\[1\]|process\.argv\.slice\(2\)/u.test(text)) entries.add(file);
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
  const offenders = entries
    .filter((entry) => reachableModules(entry).has(HOST_PROFILE_FILE))
    .filter((entry) => !ALLOWED_FILES.has(entry));
  assert.deepEqual(offenders, []);
});

