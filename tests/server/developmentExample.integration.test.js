import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import getPort from "get-port";
import http from "node:http";
import { resolveCommandEnv } from "../../packages/vibe64-execution/src/server/env/resolveCommandEnv.js";
import { currentActorUser } from "../../packages/vibe64-execution/src/server/actor/userIdentity.js";
import { previewPublicSocketPath } from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";
import { once } from "node:events";
import { io } from "socket.io-client";
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
  assert.deepEqual(setup.steps[1].argv, ["npm", "rebuild", "node-pty"]);
  assert.deepEqual(setup.steps[1].runtimeRequirements, ["nodejs", "cpp"]);
  const output = await inspectVibe64Outputs({ projectRoot });
  assert.equal(output.status, "ready");
  assert.deepEqual(output.diagnostics, []);
  assert.deepEqual(output.targets[0].steps[0].argv, ["npm", "run", "dev:example", "--", "--connected-sources",
    ".development/connected.json", "--project",
    "{parameter:project-directory}", "--host", "{host}", "--port", "{port}"]);
  assert.equal(output.targets[0].parameters[0].default, ".vibe64-local/development/hello-node");
  assert.equal(output.targets[0].presentation.urlPath, "/app");
});

test("the development preview serves its own backend, frontend and project", { timeout: 180_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "v64-example-preview-"));
  const port = await getPort();
  const claudeCommand = path.join(root, "claude.cjs");
  await writeFile(claudeCommand, `#!${process.execPath}
if (JSON.stringify(process.argv.slice(2)) === JSON.stringify(["auth", "status", "--json"])) {
  console.log(JSON.stringify({ loggedIn: true, email: "local-cli@example.test", authMethod: "claude.ai", subscriptionType: "pro" }));
} else {
  require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
    const frame = JSON.parse(line);
    if (frame.type === "control_request") console.log(JSON.stringify({ type: "control_response",
      response: { subtype: "success", request_id: frame.request_id,
        response: { models: [{ value: "sonnet", supportedEffortLevels: ["high"] }] } } }));
  });
}
`);
  await chmod(claudeCommand, 0o700);
  let logs = "";
  const child = spawn(process.execPath, ["tooling/dev-example.mjs", "--port", String(port), "--state-dir", root], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    env: resolveCommandEnv({ actor: { actor: "daemon", user: currentActorUser() },
      localPath: process.env.PATH, baseEnv: { ...process.env, VIBE64_MANAGED_EXECUTION_REQUIRED: "1", VIBE64_RUNTIME_NAMESPACE: "parent-editor",
      VIBE64_SYSTEM_ROOT: path.join(root, "parent-state"), VIBE64_TARGET_ROOT: "/invalid-parent-project",
      VIBE64_CLAUDE_COMMAND: claudeCommand, LOG_LEVEL: "debug",
      VIBE64_WORKSPACE: "example", VIBE64_PUBLIC_USER_DOMAIN: "users.example.test",
      VIBE64_PUBLIC_PROTOCOL: "https", VIBE64_PREVIEW_PUBLIC_DOMAIN: "preview.example.test",
      VIBE64_PREVIEW_PUBLIC_NAMESPACE: "parent-editor",
      VIBE64_PREVIEW_PROXY_SOCKET_DIR: "", XDG_RUNTIME_DIR: path.join(root, "runtime") } }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (data) => { logs += data; });
  child.stderr.on("data", (data) => { logs += data; });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const origin = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) assert.fail(logs);
      try {
        const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000) });
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
    assert.deepEqual(aiState.connections, [], "Vibe64 includes no AI connection of its own");
    const nativeAccounts = await (await fetch(`${origin}/api/vibe64/accounts?providerIds=codex`)).json();
    assert.equal(nativeAccounts.accounts.find((account) => account.id === "codex").connected, false);
    const claudeAccounts = await (await fetch(`${origin}/api/vibe64/accounts?providerIds=claude`)).json();
    const claudeAccount = claudeAccounts.accounts.find((account) => account.id === "claude");
    assert.equal(claudeAccount.connected, true);
    assert.equal(claudeAccount.username, "local-cli@example.test");
    const realtime = await fetch(`${origin}/socket.io/?EIO=4&transport=polling`);
    assert.equal(realtime.status, 200);
    assert.match(await realtime.text(), /^0\{"sid"/u);
    const socket = io(origin, { autoConnect: false, forceNew: true, reconnection: false,
      transports: ["websocket"], extraHeaders: { Origin: origin, "x-forwarded-proto": "https" } });
    try {
      const connected = once(socket, "connect", { signal: AbortSignal.timeout(20_000) });
      socket.connect();
      try {
        await connected;
      } catch (error) {
        throw new Error(`Development editor realtime connection failed: ${logs}`, { cause: error });
      }
      const response = await socket.timeout(5000).emitWithAck("assistant.conversation.subscribe", {
        subscriptionId: "example-proxy-origin", conversationId: "missing-example-conversation",
        targetSurfaceId: "app", hostSurfaceId: "app"
      });
      assert.equal(response.code, "conversation_forbidden");
      assert.equal(response.error, "This Colleague conversation is unavailable.",
        "forwarded HTTPS must reach conversation lookup, not fail the local origin check");
    } finally {
      socket.disconnect();
    }
    const opened = await fetch(`${origin}/api/app/hello-node/vibe64/project-runtime/open`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "project-open" })
    });
    assert.ok(opened.ok, await opened.text());
    const createdResponse = await fetch(`${origin}/api/app/hello-node/vibe64/sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(createdResponse.status, 200, await createdResponse.clone().text());
    const created = await createdResponse.json();
    assert.ok(created.sessionId);
    const sessionApi = `${origin}/api/app/hello-node/vibe64/sessions/${created.sessionId}`;
    const started = await fetch(`${sessionApi}/output-runs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ outputTargetId: "app" })
    });
    assert.ok(started.ok, await started.text());
    let output;
    const outputDeadline = Date.now() + 45_000;
    while (Date.now() < outputDeadline) {
      output = await (await fetch(`${sessionApi}/outputs`)).json();
      if (["ready", "failed", "project_closed"].includes(output.preview?.state)) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(output.preview?.state, "ready", JSON.stringify(output));
    const preview = new URL(output.previewTarget.href);
    const socketPath = previewPublicSocketPath(preview.origin, { XDG_RUNTIME_DIR: path.join(root, "runtime") });
    const nestedPage = await new Promise((resolve, reject) => {
      const request = http.get({ socketPath, path: preview.pathname + preview.search,
        headers: { host: preview.host } }, response => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, body }));
      });
      request.on("error", reject);
      request.setTimeout(5000, () => request.destroy(new Error("Nested Preview request timed out")));
    });
    assert.equal(nestedPage.status, 200);
    assert.match(nestedPage.body, /Hello, Node\./u);
    assert.match(logs, /"level":(?:10|20|30),/u, "the existing LOG_LEVEL setting must reach the application logger");
  } finally {
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 8000);
    await exited;
    clearTimeout(killTimer);
    await rm(root, { recursive: true, force: true });
  }
});
