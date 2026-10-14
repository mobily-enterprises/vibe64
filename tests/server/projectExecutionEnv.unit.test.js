import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createCodexSessionEnvironment } from "../../packages/vibe64-terminals/src/server/codexSessionEnvironment.js";
import { readSessionConversationContext } from "../../packages/vibe64-terminals/src/server/mainConversationBinding.js";
import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { sourceMetadata, sourcePath, withTemporaryRoot } from "./vibe64TestHelpers.js";

import {
  executionEnvFingerprint,
  loadProjectExecutionEnv,
  loadProjectExecutionEnvRecords,
  normalizeExecutionEnvRecord,
  projectExecutionEnvFromRecords
} from "../../packages/vibe64-terminals/src/server/projectExecutionEnv.js";

test("environment reads use inspection without preparing project resources", async () => {
  let request = null;
  const env = await loadProjectExecutionEnv({
    projectService: {
      async projectExecutionEnvironment() {
        assert.fail("Reading environment must not provision resources or write files.");
      },
      async projectInspectionEnvironment(input) {
        request = input;
        return {
          DB_PORT: 3306,
          EMPTY: null,
          NAME: "catalog"
        };
      }
    },
    session: {
      sessionId: "session-1"
    },
    target: "codex"
  });

  assert.deepEqual(request, {
    sessionId: "session-1",
    session: {
      sessionId: "session-1"
    },
    target: "codex"
  });
  assert.deepEqual(env, {
    DB_PORT: "3306",
    EMPTY: "",
    NAME: "catalog"
  });
});

test("execution startup explicitly prepares the project environment", async () => {
  const env = await loadProjectExecutionEnv({
    prepare: true,
    projectService: {
      async projectInspectionEnvironment() {
        assert.fail("Startup must prepare its environment.");
      },
      async projectExecutionEnvironment(input) {
        assert.equal(input.sessionId, "session-1");
        return { READY: "yes" };
      }
    },
    session: { sessionId: "session-1" }
  });
  assert.deepEqual(env, { READY: "yes" });
});

test("Codex message preparation reuses only current resources and Env files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let ready = false;
    let provisions = 0;
    let password = "first-secret";
    let failure;
    const service = createService({
      env: {},
      projectContext: createStudioProjectContext({ explicitTargetRoot: targetRoot, home: path.dirname(targetRoot) }),
      inspectEnvironment: () => ({ components: [], environmentDefaults: [], files: [{ format: "dotenv", path: ".env" }],
        resources: [{ component: "jskit-mysql", resource: { id: "database", kind: "mysql",
          environmentAlternatives: [{ preferred: true, bindings: { host: "DB_HOST", port: "DB_PORT",
            database: "DB_DATABASE", username: "DB_USER", password: "DB_PASSWORD" } }] } }] })
    });
    const resourceEnvironment = () => {
      const writer = { host: "127.0.0.1", port: 3306, database: "chat", username: "writer", password };
      return { contract: "vibe64.resource-environment.v2", ok: true, prepared: ready,
        databaseToolEnvironment: { contract: "vibe64.database-tool-environment.v1", kind: "mysql",
          write: writer, read: { ...writer, username: "reader", password: "reader-secret" } },
        resourceValues: [{ declaration: { component: "jskit-mysql", id: "database", kind: "mysql" }, values: writer }] };
    };
    service.setResourceEnvironmentProvider({
      environmentForProvisionedResources: resourceEnvironment,
      environmentForResources() {
        provisions += 1;
        if (failure) throw failure;
        ready = true;
        return resourceEnvironment();
      }
    });
    const runtime = await service.createRuntime({ inspectSource: true });
    const sessionId = "codex-environment";
    await mkdir(path.join(sourcePath(targetRoot, sessionId), ".git", "info"), { recursive: true });
    await runtime.store.createSession({ sessionId, runtimeKind: "genesis", metadata: sourceMetadata(targetRoot, sessionId) });
    const session = await runtime.getSession(sessionId, { inspectSource: false });
    runtime.inspectSourceForSession = async () => assert.fail("Send does not need a Git conflict scan.");
    const environment = createCodexSessionEnvironment({ env: {}, projectService: service });
    const sendEnvironment = () => environment.codexProjectTerminalEnv({ runtime, session, sessionId });
    const envPath = path.join(session.sourcePath, ".env");

    assert.equal((await sendEnvironment()).DB_PASSWORD, password);
    assert.equal(provisions, 1, "A missing environment is still prepared.");
    assert.equal((await sendEnvironment()).DB_PASSWORD, password);
    assert.equal(provisions, 1, "A second send does not provision the same resources again.");
    await rm(envPath);
    await sendEnvironment();
    assert.equal(provisions, 2, "A missing Env file falls back to preparation.");
    password = "rotated-secret";
    assert.equal((await sendEnvironment()).DB_PASSWORD, password);
    assert.equal(provisions, 3, "Changed values refresh the Env file.");
    assert.match(await readFile(envPath, "utf8"), /DB_PASSWORD=rotated-secret/u);
    ready = false;
    failure = new Error("Resource preparation unavailable");
    await assert.rejects(sendEnvironment(), /Resource preparation unavailable/u);
    assert.equal(provisions, 4, "A failed readiness check cannot reuse stale resources.");

    await runtime.store.writeMetadataValue(sessionId, "source_removed", "yes");
    await assert.rejects(sendEnvironment(), { code: "vibe64_session_worktree_unavailable" });
    assert.equal(provisions, 4, "The startup gate reads current metadata even with an old supplied session.");
  });
});

