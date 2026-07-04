import assert from "node:assert/strict";
import {
  readdir,
  readFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  fileURLToPath
} from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const SCAN_ROOTS = [
  "packages",
  "src"
];

const IGNORED_DIRECTORIES = new Set([
  "build",
  "coverage",
  "dist",
  "docs",
  "node_modules",
  "tests"
]);

const SCANNED_PATTERNS = [
  {
    pattern: "startTerminalSession(",
    regex: /\bstartTerminalSession\s*\(/g
  },
  {
    pattern: "startTerminalSessionFn(",
    regex: /\bstartTerminalSessionFn\s*\(/g
  },
  {
    pattern: "startCommandTerminalProcess(",
    regex: /\bstartCommandTerminalProcess\s*\(/g
  },
  {
    pattern: "registerTerminalWebSocketRoute(",
    regex: /\bregisterTerminalWebSocketRoute\s*\(/g
  }
];

const EXPECTED_TERMINAL_INVENTORY = [
  {
    count: 1,
    file: "packages/current-app/src/server/registerRoutes.js",
    pattern: "registerTerminalWebSocketRoute(",
    reason: "current-app target script websocket"
  },
  {
    count: 1,
    file: "packages/current-app/src/server/service.js",
    pattern: "startTerminalSession(",
    reason: "current-app target script terminal"
  },
  {
    count: 1,
    file: "packages/setup-doctor-core/src/server/doctorPluginToolkit.js",
    pattern: "startTerminalSession(",
    reason: "setup doctor plugin terminal action helper"
  },
  {
    count: 1,
    file: "packages/setup-doctor-core/src/server/setupDoctorGit.js",
    pattern: "startTerminalSession(",
    reason: "setup doctor git repair terminal helper"
  },
  {
    count: 1,
    file: "packages/studio-terminal-core/src/server/terminalSessions.js",
    pattern: "startTerminalSession(",
    reason: "terminal primitive definition, not a product opener"
  },
  {
    count: 1,
    file: "packages/vibe64-accounts/src/server/registerRoutes.js",
    pattern: "registerTerminalWebSocketRoute(",
    reason: "account auth websocket"
  },
  {
    count: 1,
    file: "packages/vibe64-accounts/src/server/service.js",
    pattern: "startTerminalSessionFn(",
    reason: "account auth injected terminal starter"
  },
  {
    count: 1,
    file: "packages/vibe64-core/src/server/serviceOwnedTerminalRoutes.js",
    pattern: "registerTerminalWebSocketRoute(",
    reason: "service-owned terminal route helper delegates websocket registration"
  },
  {
    count: 1,
    file: "packages/vibe64-core/src/server/terminalWebSocketRoutes.js",
    pattern: "registerTerminalWebSocketRoute(",
    reason: "websocket route helper definition, not a route registration"
  },
  {
    count: 2,
    file: "packages/vibe64-terminals/src/server/commandTerminal.js",
    pattern: "startCommandTerminalProcess(",
    reason: "project tool command-run helper definition and call site"
  },
  {
    count: 3,
    file: "packages/vibe64-terminals/src/server/codexTerminal.js",
    pattern: "startTerminalSession(",
    reason: "session Codex, global Codex, and Fix Codex starts"
  },
  {
    count: 1,
    file: "packages/vibe64-terminals/src/server/launchTargetTerminal.js",
    pattern: "startTerminalSession(",
    reason: "launch/preview terminal"
  },
  {
    count: 6,
    file: "packages/vibe64-terminals/src/server/registerRoutes.js",
    pattern: "registerTerminalWebSocketRoute(",
    reason: "global Codex, Fix Codex, project tool, session Codex, workflow command, and launch websockets"
  }
];

function isScannableFile(filePath) {
  return filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs");
}

function sortEntries(entries) {
  return entries.toSorted((left, right) => {
    const fileOrder = left.file.localeCompare(right.file);
    if (fileOrder !== 0) {
      return fileOrder;
    }
    return left.pattern.localeCompare(right.pattern);
  });
}

async function listSourceFiles(rootPath) {
  const entries = await readdir(rootPath, {
    withFileTypes: true
  });
  const files = [];
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(entryPath));
      continue;
    }
    if (entry.isFile() && isScannableFile(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

function stripJavaScriptComments(source) {
  let output = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || "";
    if (state === "lineComment") {
      if (char === "\n") {
        output += "\n";
        state = "code";
      } else {
        output += " ";
      }
      continue;
    }
    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "code";
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "singleQuote" || state === "doubleQuote" || state === "template") {
      output += char;
      if (char === "\\") {
        output += next;
        index += 1;
        continue;
      }
      if (state === "singleQuote" && char === "'") {
        state = "code";
      } else if (state === "doubleQuote" && char === "\"") {
        state = "code";
      } else if (state === "template" && char === "`") {
        state = "code";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      state = "lineComment";
      continue;
    }
    if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      state = "blockComment";
      continue;
    }
    output += char;
    if (char === "'") {
      state = "singleQuote";
    } else if (char === "\"") {
      state = "doubleQuote";
    } else if (char === "`") {
      state = "template";
    }
  }
  return output;
}

function countMatches(source, regex) {
  regex.lastIndex = 0;
  return Array.from(source.matchAll(regex)).length;
}

async function collectInventory() {
  const files = [];
  for (const scanRoot of SCAN_ROOTS) {
    files.push(...await listSourceFiles(path.join(REPO_ROOT, scanRoot)));
  }
  const inventory = [];
  for (const filePath of files) {
    const relativePath = path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
    const source = stripJavaScriptComments(await readFile(filePath, "utf8"));
    for (const { pattern, regex } of SCANNED_PATTERNS) {
      const count = countMatches(source, regex);
      if (count > 0) {
        inventory.push({
          count,
          file: relativePath,
          pattern
        });
      }
    }
  }
  return sortEntries(inventory);
}

function entryKey(entry) {
  return `${entry.file}\t${entry.pattern}\t${entry.count}`;
}

function formatEntries(entries) {
  if (entries.length === 0) {
    return "  none";
  }
  return entries.map((entry) => {
    const reason = entry.reason ? ` # ${entry.reason}` : "";
    return `  ${entry.file} :: ${entry.pattern} x${entry.count}${reason}`;
  }).join("\n");
}

function inventoryFailureMessage({ added, missing }) {
  return [
    "Terminal inventory drift detected.",
    "",
    "Added entries:",
    formatEntries(added),
    "",
    "Missing entries:",
    formatEntries(missing),
    "",
    "If this is a new service-owned command/job terminal, use",
    "`registerServiceOwnedTerminalRoutes` and `createOwnedTerminalAccessors`.",
    "Otherwise update this inventory with the reason this terminal is special.",
    "",
    "Deployment publish lives in vibe64-online and is covered by the deployment migration slice."
  ].join("\n");
}

test("terminal opener and websocket inventory has no invisible drift", async () => {
  const actual = await collectInventory();
  const expected = sortEntries(EXPECTED_TERMINAL_INVENTORY);
  const actualKeys = new Set(actual.map(entryKey));
  const expectedKeys = new Set(expected.map(entryKey));
  const added = actual.filter((entry) => !expectedKeys.has(entryKey(entry)));
  const missing = expected.filter((entry) => !actualKeys.has(entryKey(entry)));
  assert.deepEqual({
    added,
    missing
  }, {
    added: [],
    missing: []
  }, inventoryFailureMessage({
    added,
    missing
  }));
});
