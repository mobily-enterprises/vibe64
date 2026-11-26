import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const PACKAGES_ROOT = "packages";

// What starts a process itself (child_process, node-pty, execa) is listed once, with its counts and reasons, in
// commandSpawnerOwnership.unit.test.js. Here: the calls that run a command around the command gateway, which applies
// the permission policy and the server's stop gate. The command starters (spawnCommand, execFileCommand and
// runCaptureCommand) are the gateway's own engine, reachable from the package's root only as runCaptureCommand, and
// spawnCommand and execFileCommand only through @local/vibe64-execution/server/commandSpawner.
const DIRECT_EXECUTION_PATTERNS = Object.freeze([
  {
    id: "command starter import",
    pattern: /import\s*\{[^}]*\b(?:spawnCommand|execFileCommand|runCaptureCommand)\b[^}]*\}\s*from\s*["']@local\/vibe64-execution\/[^"']*["']|import\s*(?:\*\s*as\s+\w+\s+from\s*|\(\s*)["']@local\/vibe64-execution\/server\/(?:commandSpawner|capture)["']/gu
  },
  {
    id: "startTerminalSession call",
    pattern: /\bstartTerminalSession\s*\(/gu
  },
  {
    id: "runHostCommand call",
    pattern: /\brunHostCommand\s*\(/gu
  }
]);

const PUBLISHING_TOOLS = "Publishing runs Vibe64's own fixed git/tool commands without a shell; project code runs through the command gateway.";
const TOOL_HOME = "Packaging and publishing tools run with a private staging HOME so they never read or write the person's own configuration.";

const DIRECT_EXECUTION_ALLOWLIST = new Map([
  ["packages/vibe64-publishing/src/server/credentialBroker.js", { "command starter import": { count: 1, reason: PUBLISHING_TOOLS } }],
  ["packages/vibe64-packaging/src/server/stages.js", {
    "command starter import": { count: 1, reason: "Packaging stages run Vibe64's pinned signing, upload and toolchain tools with an exact environment; the project's own build goes through the gateway." }
  }],
  ["packages/vibe64-terminals/src/server/sessionWorkOperationCommand.js", {
    "command starter import": { count: 1, reason: "The session work child is its own process, started through the gateway in the session's execution scope; it runs its stage's fixed Git commands itself, each in its own process group." }
  }]
]);

const ENV_POLICY_PATTERNS = Object.freeze([
  {
    id: "HOME object key",
    pattern: /\bHOME\s*:/gu
  },
  {
    id: "XDG_CACHE_HOME object key",
    pattern: /\bXDG_CACHE_HOME\s*:/gu
  },
  {
    id: "XDG_CONFIG_HOME object key",
    pattern: /\bXDG_CONFIG_HOME\s*:/gu
  },
  {
    id: "XDG_DATA_HOME object key",
    pattern: /\bXDG_DATA_HOME\s*:/gu
  },
  {
    id: "export HOME",
    pattern: /export\s+HOME=/gu
  },
  {
    id: "export PATH",
    pattern: /export\s+PATH=/gu
  }
]);

const ENV_POLICY_ALLOWLIST = new Map([
  ["packages/vibe64-packaging/src/server/destinations/androidSideload/index.js", { "HOME object key": { count: 1, reason: TOOL_HOME } }],
  ["packages/vibe64-packaging/src/server/destinations/androidSideload/key.js", { "HOME object key": { count: 1, reason: TOOL_HOME } }],
  ["packages/vibe64-packaging/src/server/toolchains/androidSdk.js", { "HOME object key": { count: 1, reason: TOOL_HOME } }],
  ["packages/vibe64-packaging/src/server/toolchains/download.js", { "HOME object key": { count: 1, reason: TOOL_HOME } }],
  ["packages/vibe64-publishing/src/server/verificationRunner.js", { "HOME object key": { count: 1, reason: TOOL_HOME } }],
  ["packages/vibe64-pages/src/server/pageRefreshes.js", { "HOME object key": { count: 1, reason: "A page refresh script runs with a private HOME inside its temporary copy of the saved version, so it never reads or writes the person's own configuration." } }],
  ...["packages/vibe64-packaging/src/server/destinations/registryCommon.js", "packages/vibe64-packaging/src/server/stages.js"].map((filePath) => [filePath, {
    "HOME object key": { count: 1, reason: TOOL_HOME },
    "XDG_CACHE_HOME object key": { count: 1, reason: TOOL_HOME },
    "XDG_CONFIG_HOME object key": { count: 1, reason: TOOL_HOME }
  }]),
  ["packages/vibe64-terminals/src/server/opencodeServerProcess.js", {
    "export HOME": { count: 1, reason: "A managed OpenCode server keeps its home and XDG roots in its execution's private directory, so a stop without its handle still removes them." }
  }],
  ["packages/vibe64-deploy/src/adapters/google/machine.js", {
    "export HOME": { count: 1, reason: "The startup script of a deployed app's Google Cloud machine, never the person's computer, gives Docker's credential helper a writable home, as Container-Optimized OS keeps /root read-only." }
  }],
  ["packages/vibe64-terminals/src/server/vibe64OutputTargets.js", {
    "export PATH": { count: 1, reason: "Output startup restores the tool PATH Vibe64 resolved after a login shell (macOS path_helper) reorders it." }
  }]
]);

async function listJavaScriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "templates"].includes(entry.name)) {
        continue;
      }
      files.push(...await listJavaScriptFiles(filePath));
    } else if (entry.isFile() && filePath.endsWith(".js")) {
      files.push(filePath);
    }
  }
  return files;
}

