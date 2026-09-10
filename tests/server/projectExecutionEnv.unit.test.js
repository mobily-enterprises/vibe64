import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
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
    assert.equal((await service.saveEnvUserValues({ environment: "dev", values: {
      WORKERS: { value: "6", secret: false }, PRIVATE_SETTING: { value: "private-one", secret: true }
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
