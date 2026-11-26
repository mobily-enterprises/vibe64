import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parse } from "@typescript-eslint/parser";

// Every file of the editor (server.js, bin/, server/) and its packages (packages/; templates/, the files Vibe64 copies
// into a person's project, are not the editor and are skipped) that starts processes itself, with the number of times
// it uses what it takes from child_process, node-pty, execa or open (each reference to an imported name, and each
// dynamic import of one, or call naming one, as require and createRequire's functions take it), and why. The editor's
// finite commands start in commandExecutor.js, through commandSpawner.js; the rest of the editor starts only long-lived
// processes, once per owner, one finite command that cannot wait (the synchronous Git identity read) and the person's
// browser. Programs that are not the editor are listed too. Any other use, a new one in a listed file included, fails
// here, so a second way to start a command cannot grow unseen. Prose elsewhere points here instead of copying this list.
const LONG_LIVED = "long-lived, once per owner";
const FINITE_EXCEPTION = "the one finite exception";
const THE_BROWSER = "the person's browser";
const NOT_THE_EDITOR = "not the editor";
const PROCESS_STARTERS = new Map([
  ["packages/vibe64-execution/src/server/engines/commandExecutor.js", {
    kind: "where finite commands start",
    uses: 1,
    why: "The one spawn() of every finite command, in the editor's spawner or in a small process of its own."
  }],
  ["packages/vibe64-execution/src/server/engines/commandSpawner.js", {
    kind: LONG_LIVED,
    uses: 1,
    why: "Starts the command spawner itself, once per editor."
  }],
  ["packages/vibe64-execution/src/server/engines/terminalSessions.js", {
    kind: LONG_LIVED,
    uses: 1,
    why: "A runtime terminal needs a pseudo-terminal (node-pty), once per terminal."
  }],
  ["packages/vibe64-execution/src/server/engines/detached.js", {
    kind: LONG_LIVED,
    uses: 2,
    why: "A detached service writes its own log file and outlives its request, once per service; and the reaper that holds their process groups, once per editor."
  }],
  ["packages/vibe64-execution/src/server/env/gitIdentityEnv.js", {
    kind: FINITE_EXCEPTION,
    uses: 1,
    why: "A terminal's environment is built synchronously, so its Git identity read (spawnSync) cannot wait for the spawner's reply. Its asynchronous read goes through the spawner."
  }],
  ["packages/vibe64-database-tools/src/server/sqliteClient.js", {
    kind: LONG_LIVED,
    uses: 1,
    why: "A SQLite worker with its own IPC channel, once per connection, which keeps native queries off the editor's thread and lets them be cancelled."
  }],
  ["packages/vibe64-execution/src/server/engines/stdioBridge.js", {
    kind: NOT_THE_EDITOR,
    uses: 1,
    why: "The stdio bridge program an AI engine's conversation runs in (conversationExecution.js starts it through the gateway), which starts the engine."
  }],
  ["packages/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js", {
    kind: NOT_THE_EDITOR,
    uses: 1,
    why: "A plugin OpenCode loads into its own server process, inside that execution's scope, which runs a fixed Node composer with bounded output and a timeout."
  }],
  ["packages/vibe64-packaging/bin/vibe64-publish.js", {
    kind: NOT_THE_EDITOR,
    uses: 1,
    why: "The publishing command line, its own program, which runs Vibe64's fixed Git and tool commands without a shell."
  }],
  ["bin/server.js", {
    kind: THE_BROWSER,
    uses: 3,
    why: "Opens the person's browser once, after the server has started (the open package runs the platform's opener, such as xdg-open, detached); the browser is the person's and outlives the editor."
  }],
  ["bin/run.js", {
    kind: NOT_THE_EDITOR,
    uses: 2,
    why: "The vibe64 launcher, its own program, which starts the editor server in this terminal or in a new terminal window."
  }],
  ["bin/dev.js", {
    kind: NOT_THE_EDITOR,
    uses: 1,
    why: "The development launcher, its own program, which runs Vite's development server."
  }],
  ["packages/vibe64-usage-recording/runtime/php/build.mjs", {
    kind: NOT_THE_EDITOR,
    uses: 1,
    why: "The build script a person runs (node build.mjs) to compile the PHP usage recorder with phpize and make."
  }]
]);
const HOST_HELPER = "The execution helper, its own program, which the editor runs through sudo.";
const PROCESS_MODULE = /^(?:node:)?child_process$|^(?:@lydell\/)?node-pty$|^execa$|^open$/u;

