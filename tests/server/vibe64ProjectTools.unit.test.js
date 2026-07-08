import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createProjectToolRegistry
} from "@local/vibe64-runtime/server/projectToolRegistry";
import {
  createService
} from "../../packages/vibe64-project/src/server/service.js";
import {
  createStudioProjectContext
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  createVibe64ProjectConfigStore
} from "@local/vibe64-adapters/server/configStore";
import {
  LARAVEL_DATABASE_RUNTIME_CONFIG
} from "@local/vibe64-adapters/server/adapters/laravel/constants";
import {
  createFixCodexJobStore,
  fixCodexReportInstructions,
  prepareFixCodexReportHelper
} from "../../packages/vibe64-terminals/src/server/fixCodexJobs.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

function runNodeScript(scriptPath = "", args = [], env = {}, stdin = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      scriptPath,
      ...args
    ], {
      env: {
        ...process.env,
        ...env
      },
      stdio: [
        "pipe",
        "pipe",
        "pipe"
      ]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end(stdin);
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve({
        code,
        stderr,
        stdout
      });
    });
  });
}

function createServiceForTemporaryTarget(targetRoot) {
  return createService({
    projectContext: createStudioProjectContext({
      explicitManagedSourceRoot: path.join(path.dirname(targetRoot), "managed-source"),
      explicitTargetRoot: targetRoot,
      env: {},
      home: path.dirname(targetRoot)
    })
  });
}

async function createSessionSourceFixture(service, sessionId = "") {
  const sourcePath = path.join(service.currentProjectSessionSourceRoot(), "sessions", "active", sessionId, "source");
  const metadataRoot = path.join(service.currentProjectLocalRoot(), "sessions", "active", sessionId, "metadata");
  await mkdir(sourcePath, {
    recursive: true
  });
  await mkdir(metadataRoot, {
    recursive: true
  });
  await writeFile(path.join(metadataRoot, "source_path"), `${sourcePath}\n`, "utf8");
  return sourcePath;
}

test("project tool registry validates models and lists tools deterministically", async () => {
  const registry = createProjectToolRegistry();

  registry.registerTools("unit", [
    {
      id: "z_tool",
      label: "Z tool",
      type: "command",
      parameters: [],
      command: async () => ({ ok: true })
    },
    {
      id: "a_tool",
      label: "A tool",
      type: "prompt",
      parameters: [
        {
          id: "mode",
          label: "Mode",
          type: "enum",
          options: [
            {
              label: "Fast",
              value: "fast"
            }
          ]
        }
      ],
      prompt: "Do the thing."
    }
  ]);

  assert.deepEqual((await registry.listTools()).map((tool) => tool.id), [
    "a_tool",
    "z_tool"
  ]);
  await assert.rejects(
    async () => registry.resolveToolRun("a_tool", {
      parameters: {
        mode: "slow"
      }
    }),
    /must be one of/u
  );
  assert.throws(() => {
    registry.registerTools("bad", {
      id: "missing_runner",
      type: "command"
    });
  }, /requires a command function/u);
});

test("optional project config fields do not block readiness", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64ProjectConfigStore({
      projectLocalRoot: path.join(path.dirname(targetRoot), "state", "projects", "config-test"),
      sourceContractRoot: targetRoot,
      targetRoot
    });
    await writeFile(path.join(targetRoot, "vibe64.project.json"), `${JSON.stringify({
      schema: "vibe64.project",
      schemaVersion: 1,
      projectType: "test",
      config: {
        required_field: "saved"
      }
    }, null, 2)}\n`, "utf8");

    const config = await store.readConfig({
      fields: [
        {
          id: "required_field",
          label: "Required",
          type: "string"
        },
        {
          defaultValue: "",
          id: "optional_field",
          label: "Optional",
          required: false,
          type: "string"
        }
      ]
    });

    assert.equal(config.ready, true);
    assert.deepEqual(config.missing, []);
    assert.equal(config.fieldValues.optional_field.saved, false);
  });
});

test("defaulted required project config fields do not block readiness while empty required fields still do", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64ProjectConfigStore({
      projectLocalRoot: path.join(path.dirname(targetRoot), "state", "projects", "config-test"),
      sourceContractRoot: targetRoot,
      targetRoot
    });
    await writeFile(path.join(targetRoot, "vibe64.project.json"), `${JSON.stringify({
      schema: "vibe64.project",
      schemaVersion: 1,
      projectType: "test",
      config: {}
    }, null, 2)}\n`, "utf8");

    const config = await store.readConfig({
      fields: [
        {
          defaultValue: "mariadb",
          id: "database_runtime",
          label: "Database runtime",
          options: [
            {
              label: "None",
              value: "none"
            },
            {
              label: "MariaDB",
              value: "mariadb"
            }
          ],
          type: "select"
        },
        {
          defaultValue: "",
          id: "required_name",
          label: "Required name",
          type: "string"
        }
      ]
    });

    assert.equal(config.ready, false);
    assert.deepEqual(config.missing, ["required_name"]);
    assert.equal(config.fieldValues.database_runtime.saved, false);
    assert.equal(config.fieldValues.database_runtime.value, "mariadb");
  });
});

