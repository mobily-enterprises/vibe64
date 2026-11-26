import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// commandSpawner.js starts every finite command the editor runs. Only the files below may start processes
// themselves: they start long-lived processes, once per owner, each needing a terminal, a file descriptor or a
// channel of its own, or they are not the editor at all. A new direct start anywhere else fails here, instead of
// quietly growing a second way to start a command.
const LONG_LIVED_STARTERS = new Map([
  ["packages/vibe64-execution/src/server/engines/commandExecutor.js", "Where every finite command starts, in the spawner or in a small process."],
  ["packages/vibe64-execution/src/server/engines/commandSpawner.js", "Starts the command spawner itself, once per editor."],
  ["packages/vibe64-execution/src/server/engines/terminalSessions.js", "A runtime terminal needs a pseudo-terminal (node-pty), once per terminal."],
  ["packages/vibe64-execution/src/server/engines/detached.js", "A detached service writes its own log file and outlives its request, once per service; and the reaper holding their groups, once per editor."],
  ["packages/vibe64-execution/src/server/engines/stdioBridge.js", "An AI engine's stdio bridge, once per engine."],
  ["packages/vibe64-execution/src/server/env/gitIdentityEnv.js", "The synchronous Git identity read a terminal's environment needs (spawnSync), which cannot wait for the spawner."],
  ["packages/vibe64-database-tools/src/server/sqliteClient.js", "A SQLite worker with its own IPC channel, once per connection."]
]);
const NOT_THE_EDITOR = new Map([
  ["packages/vibe64-execution/src/host/", "The execution helper: its own program, which the editor runs through sudo."],
  ["packages/vibe64-execution/src/server/runtime/agentPlaywrightCommandSource.js", "The source of a tool an agent runs in its own process."],
  ["packages/vibe64-execution/src/server/runtime/agentPreviewBrowserWorkerSource.js", "The source of a worker an agent's browser tool runs in its own process."],
  ["packages/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js", "A plugin OpenCode loads into its own server process."]
]);
const PROCESS_START = /from\s+["'](?:node:)?child_process["']|require\s*\(\s*["'](?:node:)?child_process["']\s*\)|["'](?:@lydell\/)?node-pty["']/u;

async function editorServerFiles() {
  const files = ["server.js"];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory() && !["node_modules", "templates"].includes(entry.name)) await walk(file);
      else if (entry.isFile() && /\.(?:c|m)?js$/u.test(entry.name)) files.push(file);
    }
  }
  await walk("server");
  for (const entry of await readdir("packages", { withFileTypes: true })) {
    if (entry.isDirectory()) await walk(path.join("packages", entry.name, "src")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return files;
}

test("only the listed long-lived starters start processes themselves; every finite command goes through commandSpawner", async () => {
  const starters = [];
  for (const file of await editorServerFiles()) {
    if (PROCESS_START.test(await readFile(file, "utf8"))) starters.push(file);
  }
  const listed = (file) => LONG_LIVED_STARTERS.has(file) ||
    [...NOT_THE_EDITOR.keys()].some((entry) => entry.endsWith("/") ? file.startsWith(entry) : file === entry);
  assert.deepEqual(starters.filter((file) => !listed(file)), [], "start these commands with spawnCommand or execFileCommand");
  const stale = [...LONG_LIVED_STARTERS.keys(), ...NOT_THE_EDITOR.keys()]
    .filter((entry) => !starters.some((file) => entry.endsWith("/") ? file.startsWith(entry) : file === entry));
  assert.deepEqual(stale, [], "these entries no longer start processes: remove them from the list");
});