test("Codex context avoids source inspection while retaining workspace and account checks", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = createService({ env: {},
      projectContext: createStudioProjectContext({ explicitTargetRoot: targetRoot, home: path.dirname(targetRoot) }) });
    const runtime = await service.createRuntime({ inspectSource: true });
    const sessionId = "codex-context";
    const workdir = sourcePath(targetRoot, sessionId);
    await mkdir(workdir, { recursive: true });
    await runtime.store.createSession({ sessionId, runtimeKind: "genesis", metadata: sourceMetadata(targetRoot, sessionId) });
    let inspections = 0;
    runtime.inspectSourceForSession = async () => { inspections += 1; return null; };
    let accounts = 0;
    const host = { toolHome: async () => { accounts += 1; return { ok: true, toolHomeSource: "/authorized/account" }; },
      unavailableWorktree: async (_runtime, _id, failure) => failure };
    const context = () => readSessionConversationContext("codex", service, sessionId, { runtime }, host);
    assert.equal((await context()).workdir, workdir);
    assert.equal(inspections, 0, "Context does not consume source inspection.");
    assert.equal(accounts, 1);
    await rm(workdir, { recursive: true });
    assert.equal((await context()).code, "vibe64_session_worktree_unavailable");
    assert.equal(accounts, 1, "A missing workspace is refused before account acquisition.");
    await mkdir(workdir, { recursive: true });
    await runtime.markSessionClosing(sessionId, { reason: "archived" });
    inspections = 0;
    assert.equal((await context()).code, "vibe64_session_closing");
    assert.equal(inspections, 0);
    assert.equal(accounts, 1);
  });
});

test("project execution environment is empty when the project declares none", async () => {
  assert.deepEqual(await loadProjectExecutionEnv({}), {});
  assert.deepEqual(await loadProjectExecutionEnvRecords({}), {
    runtimeConfigEnv: {}
  });
});

test("execution environment normalization keeps only named scalar entries", () => {
  assert.deepEqual(normalizeExecutionEnvRecord({
    "": "ignored",
    COUNT: 2,
    NULL: null,
    VALUE: "yes"
  }), {
    COUNT: "2",
    NULL: "",
    VALUE: "yes"
  });
  assert.deepEqual(normalizeExecutionEnvRecord(null), {});
  assert.deepEqual(projectExecutionEnvFromRecords({
    runtimeConfigEnv: {
      VALUE: "yes"
    }
  }), {
    VALUE: "yes"
  });
});

test("execution environment fingerprints are order-independent", () => {
  const first = executionEnvFingerprint({
    A: "1",
    B: "2"
  });
  assert.equal(first, executionEnvFingerprint({
    B: "2",
    A: "1"
  }));
  assert.notEqual(first, executionEnvFingerprint({
    A: "1",
    B: "3"
  }));
});