test("Git cache refresh is not exposed as a user-facing project tool", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });
    await service.saveProjectType({
      projectType: "jskit"
    });
    const config = await service.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });
    assert.equal(config.ok, true);

    const response = await service.listProjectTools();
    assert.equal(response.tools.some((tool) => tool.id === "sync_main_with_main"), false);

    const run = await service.prepareProjectToolRun("sync_main_with_main");
    assert.equal(run.ok, false);
    assert.equal(run.code, "vibe64_project_tool_unknown");
    assert.match(run.error, /Unknown Vibe64 project tool/u);
  });
});

test("Laravel MariaDB project tool is gated by managed database runtime", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({
      targetRoot
    });
    await service.saveProjectType({
      projectType: "laravel"
    });
    await service.saveProjectConfig({
      values: {
        [LARAVEL_DATABASE_RUNTIME_CONFIG]: "sqlite"
      }
    });

    let response = await service.listProjectTools();
    assert.equal(response.tools.some((tool) => tool.id === "connect_mariadb"), false);

    await service.saveProjectConfig({
      values: {
        [LARAVEL_DATABASE_RUNTIME_CONFIG]: "mariadb"
      }
    });
    response = await service.listProjectTools();
    const mariaDb = response.tools.find((tool) => tool.id === "connect_mariadb");
    assert.equal(mariaDb.enabled, true);
    assert.equal(mariaDb.label, "Connect to MariaDB");
  });
});

test("project tools use the selected session source config", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createServiceForTemporaryTarget(targetRoot);
    const sqliteSessionId = "sqlite-config";
    const mariaDbSessionId = "mariadb-config";
    await createSessionSourceFixture(service, sqliteSessionId);
    await createSessionSourceFixture(service, mariaDbSessionId);

    await service.saveProjectType({
      projectType: "laravel",
      sessionId: sqliteSessionId
    });
    await service.saveProjectConfig({
      sessionId: sqliteSessionId,
      values: {
        [LARAVEL_DATABASE_RUNTIME_CONFIG]: "sqlite"
      }
    });
    await service.saveProjectType({
      projectType: "laravel",
      sessionId: mariaDbSessionId
    });
    await service.saveProjectConfig({
      sessionId: mariaDbSessionId,
      values: {
        [LARAVEL_DATABASE_RUNTIME_CONFIG]: "mariadb"
      }
    });

    const sqliteTools = await service.listProjectTools({
      sessionId: sqliteSessionId
    });
    const mariaDbTools = await service.listProjectTools({
      sessionId: mariaDbSessionId
    });

    assert.equal(sqliteTools.tools.some((tool) => tool.id === "connect_mariadb"), false);
    assert.equal(mariaDbTools.tools.some((tool) => tool.id === "connect_mariadb"), true);
  });
});

test("Fix Codex jobs validate one-time report tokens", () => {
  const store = createFixCodexJobStore({
    clock: () => new Date("2026-05-27T01:02:03.000Z")
  });
  const { job, token } = store.createJob({
    scope: "project",
    subject: "Unit tool",
    targetRoot: "/workspace/project"
  });

  assert.throws(() => {
    store.reportJob(job.id, {
      status: "fixed",
      token: "wrong"
    });
  }, /token is invalid/u);

  const reported = store.reportJob(job.id, {
    message: "Fixed command.",
    status: "fixed",
    token,
    verificationSummary: "npm test passed."
  });
  assert.equal(reported.status, "fixed");
  assert.equal(reported.message, "Fixed command.");
  assert.equal(reported.verificationSummary, "npm test passed.");

  assert.throws(() => {
    store.reportJob(job.id, {
      status: "fixed",
      token
    });
  }, /already been reported/u);
});

