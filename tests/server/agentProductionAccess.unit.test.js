import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import {
  __testables,
  createAgentEnvCommandService,
  prepareAgentEnvCommand
} from "../../packages/vibe64-terminals/src/server/agentEnvCommand.js";
import { NO_PRODUCTION_ENVIRONMENT } from "../../packages/vibe64-terminals/src/server/productionEnvironment.js";
import { NO_SAVED_ENV_VALUE_LINKS } from "../../packages/vibe64-terminals/src/server/savedEnvValueLinks.js";
import { runWithProjectRequestContext } from "../../packages/vibe64-core/src/server/projectRequestContext.js";

const OWNER = Object.freeze({ role: "owner", username: "owner" });
const MEMBER = Object.freeze({ role: "member", username: "member" });
const REFUSAL = "AI sessions may not use this project's production: the workspace owner turns it on in Production.";

function projectService() {
  return {
    async readCurrentProject() {
      return { projectRoot: "/srv/projects/demo", slug: "demo" };
    },
    async readEnv() {
      return { env: { records: [] }, ok: true };
    },
    async runInProjectContext(_slug, operation) {
      return operation();
    }
  };
}

// A host that lets only the owner's sessions use production, while its tick is on.
function productionHost({ enabled = true, configPath = "/srv/state/demo/production-ssh/config" } = {}) {
  const state = { enabled, opened: [], reads: [] };
  function refusal(actor) {
    if (!state.enabled) return { code: "vibe64_production_ai_access_off", error: REFUSAL, ok: false };
    if (actor?.role !== "owner") return { code: "vibe64_owner_required", error: "Only the workspace owner's sessions may use production.", ok: false };
    return null;
  }
  return {
    state,
    isUserValueRecord: () => false,
    async openProductionSsh(input) {
      state.opened.push(input);
      return refusal(input.actor) || { configPath, ok: true };
    },
    async readDeployment({ actor }) {
      const refused = refusal(actor);
      return { deployment: { aiAccess: { enabled: !refused, reason: refused?.error || "" }, state: "deployed" }, ok: true };
    },
    async readProductionValues(input) {
      state.reads.push(input);
      return refusal(input.actor) || {
        ok: true,
        releaseId: "20261111_080000z-ab12cd34",
        variables: [
          { key: "DB_PASSWORD", value: "s3cr'et value" },
          { key: "DB_HOST", value: "127.0.0.1" }
        ].filter((variable) => input.keys.length === 0 || input.keys.includes(variable.key))
      };
    },
    async readRecords() {
      return { ok: true, records: [] };
    },
    async removeVariable() {
      return { ok: true };
    },
    async setVariable() {
      return { ok: true };
    }
  };
}

async function boundCommand(production, actor = OWNER, sessionId = "prod-session") {
  const command = createAgentEnvCommandService({
    logger: silentLogger,
    productionEnvironmentProvider: production,
    project: projectService(),
    savedEnvValueLinks: NO_SAVED_ENV_VALUE_LINKS
  });
  await runWithProjectRequestContext({ slug: "demo", vibe64User: actor }, () => command.bindSession(sessionId));
  return command;
}

function run(command, args) {
  return command.run({ args, sessionId: "prod-session" });
}

function runProcess(file, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr, stdout }));
  });
}

