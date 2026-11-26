import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const child = path.join(repository, "packages/vibe64-terminals/src/server/sessionWorkOperationCommand.js");

// The files the session work child loads, as a loader hook reports them, for one request it refuses.
async function childModules() {
  const hooks = await mkdtemp(path.join(os.tmpdir(), "vibe64-child-modules-"));
  try {
    await writeFile(path.join(hooks, "hook.mjs"), `import { writeSync } from "node:fs";
export async function load(url, context, next) {
  if (url.startsWith("file:")) writeSync(2, "LOADED " + url + "\\n");
  return next(url, context);
}
`);
    await writeFile(path.join(hooks, "register.mjs"), `import { register } from "node:module";
register(${JSON.stringify(pathToFileURL(path.join(hooks, "hook.mjs")).href)});
`);
    const { code, stderr, stdout } = await new Promise((resolve, reject) => {
      const started = spawn(process.execPath, ["--import", path.join(hooks, "register.mjs"), child], {
        cwd: repository,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let errors = "";
      let output = "";
      started.stderr.setEncoding("utf8").on("data", (chunk) => { errors += chunk; });
      started.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
      started.once("error", reject);
      started.once("close", (exitCode) => resolve({ code: exitCode, stderr: errors, stdout: output }));
      started.stdin.end(JSON.stringify({ operation: "no-such-operation" }));
    });
    assert.equal(code, 1);
    assert.equal(JSON.parse(stdout).error.code, "vibe64_session_work_operation_unsupported");
    return stderr.split("\n").filter((line) => line.startsWith("LOADED ")).map((line) => fileURLToPath(line.slice(7)));
  } finally {
    await rm(hooks, { force: true, recursive: true });
  }
}

test("the session work child loads the execution pieces its operations use, never the command gateway they do not call", async () => {
  const execution = (await childModules())
    .filter((file) => file.includes(`${path.sep}vibe64-execution${path.sep}`))
    .map((file) => path.relative(path.join(repository, "packages", "vibe64-execution", "src", "server"), file));
  assert.ok(execution.includes("gitTurnCheckpoint.js"), "the child loads the pieces it uses");
  assert.deepEqual(
    execution.filter((file) => file === "index.js" || file === "runVibe64Command.js"),
    [],
    `the child loaded ${execution.length} execution modules`
  );
});