test("Fix Codex jobs expose the resolved repair target and workdir", () => {
  const store = createFixCodexJobStore({
    clock: () => new Date("2026-05-27T01:02:03.000Z")
  });
	  const targetRoot = "/workspace/project";
	  const workdir = "/workspace/runtime/projects/project-test/sessions/active/session-1/source";
  const { job: sessionJob } = store.createJob({
    repairTarget: "session_worktree",
    scope: "session",
    subject: "Build app",
    targetRoot,
    workdir
  });
  const { job: projectJob } = store.createJob({
    repairTarget: "main_checkout",
    scope: "project",
    subject: "Deploy app",
    targetRoot,
    workdir: targetRoot
  });

  assert.equal(projectJob.repairTarget, "main_checkout");
  assert.equal(projectJob.targetRoot, targetRoot);
  assert.equal(projectJob.workdir, targetRoot);
  assert.equal(sessionJob.repairTarget, "session_worktree");
  assert.equal(sessionJob.targetRoot, targetRoot);
  assert.equal(sessionJob.workdir, workdir);

  const stored = store.readJob(sessionJob.id);
  assert.equal(stored.repairTarget, "session_worktree");
  assert.equal(stored.targetRoot, targetRoot);
  assert.equal(stored.workdir, workdir);
});

test("Fix Codex report instructions expose the mounted helper command", () => {
  const instructions = fixCodexReportInstructions({
    job: {
      id: "job-1"
    },
    token: "secret-token"
  });

  assert.match(instructions, /VIBE64_FIX_CODEX_REPORT_HELPER/u);
  assert.match(instructions, /before your final response/u);
  assert.match(instructions, /not complete until this helper command returns ok/u);
  assert.match(instructions, /"status":"fixed"/u);
  assert.match(instructions, /"jobId": "job-1"/u);
  assert.match(instructions, /"token": "secret-token"/u);
});

test("Fix Codex report helper accepts --json with stdin payload", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const stateRoot = path.join(targetRoot, "server-state");
    const store = createFixCodexJobStore({
      clock: () => new Date("2026-05-27T01:02:03.000Z")
    });
    const { job, token } = store.createJob({
      scope: "project",
      subject: "Unit tool",
      targetRoot
    });
    const helper = await prepareFixCodexReportHelper({
      fixJobStore: store,
      jobId: job.id,
      stateRoot,
      token
    });
    assert.equal(helper.env.VIBE64_FIX_CODEX_REPORT_HELPER, "/vibe64-fix-helper/vibe64-fix-codex-report.mjs");
    assert.equal(helper.env.VIBE64_FIX_CODEX_REPORT_SOCKET, "/vibe64-fix-helper/fix.sock");

    const result = await runNodeScript(helper.hostScriptPath, [
      "--json"
    ], {
      ...helper.env,
      VIBE64_FIX_CODEX_REPORT_HELPER: helper.hostScriptPath,
      VIBE64_FIX_CODEX_REPORT_SOCKET: helper.hostSocketPath
    }, JSON.stringify({
      message: "Configuration intentionally fails.",
      status: "blocked",
      verificationSummary: "No repository-owned fix available."
    }));

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const response = JSON.parse(result.stdout);
    assert.equal(response.ok, true);
    assert.equal(response.fixJob.status, "blocked");
    assert.equal(response.fixJob.message, "Configuration intentionally fails.");
  });
});

test("Fix Codex report helper uses a short socket path for deep state roots", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const stateRoot = path.join(
      targetRoot,
      "very",
      "deep",
      "target",
      "root",
      "with",
      "enough",
      "segments",
      "to",
      "exceed",
      "the",
      "unix",
      "socket",
      "path",
      "limit",
      "server-state"
    );
    const store = createFixCodexJobStore({
      clock: () => new Date("2026-05-27T01:02:03.000Z")
    });
    const { job, token } = store.createJob({
      scope: "project",
      subject: "Deep root tool",
      targetRoot
    });
    const helper = await prepareFixCodexReportHelper({
      fixJobStore: store,
      jobId: job.id,
      stateRoot,
      token
    });
    assert.equal(helper.env.VIBE64_FIX_CODEX_REPORT_HELPER, "/vibe64-fix-helper/vibe64-fix-codex-report.mjs");
    assert.equal(helper.env.VIBE64_FIX_CODEX_REPORT_SOCKET, "/vibe64-fix-helper/fix.sock");

    assert.ok(helper.hostSocketPath.length < 100, `socket path is too long: ${helper.hostSocketPath}`);

    const result = await runNodeScript(helper.hostScriptPath, [
      "--json"
    ], {
      ...helper.env,
      VIBE64_FIX_CODEX_REPORT_HELPER: helper.hostScriptPath,
      VIBE64_FIX_CODEX_REPORT_SOCKET: helper.hostSocketPath
    }, JSON.stringify({
      message: "Deep socket path works.",
      status: "fixed",
      verificationSummary: "Helper callback succeeded."
    }));

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const response = JSON.parse(result.stdout);
    assert.equal(response.ok, true);
    assert.equal(response.fixJob.status, "fixed");
    assert.equal(response.fixJob.message, "Deep socket path works.");
  });
});