test("env get and export production give the live release's values to a session the host allows, and say why not otherwise", async () => {
  const production = productionHost();
  const owner = await boundCommand(production);

  const value = await run(owner, ["get", "production", "DB_PASSWORD"]);
  assert.equal(value.exitCode, 0, value.stderr);
  assert.equal(value.stdout, "s3cr'et value\n");
  // The host hears who asks, from which session, for which project and which key, so it can decide and record it.
  assert.deepEqual(production.state.reads.at(-1),
    { actor: OWNER, keys: ["DB_PASSWORD"], projectSlug: "demo", sessionId: "prod-session" });

  const exported = await run(owner, ["export", "production"]);
  assert.equal(exported.exitCode, 0, exported.stderr);
  assert.match(exported.stdout, /^# The Env release 20261111_080000z-ab12cd34 runs with: production's secrets\./u);
  assert.match(exported.stdout, /^export DB_HOST='127\.0\.0\.1'\nexport DB_PASSWORD='s3cr'\\''et value'$/mu);
  assert.deepEqual(production.state.reads.at(-1).keys, []);

  const json = JSON.parse((await run(owner, ["get", "production", "DB_HOST", "--json"])).stdout);
  assert.deepEqual(json, { key: "DB_HOST", ok: true, releaseId: "20261111_080000z-ab12cd34", value: "127.0.0.1" });

  const missing = await run(owner, ["get", "production", "NOT_THERE"]);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /The live release 20261111_080000z-ab12cd34 runs without NOT_THERE\./u);

  for (const args of [["get", "development", "DB_HOST"], ["get", "production"], ["export", "production", "DB_HOST"]]) {
    const wrong = await run(owner, args);
    assert.equal(wrong.exitCode, 2, args.join(" "));
  }

  const member = await run(await boundCommand(production, MEMBER), ["get", "production", "DB_PASSWORD"]);
  assert.equal(member.exitCode, 1);
  assert.equal(member.stderr, "Only the workspace owner's sessions may use production.\n");

  production.state.enabled = false;
  const off = await run(owner, ["export", "production"]);
  assert.equal(off.exitCode, 1);
  assert.equal(off.stderr, `${REFUSAL}\n`);
  assert.doesNotMatch(String(off.stdout ?? ""), /s3cr/u);
});

test("deployment ssh-config answers with the host's configuration only for a session it allows, with the command line for its record", async () => {
  const production = productionHost();
  const owner = await boundCommand(production);

  const opened = await run(owner, ["deployment", "ssh-config", "--", "ssh", "production", "ls", "-la"]);
  assert.equal(opened.exitCode, 0, opened.stderr);
  assert.equal(opened.stdout, "/srv/state/demo/production-ssh/config\n");
  assert.deepEqual(production.state.opened.at(-1),
    { actor: OWNER, command: "ssh production ls -la", projectSlug: "demo", sessionId: "prod-session" });

  const status = await run(owner, ["deployment", "status"]);
  assert.match(status.stdout, /^AI access to production: on for this session \(ssh production; vibe64-helper env get\|export production\)$/mu);
  // With how to treat real people's data there, and where its commands are listed.
  assert.match(status.stdout, /^ {2}It holds real people's data: when possible read first, back up what you will change/mu);
  assert.match(status.stdout, /vibe64-helper deployment --help lists what works there \(production-logs, production-enter, \.\.\.\)\.$/mu);

  for (const args of [["deployment", "ssh-config", "--json"], ["deployment", "status", "--", "ls"], ["status", "--", "ls"]]) {
    assert.equal((await run(owner, args)).exitCode, 2, args.join(" "));
  }

  production.state.enabled = false;
  const off = await run(owner, ["deployment", "ssh-config", "--", "ssh", "production"]);
  assert.equal(off.exitCode, 1);
  assert.equal(off.stderr, `${REFUSAL}\n`);
  assert.match((await run(owner, ["deployment", "status"])).stdout,
    new RegExp(`^AI access to production: off — ${REFUSAL.replace(/[.]/gu, "\\$&")}$`, "mu"));
});

test("an installation without production refuses production values and ssh, and installs no ssh wrapper", async () => {
  const command = await boundCommand(NO_PRODUCTION_ENVIRONMENT);
  for (const args of [["get", "production", "DB_HOST"], ["export", "production"], ["deployment", "ssh-config"]]) {
    const result = await run(command, args);
    assert.equal(result.exitCode, 1, args.join(" "));
    assert.equal(result.stderr, "This Vibe64 installation does not publish projects.\n");
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-no-production-"));
  try {
    await prepareAgentEnvCommand({ commandService: command, sessionId: "prod-session", wrapperHostDir: root });
    await assert.rejects(access(path.join(root, "ssh")), { code: "ENOENT" });
  } finally {
    await command.closeAllForSession("prod-session");
    await rm(root, { force: true, recursive: true });
  }
});

test("the session's ssh wrapper runs ssh with the host's production configuration only for the production host", async (t) => {
  try {
    await access("/usr/bin/ssh");
  } catch {
    t.skip("this host has no /usr/bin/ssh");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-production-ssh-"));
  const configPath = path.join(root, "production.config");
  const production = productionHost({ configPath });
  const command = await boundCommand(production);
  try {
    await writeFile(configPath, "Host production\n  HostName 127.0.0.1\n  User v64a_0123456789ab\n", { mode: 0o600 });
    const prepared = await runWithProjectRequestContext({ slug: "demo", vibe64User: OWNER },
      () => prepareAgentEnvCommand({ commandService: command, sessionId: "prod-session", wrapperHostDir: root }));
    for (const name of ["ssh", "scp", "sftp"]) {
      assert.equal((await stat(path.join(root, name))).mode & 0o777, 0o755, name);
    }
    const env = { ...process.env, ...prepared.env, PATH: `${root}:${process.env.PATH}` };

    // ssh -G prints the configuration it would use and connects nowhere.
    const resolved = await runProcess(path.join(root, "ssh"), ["-G", "production"], env);
    assert.equal(resolved.code, 0, resolved.stderr);
    assert.match(resolved.stdout, /^hostname 127\.0\.0\.1$/mu);
    assert.match(resolved.stdout, /^user v64a_0123456789ab$/mu);
    assert.equal(production.state.opened.at(-1).command, "ssh -G production");

    const elsewhere = await runProcess(path.join(root, "ssh"), ["-G", "example.test"], env);
    assert.equal(elsewhere.code, 0, elsewhere.stderr);
    assert.match(elsewhere.stdout, /^hostname example\.test$/mu);
    assert.equal(production.state.opened.length, 1, "another host never asks for production");

    production.state.enabled = false;
    const refused = await runProcess(path.join(root, "ssh"), ["-G", "production"], env);
    assert.equal(refused.code, 255);
    assert.equal(refused.stderr, `${REFUSAL}\n`);
    assert.equal(refused.stdout, "");
  } finally {
    await command.closeAllForSession("prod-session");
    await rm(root, { force: true, recursive: true });
  }
});

test("the ssh wrappers name the system command and quote the Env command's path", () => {
  const source = __testables.productionSshWrapperSource("scp", "/srv/it's here/vibe64-env");
  assert.match(source, /^#!\/bin\/sh\n/u);
  assert.match(source, /config="\$\('\/srv\/it'\\''s here\/vibe64-env' deployment ssh-config -- scp "\$@"\)" \|\| exit 255/u);
  assert.match(source, /exec \/usr\/bin\/scp -F "\$config" "\$@" ;;/u);
  assert.match(source, /\nexec \/usr\/bin\/scp "\$@"\n$/u);
});
