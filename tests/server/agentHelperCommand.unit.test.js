import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";
import { createAgentDatabaseCommandService, prepareAgentDatabaseCommand } from "../../packages/vibe64-terminals/src/server/agentDatabaseCommand.js";

const HELPER_GROUPS = ["preview", "playwright", "env", "database", "github"];

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64 helper's "));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await prepareAgentHelperCommand({ wrapperHostDir: root }), { ok: true });
  return { root, helper: path.join(root, "vibe64-helper") };
}

function run(command, args, { env = process.env, cwd, input = Buffer.alloc(0) } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr).toString()
    }));
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") {
        reject(error);
      }
    });
    child.stdin.end(input);
  });
}

test("helper help lists its fixed groups and invalid groups cannot select another executable", async (t) => {
  const { root, helper } = await fixture(t);
  for (const args of [[], ["--help"], ["-h"]]) {
    const result = await run(helper, args);
    assert.equal(result.code, 0, result.stderr);
    for (const group of HELPER_GROUPS) {
      assert.match(result.stdout.toString(), new RegExp(`  ${group} +`, "u"));
    }
  }
  for (const group of ["git", "gh", "session-command", "../preview", "--unknown"]) {
    const result = await run(helper, [group]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Unknown Vibe64 helper group/u);
  }
  const missing = await run(helper, ["env", "status"], { env: { ...process.env, PATH: root } });
  assert.equal(missing.code, 127);
  assert.match(missing.stderr, /env is unavailable in this session/u);
});

test("every helper group preserves arguments, stdin bytes, environment, cwd and exit status through its existing executable", async (t) => {
  const { root } = await fixture(t);
  const wrapper = `#!/usr/bin/env node
const fs = require("node:fs");
process.stdout.write(fs.readFileSync(0));
process.stderr.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), identity: process.env.HELPER_TEST_IDENTITY }));
process.exitCode = 23;
`;
  const input = Buffer.from([0, 1, 10, 13, 128, 255]);
  const args = ["set", "", "space and 'quote'", "$(literal)", "`literal`", "a\nb", "--json"];
  for (const group of HELPER_GROUPS) {
    const existing = path.join(root, `vibe64-${group}`);
    await writeFile(existing, wrapper, { mode: 0o755 });
    await prepareAgentHelperCommand({ wrapperHostDir: root });
    assert.equal(await readFile(existing, "utf8"), wrapper);
    const options = { cwd: root, env: { ...process.env, HELPER_TEST_IDENTITY: "session-1", PATH: `${root}:${process.env.PATH}` }, input };
    const result = await run("vibe64-helper", [group, ...args], options);
    const original = await run(existing, args, options);
    assert.deepEqual(result, original);
    assert.equal(result.code, 23);
    assert.deepEqual(result.stdout, input);
    assert.deepEqual(JSON.parse(result.stderr), { args, cwd: root, identity: "session-1" });
  }
});

test("helper exec preserves process identity and direct signal cancellation", { timeout: 5000 }, async (t) => {
  const { root, helper } = await fixture(t);
  await writeFile(path.join(root, "vibe64-preview"), `#!/usr/bin/env node
process.stdout.write(String(process.pid));
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const child = spawn(helper, ["preview", "status"], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  });
  const closed = once(child, "close");
  const [output] = await once(child.stdout, "data");
  assert.equal(Number(output.toString()), child.pid);
  child.kill("SIGTERM");
  const [code, signal] = await closed;
  assert.equal(code, null);
  assert.equal(signal, "SIGTERM");
});

test("helper and individual database commands use the same authenticated session socket", async (t) => {
  const { root, helper } = await fixture(t);
  const calls = [];
  const command = createAgentDatabaseCommandService({ projectService: {
    async readCurrentProject() { return { slug: "demo", projectRoot: root }; },
    async runInProjectContext(slug, operation) { assert.equal(slug, "demo"); return operation(); }
  } });
  command.setDatabaseToolsProvider({
    async refreshSchema(input) { calls.push(input); return { ok: true, schema: { tables: [] } }; }
  });
  t.after(() => command.closeAllForSession("helper-session"));
  const prepared = await prepareAgentDatabaseCommand({ commandService: command, sessionId: "helper-session", wrapperHostDir: root });
  const env = { ...process.env, ...prepared.env };
  for (const [executable, args] of [[helper, ["database", "refresh", "--json"]], [prepared.hostWrapperPath, ["refresh", "--json"]]]) {
    const result = await run(executable, args, { env });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).tableCount, 0);
    const denied = await run(executable, args, { env: { ...env, VIBE64_AGENT_DATABASE_COMMAND_TOKEN: "wrong-token" } });
    assert.equal(denied.code, 1);
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every((input) => input.sessionId === "helper-session"));
  const help = await run(helper, ["database", "--help"], { env });
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout.toString(), /vibe64-helper database erd apply/u);
});
