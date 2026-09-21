import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { addGenesisStack, applyGenesisTemplate, initializeGenesisProject, listGenesisTemplates, setGenesisCollaboration, setGenesisEngineeringProfile } from "../../packages/vibe64-genesis/src/server/index.js";
import { sourceMetadata, sourcePath, withTemporaryRoot } from "./vibe64TestHelpers.js";

const exec = promisify(execFile);
const sessionId = "2026-09-06_10-00-00";

async function fixture(targetRoot, options = {}) {
  const templateRoot = path.join(path.dirname(targetRoot), "template");
  const root = sourcePath(targetRoot, sessionId);
  for (const cwd of [templateRoot, root]) {
    await mkdir(cwd, { recursive: true });
    await exec("git", ["init", "--quiet", "--initial-branch=public"], { cwd });
    await initializeGenesisProject({ projectRoot: cwd });
  }
  await addGenesisStack({ projectRoot: templateRoot, pieces: ["nodejs"] });
  await writeFile(path.join(templateRoot, "genesis/blueprint.md"), "# Blueprint\n\nA command line starter.\n");
  await writeFile(path.join(templateRoot, "app.js"), "console.log('ready');\n");
  await exec("git", ["add", "-A"], { cwd: templateRoot });
  await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--quiet", "-m", "Starter"], { cwd: templateRoot });
  const catalog = { schemaVersion: 1, templates: [{ id: "nodejs/public", technology: "nodejs", name: "Test", repository: templateRoot, branch: "public" }] };
  const templateSources = [{ namespace: "test", catalog }];
  const service = createService({
    env: {},
    ...options,
    projectContext: createStudioProjectContext({
      explicitManagedSourceRoot: path.join(path.dirname(targetRoot), "managed-source"),
      explicitSystemRoot: path.join(path.dirname(targetRoot), "system"),
      explicitTargetRoot: targetRoot,
      home: path.dirname(targetRoot)
    }),
    applyTemplate: (input) => applyGenesisTemplate({ ...input, templateSources }),
    listTemplates: (input) => listGenesisTemplates({ ...input, templateSources })
  });
  const store = await service.createSessionStore();
  await store.createSession({ sessionId, metadata: sourceMetadata(targetRoot, sessionId) });
  return { root, service, store, templateRoot };
}

