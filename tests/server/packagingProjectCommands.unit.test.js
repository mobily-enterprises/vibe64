import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installVibe64ManagedExecutionProvider } from "@local/vibe64-execution/server";

import { checkCommandRunner } from "../../packages/vibe64-packaging/src/server/projectCommands.js";
import { runBuildStage } from "../../packages/vibe64-packaging/src/server/stages.js";

const TOKEN = "npm_SECRETvalue0123456789";

// A host's managed execution provider: it sees every project command and runs it.
function recordingProvider(t) {
  const requests = [];
  const release = installVibe64ManagedExecutionProvider({
    async runCommand(request, context) {
      requests.push({ request, env: context.env });
      return context.runLocal();
    },
    async stopExecution() {
      return { ok: true, scopeEmpty: true };
    }
  });
  t.after(release);
  return requests;
}

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-project-commands-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  await mkdir(source, { recursive: true });
  return { root, source };
}

test("release builds run through the command gateway as the app, with only their credential-free environment", async (t) => {
  const requests = recordingProvider(t);
  const { root, source } = await workspace(t);
  const built = await runBuildStage({
    planHash: `sha256:${"d".repeat(64)}`,
    packageId: "sdk",
    steps: [{
      label: "Pack",
      argv: ["node", "-e", "require('fs').writeFileSync('sdk.tgz', [process.env.HOME, process.env.BUILD_FLAVOUR, process.env.NPM_TOKEN || ''].join('|'))"],
      cwd: source
    }],
    outputs: [path.join(source, "sdk.tgz")],
    environment: [{ name: "BUILD_FLAVOUR", value: "release" }],
    resultStore: path.join(root, "results"),
    allowedRoots: [source],
    baseEnvironment: { PATH: process.env.PATH, LANG: "C.UTF-8", NPM_TOKEN: TOKEN, HOME: "/home/person" },
    projectSlug: "tidy-strings"
  });

  assert.equal(requests.length, 1, "the build step went through the host's provider");
  const [{ request, env }] = requests;
  assert.equal(request.actor, "app");
  assert.equal(request.inheritProcessEnv, false);
  assert.equal(request.purpose, "output");
  assert.equal(request.cwd, source);
  assert.deepEqual(request.allowedRoots, [source]);
  assert.equal(request.execution.kind, "job");
  assert.equal(request.execution.projectSlug, "tidy-strings");
  assert.ok(request.timeout >= 30 * 60_000, "a long build is not cut off at the gateway's short default");
  assert.notEqual(env.HOME, "/home/person");
  assert.equal(env.HOME, request.credentialHome.home, "the stage's throwaway HOME is the command's home");
  assert.ok(!Object.values(env).some((value) => String(value).includes(TOKEN)), "no editor credential reaches the build");

  const [{ path: artifact }] = built.manifest.files;
  const [home, flavour, token] = (await readFile(path.join(built.directory, "files", artifact), "utf8")).split("|");
  assert.equal(home, env.HOME);
  assert.equal(flavour, "release");
  assert.equal(token, "");
});

test("checks on the saved commit run through the command gateway and fail with the command's output", async (t) => {
  const requests = recordingProvider(t);
  const { root, source } = await workspace(t);
  const run = checkCommandRunner({ projectSlug: "weather-kit" });
  const environment = { HOME: path.join(root, "home"), PATH: process.env.PATH, CI: "1", TWINE_PASSWORD: undefined };
  await mkdir(environment.HOME);

  const passed = await run("node", ["-e", "process.stdout.write('ok')"], { cwd: source, env: environment, timeoutMs: 60_000 });
  assert.equal(String(passed.stdout), "ok");
  await assert.rejects(
    run("node", ["-e", "console.error('2 tests failed'); process.exit(3)"], { cwd: source, env: environment, timeoutMs: 60_000 }),
    (error) => error.code === "VERIFICATION_FAILED" && error.details.status === 3 && /2 tests failed/u.test(error.details.stderr)
  );

  assert.equal(requests.length, 2);
  for (const { request, env } of requests) {
    assert.equal(request.actor, "app");
    assert.equal(request.execution.operationId, "publish-check");
    assert.equal(request.execution.projectSlug, "weather-kit");
    assert.equal(env.HOME, environment.HOME);
    assert.equal(env.CI, "1");
  }
});