async function editorFiles() {
  const files = ["server.js"];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory() && !["node_modules", "templates"].includes(entry.name)) await walk(file);
      else if (entry.isFile() && /\.(?:c|m)?js$/u.test(entry.name)) files.push(file);
    }
  }
  await walk("bin");
  await walk("server");
  await walk("packages");
  return files;
}

function moduleName(node) {
  return node?.type === "Literal" && typeof node.value === "string" && PROCESS_MODULE.test(node.value);
}

// The uses of what a file takes from a process module: every reference to a name it imports from one (calls,
// aliases and namespace members alike), every dynamic import of one, and every call of a function by its name with one
// as its first argument (require, or a function createRequire made; not a method such as an emitter's on("open")).
function processUses(source) {
  const program = parse(source, { ecmaVersion: "latest", range: false, sourceType: "module" });
  const names = new Set();
  for (const node of program.body) {
    if (node.type === "ImportDeclaration" && moduleName(node.source)) {
      for (const specifier of node.specifiers) names.add(specifier.local.name);
    }
  }
  let uses = 0;
  const visit = (node, parent, key) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "ImportDeclaration") return;
    if (node.type === "ImportExpression" && moduleName(node.source)) uses += 1;
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && moduleName(node.arguments[0])) uses += 1;
    const isName = (parent?.type === "MemberExpression" && key === "property" && !parent.computed) ||
      (["Property", "MethodDefinition", "PropertyDefinition"].includes(parent?.type) && key === "key" && !parent.computed);
    if (node.type === "Identifier" && names.has(node.name) && !isName) uses += 1;
    for (const [childKey, value] of Object.entries(node)) {
      if (childKey === "parent") continue;
      // A shorthand property's key and value are one reference.
      if (node.type === "Property" && node.shorthand && childKey === "key") continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === "object") visit(child, node, childKey);
      }
    }
  };
  visit(program, null, "");
  return uses;
}

test("every file that starts processes itself is listed with its number of uses and why: a new use anywhere fails", async () => {
  const found = new Map();
  for (const file of await editorFiles()) {
    const source = await readFile(file, "utf8");
    if (!/child_process|node-pty|execa|["']open["']/u.test(source)) continue;
    const uses = processUses(source);
    if (uses > 0) found.set(file, uses);
  }
  const listed = (file) => PROCESS_STARTERS.get(file) ||
    (file.startsWith("packages/vibe64-execution/src/host/") ? { kind: NOT_THE_EDITOR, uses: found.get(file), why: HOST_HELPER } : null);
  const unlisted = [...found].filter(([file, uses]) => listed(file)?.uses !== uses)
    .map(([file, uses]) => `${file}: ${uses} use${uses === 1 ? "" : "s"}${listed(file) ? `, listed with ${listed(file).uses}` : ""}`);
  assert.deepEqual(unlisted, [], "start these commands with spawnCommand or execFileCommand, or list the file with its reason");
  const stale = [...PROCESS_STARTERS.keys()].filter((file) => !found.has(file));
  assert.deepEqual(stale, [], "these files no longer start processes: remove them from the list");
  for (const { kind, why } of PROCESS_STARTERS.values()) {
    assert.ok([LONG_LIVED, FINITE_EXCEPTION, THE_BROWSER, NOT_THE_EDITOR, "where finite commands start"].includes(kind));
    assert.ok(why.length > 20);
  }
});

test("the count follows the code: a dynamic import, a require, a createRequire function, an alias and a namespace member each count, a mention in text does not", () => {
  assert.equal(processUses(`import { spawn } from "node:child_process"; spawn("a"); const start = spawn;`), 2);
  assert.equal(processUses(`import * as cp from "child_process"; cp.execFile("a"); cp.spawn("b");`), 2);
  assert.equal(processUses(`const cp = await import("node:child_process");`), 1);
  assert.equal(processUses(`const cp = require("child_process");`), 1);
  assert.equal(processUses(`const load = createRequire(import.meta.url); load("node-pty").spawn("sh");`), 1);
  assert.equal(processUses(`import open, { apps } from "open"; open(url, { app: { name: apps.browser } });`), 2);
  assert.equal(processUses(`socket.on("open", () => {}); emitter.emit("open");`), 0);
  assert.equal(processUses(`// child_process spawn\nconst text = "spawn(child_process)"; const o = { spawn: 1 }; o.spawn;`), 0);
});