test("an empty session offers starters and applies only the configured selection into that session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service, templateRoot } = await fixture(targetRoot);
    await setGenesisCollaboration({
      experience: "expert",
      explanationStyle: "conclusions",
      projectRoot: root,
      requirements: "- Preserve the project's existing terminology.",
      responseLength: "very_short",
      tone: "direct"
    });
    await setGenesisEngineeringProfile({ profile: "durable.v1", projectRoot: root });
    const collaboration = await readFile(path.join(root, "genesis/collaboration.md"), "utf8");
    const engineering = await readFile(path.join(root, "genesis/engineering.md"), "utf8");
    await exec("git", ["add", "-A"], { cwd: root });
    await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--quiet", "-m", "Initial context"], { cwd: root });
    const originalCommit = (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    const templateCommit = (await exec("git", ["rev-parse", "HEAD"], { cwd: templateRoot })).stdout.trim();
    const before = await service.readOnboarding({ sessionId });
    assert.equal(before.ok, true);
    assert.equal(before.inspection.state, "new");
    const choice = before.templates.find(({ id }) => id === "test:nodejs/public");
    assert.ok(choice, "the applied template must be offered by this installation's catalogue");
    const result = await service.applyTemplate({ sessionId, templateId: choice.id, repository: "/untrusted-browser-input", branch: "wrong" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal((await service.readOnboarding({ sessionId })).inspection.state, "ready");
    assert.equal(result.application.template.id, choice.id);
    assert.deepEqual(result.application.source, { repository: templateRoot, branch: "public", revision: templateCommit });
    assert.equal(await readFile(path.join(root, "genesis/collaboration.md"), "utf8"), collaboration);
    assert.equal(await readFile(path.join(root, "genesis/engineering.md"), "utf8"), engineering);
    assert.equal((await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(), originalCommit);
    assert.equal(await readFile(path.join(root, "app.js"), "utf8"), "console.log('ready');\n");
    await assert.rejects(readFile(path.join(targetRoot, "app.js")), { code: "ENOENT" });
    assert.equal((await service.applyTemplate({ sessionId, templateId: "test:nodejs/public" })).ok, false);
  });
});

test("onboarding preserves described, incomplete and incompatible Genesis sources", async (t) => {
  for (const scenario of [
    { name: "described", state: "ready", format: "current", action: "work" },
    { name: "missing intent", state: "adoption", format: "current", action: "adopt" },
    { name: "unversioned", state: "attention", format: "unversioned", action: "migrate", diagnostic: "PROJECT_FORMAT_UNVERSIONED" },
    { name: "outdated", state: "attention", format: "outdated", action: "migrate", diagnostic: "PROJECT_FORMAT_OUTDATED" },
    { name: "newer", state: "attention", format: "newer", action: "update-genesis", diagnostic: "PROJECT_FORMAT_NEWER" },
    { name: "invalid version", state: "attention", format: "invalid", action: "repair", diagnostic: "PROJECT_FORMAT_INVALID" },
    { name: "invalid Stack", state: "attention", format: "current", action: "repair" }
  ]) {
    await t.test(scenario.name, async () => {
      await withTemporaryRoot(async (targetRoot) => {
        const { root, service } = await fixture(targetRoot);
        await addGenesisStack({ projectRoot: root, pieces: ["nodejs"] });
        await writeFile(path.join(root, "application.js"), "console.log('existing application');\n");
        await writeFile(path.join(root, "genesis/blueprint.md"), scenario.name === "missing intent"
          ? "# Blueprint\n"
          : "# Blueprint\n\nA command-line application for inspecting invoices.\n");
        const versionPath = path.join(root, "genesis/version");
        const version = Number(await readFile(versionPath, "utf8"));
        if (scenario.name === "unversioned") await unlink(versionPath);
        if (scenario.name === "outdated") await writeFile(versionPath, `${version - 1}\n`);
        if (scenario.name === "newer") await writeFile(versionPath, `${version + 1}\n`);
        if (scenario.name === "invalid version") await writeFile(versionPath, "not a version\n");
        if (scenario.name === "invalid Stack") await writeFile(path.join(root, "genesis/stack.md"), "# Stack\n\n## Components\n\n- `not-a-real-technology`\n");
        await exec("git", ["add", "-A"], { cwd: root });
        await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--quiet", "-m", "Existing application"], { cwd: root });
        const originalCommit = (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();

        const opening = await service.readOnboarding({ sessionId });
        assert.equal(opening.ok, true, JSON.stringify(opening));
        assert.equal(opening.inspection.state, scenario.state);
        assert.equal(opening.inspection.projectFormat.status, scenario.format);
        assert.equal(opening.inspection.nextAction, scenario.action);
        assert.equal(opening.inspection.templateEligible, false);
        assert.deepEqual(opening.templates, []);
        if (scenario.diagnostic) assert.equal(opening.inspection.diagnostics[0].code, scenario.diagnostic);
        if (scenario.state === "attention") assert.ok(opening.inspection.diagnostics.length > 0);
        else assert.deepEqual(opening.inspection.diagnostics, []);
        const rejected = await service.applyTemplate({ sessionId, templateId: "test:nodejs/public" });
        assert.equal(rejected.ok, false);
        assert.equal(rejected.code, "TEMPLATE_PROJECT_NOT_EMPTY");
        assert.equal((await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(), originalCommit);
        assert.equal((await exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root })).stdout, "");
      });
    });
  }
});

test("existing source is adoption and a stale template request preserves it", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service } = await fixture(targetRoot);
    await writeFile(path.join(root, "application.unknown"), "mature implementation");
    const opening = await service.readOnboarding({ sessionId });
    assert.equal(opening.inspection.state, "adoption");
    assert.deepEqual(opening.templates, []);
    const result = await service.applyTemplate({ sessionId, templateId: "test:nodejs/public" });
    assert.equal(result.ok, false);
    assert.equal(await readFile(path.join(root, "application.unknown"), "utf8"), "mature implementation");
    await assert.rejects(readFile(path.join(root, "app.js")), { code: "ENOENT" });
  });
});

test("template application requires an explicit open session and shares the agent write lock", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service, store } = await fixture(targetRoot);
    assert.equal((await service.applyTemplate({ templateId: "test:nodejs/public" })).ok, false);
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const ready = new Promise((resolve) => { entered = resolve; });
    const holding = store.runSessionExclusive(sessionId, "agent-write-mode", async () => {
      entered();
      await gate;
    });
    await ready;
    try {
      const result = await service.applyTemplate({ sessionId, templateId: "test:nodejs/public" });
      assert.equal(result.ok, false);
      assert.equal(result.code, "vibe64_agent_write_mode_busy");
      await assert.rejects(readFile(path.join(root, "app.js")), { code: "ENOENT" });
    } finally {
      release();
      await holding;
    }
  });
});

test("starter selection waits for brief assistant preparation under the existing source lock", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const release = Promise.withResolvers();
    const entered = Promise.withResolvers();
    const events = [];
    const { service, store } = await fixture(targetRoot, {
      logger: {
        warn(event) {
          if (event.operation === "apply-project-template") {
            events.push(event);
            release.resolve();
          }
        }
      }
    });
    const holding = store.runSessionExclusive(sessionId, "agent-write-mode", async () => {
      entered.resolve();
      await release.promise;
    }, { operation: "prepare-agent-session" });
    await entered.promise;
    try {
      const result = await service.applyTemplate({ sessionId, templateId: "test:nodejs/public" });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.application.status, "applied");
      assert.equal(events[0].event, "vibe64.session_lock.contended");
      assert.equal(events[0].owner.operation, "prepare-agent-session");
    } finally {
      release.resolve();
      await holding;
    }
  });
});