test("resource configuration follows resolved application settings without secrets or a second inspection", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let inspections = 0;
    await mkdir(path.join(targetRoot, ".git", "info"), { recursive: true });
    let failure = null;
    let defaults = [{ name: "WORKERS", value: "2" }, { name: "AUTH_SECRET", value: "default-secret" }];
    const service = createService({
      env: { UNRELATED_HOST_SETTING: "not-project-configuration" },
      projectContext: createStudioProjectContext({ explicitTargetRoot: targetRoot, home: path.dirname(targetRoot) }),
      inspectEnvironment() {
        inspections += 1;
        if (failure) throw failure;
        return { components: [], environmentDefaults: defaults, resources: [], files: [{ format: "dotenv", path: ".env" }] };
      }
    });
    const input = { includeResourceConfiguration: true, projectService: service, target: "output-target" };
    const first = await loadProjectExecutionEnvRecords(input);
    assert.equal(inspections, 1);
    assert.deepEqual(first.runtimeConfigEnv, { WORKERS: "2", AUTH_SECRET: "default-secret" });
    assert.match(first.resourceConfigurationFingerprint, /^[a-f0-9]{64}$/u);
    defaults = [{ name: "AUTH_SECRET", value: "rotated-default-secret" }, { name: "WORKERS", value: "2" }];
    assert.equal((await loadProjectExecutionEnvRecords(input)).resourceConfigurationFingerprint, first.resourceConfigurationFingerprint);
    defaults[1].value = "4";
    const moreWorkers = await loadProjectExecutionEnvRecords(input);
    assert.notEqual(moreWorkers.resourceConfigurationFingerprint, first.resourceConfigurationFingerprint);
    const saved = await service.saveEnvUserValues({ environment: "dev", values: {
      WORKERS: { value: "6", secret: false }
    } });
    assert.equal(saved.ok, true);
    const savedOverride = await loadProjectExecutionEnvRecords(input);
    assert.equal(savedOverride.runtimeConfigEnv.WORKERS, "6");
    assert.notEqual(savedOverride.resourceConfigurationFingerprint, moreWorkers.resourceConfigurationFingerprint);
    assert.equal((await service.saveEnvUserValues({ environment: "dev", values: {
      PRIVATE_SETTING: { value: "private-one", secret: true }
    } })).ok, true);
    const overridden = await loadProjectExecutionEnvRecords(input);
    assert.notEqual(overridden.resourceConfigurationFingerprint, moreWorkers.resourceConfigurationFingerprint);
    assert.equal(overridden.runtimeConfigEnv.WORKERS, "6");
    assert.equal(overridden.runtimeConfigEnv.PRIVATE_SETTING, "private-one");
    defaults[1].value = "8";
    assert.equal((await service.saveEnvUserValues({ environment: "dev", values: {
      PRIVATE_SETTING: { value: "private-two", secret: true }
    } })).ok, true);
    assert.equal((await service.saveEnvUserValues({ environment: "prod", values: {
      WORKERS: { value: "100", secret: false }
    } })).ok, true);
    assert.equal((await loadProjectExecutionEnvRecords(input)).resourceConfigurationFingerprint, overridden.resourceConfigurationFingerprint);
    const beforePrepare = inspections;
    const prepared = await loadProjectExecutionEnvRecords({ ...input, prepare: true });
    assert.equal(inspections, beforePrepare + 1);
    assert.equal(prepared.resourceConfigurationFingerprint, overridden.resourceConfigurationFingerprint);
    assert.equal(prepared.runtimeConfigEnv.PRIVATE_SETTING, "private-two");
    assert.match(await readFile(path.join(targetRoot, ".env"), "utf8"), /WORKERS=6/u);
    failure = new Error("private-inspection-diagnostic");
    const incomplete = await loadProjectExecutionEnvRecords(input);
    assert.equal(incomplete.resourceConfigurationFingerprint, null);
    assert.equal(incomplete.runtimeConfigEnv.WORKERS, "6");
    assert.equal(JSON.stringify(incomplete).includes("private-inspection-diagnostic"), false);
    failure = Object.assign(new Error("not configured"), { code: "STACK_REQUIRED" });
    assert.match((await loadProjectExecutionEnvRecords(input)).resourceConfigurationFingerprint, /^[a-f0-9]{64}$/u);
  });
});

