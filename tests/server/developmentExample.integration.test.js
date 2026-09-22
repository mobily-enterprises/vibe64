import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import getPort from "get-port";
import {
  inspectGenesisProject, inspectGenesisSubsystems, inspectVibe64Outputs, inspectVibe64WorkspaceSetup
} from "@local/vibe64-genesis/server";
import { prepareExampleProject } from "../../tooling/dev-example.mjs";
import "../../examples/hello-node/test/server.test.js";

const run = promisify(execFile);

test("the bundled example is a complete Genesis project and preparation preserves edits", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "v64-example-"));
  const projectRoot = path.join(root, "hello-node");
  try {
    await prepareExampleProject(projectRoot);
    assert.equal((await inspectGenesisProject({ projectRoot })).state, "ready");
    const subsystems = await inspectGenesisSubsystems({ projectRoot });
    assert.equal(subsystems.status, "valid");
    assert.deepEqual(subsystems.subsystems.map(({ id }) => id), ["welcome"]);
    const output = await inspectVibe64Outputs({ projectRoot });
    assert.equal(output.status, "ready");
    assert.deepEqual(output.diagnostics, []);
    const setup = await inspectVibe64WorkspaceSetup({ projectRoot });
    assert.deepEqual(setup.diagnostics, []);
    assert.deepEqual(setup.steps, []);
    const manifest = JSON.parse(await readFile(path.join(projectRoot, "package.json")));
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.devDependencies, undefined);
    const hooks = JSON.parse(await readFile(path.join(projectRoot, ".codex/hooks.json")));
    assert.ok(hooks.hooks.SessionStart);
    assert.match(await readFile(path.join(projectRoot, ".agents/skills/genesis-project/SKILL.md"), "utf8"), /Genesis/u);
    assert.match(await readFile(path.join(projectRoot, ".opencode/plugins/genesis-project-guidance.js"), "utf8"), /session\.compacted/u);
    assert.equal((await run("git", ["-C", projectRoot, "status", "--porcelain"])).stdout, "");
    await writeFile(path.join(projectRoot, "index.html"), "my saved example work");
    await prepareExampleProject(projectRoot);
    assert.equal(await readFile(path.join(projectRoot, "index.html"), "utf8"), "my saved example work");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Vibe64 declares native installation tools and its complete example preview", async () => {
  const projectRoot = path.resolve(import.meta.dirname, "../..");
  const setup = await inspectVibe64WorkspaceSetup({ projectRoot });
  assert.deepEqual(setup.diagnostics, []);
  assert.deepEqual(setup.steps[0].runtimeRequirements, ["nodejs", "cpp"]);
  const output = await inspectVibe64Outputs({ projectRoot });
  assert.equal(output.status, "ready");
  assert.deepEqual(output.diagnostics, []);
  assert.deepEqual(output.targets[0].steps[0].argv, ["npm", "run", "dev:example", "--", "--project",
    "{parameter:project-directory}", "--host", "{host}", "--port", "{port}"]);
  assert.equal(output.targets[0].parameters[0].default, ".vibe64-local/development/hello-node");
  assert.equal(output.targets[0].presentation.urlPath, "/app");
});

test("the development preview serves its own backend, frontend and project", { timeout: 90_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "v64-example-preview-"));
  const port = await getPort();
  let logs = "";
  const child = spawn(process.execPath, ["tooling/dev-example.mjs", "--port", String(port), "--state-dir", root], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    env: { ...process.env, VIBE64_MANAGED_EXECUTION_REQUIRED: "1", VIBE64_RUNTIME_NAMESPACE: "parent-editor",
      VIBE64_SYSTEM_ROOT: path.join(root, "parent-state"), VIBE64_TARGET_ROOT: "/invalid-parent-project" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (data) => { logs += data; });
  child.stderr.on("data", (data) => { logs += data; });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const origin = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) assert.fail(logs);
      try {
        const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { ready = true; break; }
      } catch { /* The backend and Vite are still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(ready, logs);
    assert.deepEqual(await (await fetch(`${origin}/api/health`)).json(), { ok: true, app: "vibe64" });
    const entry = await fetch(`${origin}/app`, { redirect: "manual" });
    assert.equal(entry.status, 302);
    assert.match(entry.headers.get("location"), /hello-node/u);
    const page = await fetch(`${origin}${entry.headers.get("location")}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /@vite\/client/u);
    const aiAccounts = await fetch(`${origin}/api/vibe64/accounts/ai-connections`);
    assert.equal(aiAccounts.status, 200, logs);
    const aiState = await aiAccounts.json();
    assert.equal(aiState.ok, true);
    assert.ok(aiState.connections.some((connection) => connection.id === "opencode" && connection.connected));
    const nativeAccounts = await (await fetch(`${origin}/api/vibe64/accounts?providerIds=codex`)).json();
    assert.equal(nativeAccounts.accounts.find((account) => account.id === "codex").connected, false);
    const realtime = await fetch(`${origin}/socket.io/?EIO=4&transport=polling`);
    assert.equal(realtime.status, 200);
    assert.match(await realtime.text(), /^0\{"sid"/u);
  } finally {
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 8000);
    await exited;
    clearTimeout(killTimer);
    await rm(root, { recursive: true, force: true });
  }
});