test("project environment setup does not require outputs and clears after Env is saved", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service } = await fixture(targetRoot, {
      inspectEnvironment: () => ({
        components: [],
        environmentDefaults: [],
        files: [],
        resources: [{
          component: "example",
          resource: {
            id: "storage",
            kind: "object-storage",
            environmentAlternatives: [
              { preferred: true, bindings: { token: "STORAGE_TOKEN", region: "STORAGE_REGION" }, allowEmpty: ["region"] },
              { bindings: { url: "STORAGE_URL" } }
            ]
          }
        }]
      })
    });
    await writeFile(path.join(root, "genesis/blueprint.md"), "# Blueprint\n\nAn archive of research documents.\n");
    await writeFile(path.join(root, "research.md"), "# Research archive\n");
    await writeFile(path.join(root, "genesis/stack.md"), "# Stack\n\n## Components\n\n- `nodejs`\n");
    const initial = await service.readOnboarding({ sessionId });
    assert.equal(initial.inspection.state, "ready");
    assert.deepEqual(initial.environmentSetup.missingKeys, ["STORAGE_TOKEN", "STORAGE_REGION"]);
    const saved = await service.saveEnvUserValues({ values: {
      STORAGE_TOKEN: { value: "private-token", secret: true },
      STORAGE_REGION: ""
    } });
    assert.equal(saved.ok, true);
    const configured = await service.readOnboarding({ sessionId });
    assert.deepEqual(configured.environmentSetup.missingKeys, []);
    assert.equal(JSON.stringify(configured).includes("private-token"), false);
    const savedAlternative = await service.saveEnvUserValues({ values: {
      STORAGE_TOKEN: "",
      STORAGE_URL: { value: "private-url", secret: true }
    } });
    assert.equal(savedAlternative.ok, true);
    const alternative = await service.readOnboarding({ sessionId });
    assert.deepEqual(alternative.environmentSetup.missingKeys, []);
    assert.equal(JSON.stringify(alternative).includes("private-url"), false);
    service.setResourceEnvironmentProvider({
      managedDevelopmentDatabase: true,
      environmentForProvisionedResources: () => ({
        contract: "vibe64.resource-environment.v2", ok: true, prepared: true,
        resourceValues: [{
          declaration: { component: "example", id: "storage", kind: "object-storage" },
          values: { token: "host-private-token", region: "host-region" }
        }]
      }),
      environmentForResources() { assert.fail("Reading onboarding must never provision resources."); }
    });
    await service.saveEnvUserValues({ values: { STORAGE_URL: "" } });
    const hosted = await service.readOnboarding({ sessionId });
    assert.equal(hosted.ok, true, JSON.stringify(hosted));
    assert.deepEqual(hosted.environmentSetup.missingKeys, []);
    assert.equal(JSON.stringify(hosted).includes("host-private-token"), false);
  });
});

test("a fresh managed starter remains readable before database preparation and execution still provisions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const resource = {
      component: "application",
      resource: {
        id: "database",
        kind: "mysql",
        environmentAlternatives: [{
          preferred: true,
          bindings: { database: "DB_NAME", host: "DB_HOST", password: "DB_PASSWORD", port: "DB_PORT", username: "DB_USER" }
        }]
      }
    };
    const { root, service } = await fixture(targetRoot, {
      inspectEnvironment: () => ({ components: [], environmentDefaults: [], files: [], resources: [resource] })
    });
    const pending = { contract: "vibe64.resource-environment.v2", prepared: false, resourceValues: [], ok: true };
    let provisionCalls = 0;
    let inspectionCalls = 0;
    let inspectionError = new Error("Stored database service metadata could not be read.");
    service.setResourceEnvironmentProvider({
      managedDevelopmentDatabase: true,
      environmentForProvisionedResources() {
        inspectionCalls += 1;
        if (inspectionError) throw inspectionError;
        return pending;
      },
      environmentForResources() {
        provisionCalls += 1;
        return pending;
      }
    });
    const applied = await service.applyTemplate({ sessionId, templateId: "test:nodejs/public" });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.application.status, "applied");
    assert.equal(inspectionCalls, 0, "a successful source import must not depend on a later environment read");
    const failedInspection = await service.readOnboarding({ sessionId });
    assert.equal(failedInspection.ok, false);
    assert.match(failedInspection.error, /Stored database service metadata/);
    inspectionError = null;
    const inspected = await service.readOnboarding({ sessionId });
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    assert.equal(inspected.inspection.state, "ready");
    assert.deepEqual(inspected.templates, []);
    assert.deepEqual(inspected.environmentSetup.missingKeys, []);
    assert.deepEqual(await service.projectInspectionEnvironment({ sessionId }), {});
    assert.equal((await service.readEnv({ sessionId })).ok, true);
    assert.equal(provisionCalls, 0);
    await assert.rejects(readFile(path.join(root, ".env")), { code: "ENOENT" });
    await assert.rejects(service.projectExecutionEnvironment({ sessionId, reusePrepared: true }), {
      code: "vibe64_managed_database_resource_missing"
    });
    assert.equal(provisionCalls, 1, "an unprepared inspection must still enter normal execution preparation");
  });
});