test("managed session credentials preserve resource configuration identity, but changed resource bindings do not", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let databaseBinding = "DB_DATABASE";
    let inspections = 0;
    let provisions = 0;
    const service = createService({
      env: {},
      projectContext: createStudioProjectContext({
        explicitManagedSourceRoot: path.join(path.dirname(targetRoot), "managed-source"),
        explicitSystemRoot: path.join(path.dirname(targetRoot), "system"),
        explicitTargetRoot: targetRoot, home: path.dirname(targetRoot)
      }),
      inspectEnvironment() {
        inspections += 1;
        return {
          components: [], environmentDefaults: [{ name: "WORKERS", value: "2" }], files: [], resources: [{
            component: "jskit-mysql", resource: {
              id: "database", kind: "mysql",
              environmentAlternatives: [{ preferred: true, bindings: {
                host: "DB_HOST", port: "DB_PORT", database: databaseBinding, username: "DB_USER", password: "DB_PASSWORD"
              } }]
            }
          }]
        };
      }
    });
    service.setResourceEnvironmentProvider({
      managedDevelopmentDatabase: true,
      environmentForProvisionedResources({ sessionId }) {
        const writer = {
          host: "127.0.0.1", port: 3306, database: sessionId,
          username: `writer_${sessionId}`, password: `private-${sessionId}`
        };
        return {
          contract: "vibe64.resource-environment.v2", ok: true, prepared: true,
          databaseToolEnvironment: {
            contract: "vibe64.database-tool-environment.v1", kind: "mysql", write: writer,
            read: { ...writer, username: `reader_${sessionId}`, password: `read-${sessionId}` }
          },
          resourceValues: [{
            declaration: { component: "jskit-mysql", id: "database", kind: "mysql" },
            values: writer
          }]
        };
      },
      environmentForResources() { provisions += 1; assert.fail("Identity reads cannot provision resources."); }
    });
    const store = await service.createSessionStore();
    for (const sessionId of ["one", "two"]) {
      await mkdir(sourcePath(targetRoot, sessionId), { recursive: true });
      await store.createSession({ sessionId, runtimeKind: "genesis", metadata: sourceMetadata(targetRoot, sessionId) });
    }
    const input = { projectService: service, includeResourceConfiguration: true, target: "output-target" };
    const one = await loadProjectExecutionEnvRecords({ ...input, session: { sessionId: "one", metadata: sourceMetadata(targetRoot, "one") } });
    const two = await loadProjectExecutionEnvRecords({ ...input, session: { sessionId: "two", metadata: sourceMetadata(targetRoot, "two") } });
    assert.equal(inspections, 2);
    assert.equal(provisions, 0);
    assert.notEqual(one.runtimeConfigEnv.DB_DATABASE, two.runtimeConfigEnv.DB_DATABASE);
    assert.notEqual(one.runtimeConfigEnv.DB_USER, two.runtimeConfigEnv.DB_USER);
    assert.notEqual(one.runtimeConfigEnv.DB_PASSWORD, two.runtimeConfigEnv.DB_PASSWORD);
    assert.equal(one.resourceConfigurationFingerprint, two.resourceConfigurationFingerprint);
    databaseBinding = "RENAMED_DATABASE";
    const renamed = await loadProjectExecutionEnvRecords({ ...input, session: { sessionId: "two", metadata: sourceMetadata(targetRoot, "two") } });
    assert.notEqual(renamed.resourceConfigurationFingerprint, two.resourceConfigurationFingerprint);
    const reused = await service.projectExecutionEnvironment({ sessionId: "two", reusePrepared: true, includeResourceConfiguration: true });
    assert.equal(reused.resourceConfigurationFingerprint, renamed.resourceConfigurationFingerprint);
    assert.equal(provisions, 0);
  });
});

test("resource configuration is explicitly unavailable without an environment resolver", async () => {
  assert.deepEqual(await loadProjectExecutionEnvRecords({ includeResourceConfiguration: true }), {
    runtimeConfigEnv: {}, resourceConfigurationFingerprint: null
  });
});