function directExecutionMatches(source = "", filePath = "") {
  return DIRECT_EXECUTION_PATTERNS.flatMap(({ id, pattern }) => {
    const matches = [...source.matchAll(pattern)];
    if (!matches.length) {
      return [];
    }
    return [
      {
        filePath,
        id,
        count: matches.length
      }
    ];
  });
}

function patternMatches(patterns = [], source = "", filePath = "") {
  return patterns.flatMap(({ id, pattern }) => {
    const matches = [...source.matchAll(pattern)];
    if (!matches.length) {
      return [];
    }
    return [
      {
        filePath,
        id,
        count: matches.length
      }
    ];
  });
}

function assertAllowedMatches(actual = [], allowlist = new Map()) {
  const unexpected = actual.filter(({ filePath, id }) => !allowlist.get(filePath)?.[id]);
  const staleAllowlist = [];
  for (const [filePath, entries] of allowlist) {
    for (const id of Object.keys(entries)) {
      if (!actual.some((entry) => entry.filePath === filePath && entry.id === id)) {
        staleAllowlist.push(`${filePath} :: ${id}`);
      }
    }
  }

  assert.deepEqual(unexpected, []);
  assert.deepEqual(staleAllowlist, []);

  for (const { filePath, id, count } of actual) {
    const allowed = allowlist.get(filePath)[id];
    assert.equal(count, allowed.count, `${filePath} :: ${id}`);
    assert.ok(allowed.reason.length > 20);
  }
}

test("the package root exports no command starter but runCaptureCommand: spawnCommand and execFileCommand have their own subpath", async () => {
  const index = await readFile("packages/vibe64-execution/src/server/index.js", "utf8");
  const manifest = JSON.parse(await readFile("packages/vibe64-execution/package.json", "utf8"));
  assert.doesNotMatch(index, /engines\/commandSpawner\.js/u);
  assert.equal(manifest.exports["./server/commandSpawner"], "./src/server/engines/commandSpawner.js");
});

test("commands run around the gateway only from the files listed here, each with its reason", async () => {
  const files = await listJavaScriptFiles(PACKAGES_ROOT);
  const actual = [];
  for (const filePath of files) {
    if (filePath.startsWith("packages/vibe64-execution/")) {
      continue;
    }
    actual.push(...directExecutionMatches(await readFile(filePath, "utf8"), filePath));
  }

  assertAllowedMatches(actual, DIRECT_EXECUTION_ALLOWLIST);
});

test("direct HOME, XDG, and PATH policy bypasses stay explicit while migrating to vibe64-execution", async () => {
  const files = await listJavaScriptFiles(PACKAGES_ROOT);
  const actual = [];
  for (const filePath of files) {
    if (filePath.startsWith("packages/vibe64-execution/")) {
      continue;
    }
    actual.push(...patternMatches(ENV_POLICY_PATTERNS, await readFile(filePath, "utf8"), filePath));
  }

  assertAllowedMatches(actual, ENV_POLICY_ALLOWLIST);
});
