import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { execFileCommand } from "../../packages/vibe64-execution/src/server/engines/commandSpawner.js";
import { createServer } from "../../server.js";

const env = { PATH: process.env.PATH };

/** The process that started a command: the parent of a shell it runs. */
async function commandParent() {
  const { stdout } = await execFileCommand("sh", ["-c", "echo $PPID"], { env });
  return Number(stdout.trim());
}

// The editor grows large, and a command it started by forking itself would hold its main thread for a copy of its whole
// heap (commandSpawner.js). So its server sends every command to a spawner from its boot, before it accepts requests.
test("the editor server's boot sends every later command to its spawner, before the server accepts requests", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-server-spawner-"));
  process.once("exit", () => rmSync(root, { force: true, recursive: true }));
  const previousNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = `server-spawner-${process.pid}`;
  let app = null;
  try {
    assert.equal(await commandParent(), process.pid, "a process that has not started a server runs its commands itself");
    app = await createServer({
      managedSourceRoot: path.join(root, "managed"),
      projectsRoot: path.join(root, "projects"),
      systemRoot: path.join(root, "state")
    });
    assert.equal(app.server.listening, false);
    const parent = await commandParent();
    assert.notEqual(parent, process.pid);
    assert.match(readFileSync(`/proc/${parent}/cmdline`, "utf8"), /commandSpawnerProcess\.js/u);
  } finally {
    await app?.close();
    if (previousNamespace === undefined) delete process.env.VIBE64_RUNTIME_NAMESPACE;
    else process.env.VIBE64_RUNTIME_NAMESPACE = previousNamespace;
  }
});
