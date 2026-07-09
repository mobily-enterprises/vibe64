import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const PACKAGES_ROOT = "packages";

const DIRECT_EXECUTION_PATTERNS = Object.freeze([
  {
    id: "child_process import",
    pattern: /from\s+["']node:child_process["']|require\s*\(\s*["']node:child_process["']\s*\)/gu
  },
  {
    id: "execa import",
    pattern: /from\s+["']execa["']/gu
  },
  {
    id: "spawn call",
    pattern: /\bspawn\s*\(/gu
  },
  {
    id: "execFile call",
    pattern: /\bexecFile\s*\(/gu
  },
  {
    id: "startTerminalSession call",
    pattern: /\bstartTerminalSession\s*\(/gu
  },
  {
    id: "runHostCommand call",
    pattern: /\brunHostCommand\s*\(/gu
  },
  {
    id: "runHostUserCommand call",
    pattern: /\brunHostUserCommand\s*\(/gu
  }
]);

const DIRECT_EXECUTION_ALLOWLIST = new Map(Object.entries({}));

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

const ENV_POLICY_ALLOWLIST = new Map(Object.entries({}));

async function listJavaScriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
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

  for (const { filePath, id } of actual) {
    assert.match(allowlist.get(filePath)[id], /^Phase \d+(?:\/\d+)?: /u);
  }
}

test("direct command execution bypasses stay explicit while migrating to vibe64-execution", async () => {
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
