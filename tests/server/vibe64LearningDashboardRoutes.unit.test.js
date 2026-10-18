import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { registerRoutes as registerSessionRoutes } from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { registerRoutes as registerProjectRoutes } from "../../packages/vibe64-project/src/server/registerRoutes.js";
import { createProjectActions } from "../../packages/vibe64-project/src/server/actions.js";
import { registerRoutes as registerSourceEditorRoutes } from "../../packages/vibe64-source-editor/src/server/registerRoutes.js";
import { createSourceEditorActions } from "../../packages/vibe64-source-editor/src/server/actions.js";
import { registerRoutes as registerDatabaseRoutes } from "../../packages/vibe64-database-tools/src/server/registerRoutes.js";
import { createDatabaseActions } from "../../packages/vibe64-database-tools/src/server/actions.js";
import { registerRoutes as registerSystemGraphRoutes } from "../../packages/vibe64-system-graph/src/server/registerRoutes.js";
import { createSystemGraphActions } from "../../packages/vibe64-system-graph/src/server/actions.js";
import { registerTrainingCodeEditorRoutes, TRAINING_CODE_FILE_SAVE_ACTION } from "../../packages/vibe64-training/src/server/codeEditorActions.js";
import { testReply, testRouteApp, withLocalRequestBypass } from "./vibe64RouteTestHelpers.js";

const attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LESSON_BASE = "/api/learning/:learningAttemptId/vibe64";

function definitions() {
  return [
    ...createSessionActions({ sessions: {} }), ...createProjectActions({ project: {} }),
    ...createSourceEditorActions({ sourceEditor: {} }), ...createDatabaseActions({ databaseTools: {} }),
    ...createSystemGraphActions({ systemGraph: {} })
  ];
}

function lessonApp() {
  const app = testRouteApp();
  registerSessionRoutes(app.http, { learningScoped: true, routeSurface: "app" });
  registerProjectRoutes(app.http, { learningScoped: true, routeSurface: "app" });
  registerSourceEditorRoutes(app.http, { learningScoped: true, routeSurface: "app" });
  registerDatabaseRoutes(app.http, { learningScoped: true, routeSurface: "app" });
  registerSystemGraphRoutes(app.http, { learningScoped: true, routeSurface: "app" });
  registerTrainingCodeEditorRoutes(app.http);
  return app;
}

async function dispatchAll(app) {
  const reached = new Map();
  await withLocalRequestBypass(async () => {
    for (const route of app.registeredRoutes) {
      assert.equal(route.path.startsWith(`${LESSON_BASE}/`), true, route.path);
      const calls = [];
      const params = { learningAttemptId: attemptId, sessionId: `training-${attemptId}`, commit: "a".repeat(40),
        queryId: "query-1", snippetId: "snippet-1" };
      const browser = { vibe64User: { uid: "browser" }, projectSlug: "working-project", learningAttemptId: "browser-attempt" };
      await route.handler({ params, query: { ...browser }, body: { ...browser }, input: { query: { ...browser }, body: { ...browser } },
        executeAction(call) { calls.push(call); return { ok: false, error: "fixture" }; } }, testReply());
      assert.equal(calls.length, 1, `${route.method} ${route.path}`);
      const { input } = calls[0];
      assert.equal(input.learningAttemptId, attemptId, route.path);
      assert.equal(Object.hasOwn(input, "vibe64User"), false, route.path);
      assert.equal(Object.hasOwn(input, "projectSlug"), false, route.path);
      reached.set(`${route.method} ${route.path.slice(LESSON_BASE.length)}`, calls[0].actionId);
    }
  });
  return reached;
}

test("lesson Dashboard URLs exist only for declared actions and carry only URL identity", async () => {
  const app = lessonApp();
  const reached = await dispatchAll(app);
  const declared = new Map(definitions().map(action => [action.id, action.extensions.vibe64.learningAccess]));
  for (const [route, actionId] of reached) {
    if (actionId === TRAINING_CODE_FILE_SAVE_ACTION) continue;
    assert.ok(declared.get(actionId), `${route} reaches undeclared ${actionId}`);
  }
  const ids = new Set(reached.values());
  for (const id of ["vibe64.repository.history.inspect", "vibe64.repository.history.files.inspect",
    "vibe64.repository.history.diff.inspect", "vibe64.sessions.changes.inspect", "vibe64.sessions.changes.diff.inspect",
    "vibe64.sessions.archived.list", "vibe64.sessions.inspect", "vibe64.project.env.read", "vibe64.project.env.user-values.save",
    "vibe64.system-graph.status.read", "vibe64.system-graph.architecture.read", "vibe64.system-graph.subsystems.read",
    "vibe64.system-graph.machine.read", "vibe64.system-graph.program.read", "vibe64.system-graph.refresh",
    "vibe64.system-graph.refresh.status", "vibe64.system-graph.refresh.cancel", "vibe64.database.query.run",
    "vibe64.source-editor.file.read"]) assert.equal(ids.has(id), true, `Dashboard lesson route for ${id}`);
  // Reach outside the practice project, settings writes, saving and deletion stay off lesson URLs.
  for (const id of ["vibe64.project.repository.remote", "vibe64.project.repository.remote.read",
    "vibe64.project.repository.workflow.save", "vibe64.project.settings.read", "vibe64.project.collaboration.save",
    "vibe64.project.connections.save", "vibe64.project.env.secret.reveal", "vibe64.project.projects.create",
    "vibe64.project.templates.apply", "vibe64.project.issues.create", "vibe64.project.pull-requests.merge",
    "vibe64.sessions.pull-request.create", "vibe64.sessions.work.save", "vibe64.sessions.updates.apply",
    "vibe64.sessions.updates.check", "vibe64.sessions.archive", "vibe64.sessions.pin",
    "vibe64.repository.incoming.change", "vibe64.source-editor.file.save", "vibe64.source-editor.file-area.delete",
    "vibe64.source-editor.explanation.create", "vibe64.database.assistant.ask"]) {
    assert.equal(ids.has(id), false, `${id} must have no lesson URL`);
  }
  // Saving a lesson file stays Training's ledgered action, never the generic save.
  assert.equal(reached.get("PUT /sessions/:sessionId/source-editor/file"), TRAINING_CODE_FILE_SAVE_ACTION);
  assert.deepEqual([...reached].filter(([route]) => route.startsWith("PUT ") && route.includes("source-editor")),
    [["PUT /sessions/:sessionId/source-editor/file", TRAINING_CODE_FILE_SAVE_ACTION]]);
});

test("lesson Dashboard actions declare their access and an outward action has no lesson route", () => {
  const access = Object.fromEntries(definitions().filter(action => action.extensions.vibe64.learningAccess)
    .map(action => [action.id, action.extensions.vibe64.learningAccess]));
  assert.deepEqual(Object.fromEntries(Object.entries(access).filter(([id]) =>
    /^vibe64\.(repository\.history|sessions\.changes|project\.env|system-graph)/u.test(id))), {
    "vibe64.repository.history.inspect": "observe", "vibe64.repository.history.files.inspect": "observe",
    "vibe64.repository.history.diff.inspect": "observe", "vibe64.sessions.changes.inspect": "observe",
    "vibe64.sessions.changes.diff.inspect": "observe", "vibe64.project.env.read": "observe",
    "vibe64.project.env.user-values.save": "write", "vibe64.system-graph.subsystems.read": "observe",
    "vibe64.system-graph.status.read": "observe", "vibe64.system-graph.machine.read": "observe",
    "vibe64.system-graph.program.read": "observe", "vibe64.system-graph.architecture.read": "observe",
    "vibe64.system-graph.refresh.cancel": "control", "vibe64.system-graph.refresh.status": "observe",
    "vibe64.system-graph.refresh": "write"
  });
  const app = lessonApp();
  assert.equal(app.registeredRoutes.some(route => /repository\/remote|pull-request|\/work\b|\/updates|\/settings|env\/reveal|\/issues|\/archive$/u
    .test(route.path)), false);
});

function admissionFixture({ user, resolve }) {
  const calls = { service: 0, resolutions: [] };
  const fakeProject = new Proxy({}, { get: () => async () => { calls.service += 1; return { ok: true }; } });
  const actions = createActionCatalogue();
  actions.register({ contributorId: "dashboard-lesson-test", domain: "vibe64-project",
    actions: createProjectActions({ project: fakeProject }).filter(action => action.id === "vibe64.project.env.read")
      .map(action => ({ ...action, channels: ["internal"], surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, {
    resolveUser: async () => user,
    authorizeProject() { throw new Error("A lesson Dashboard read cannot authorize a substitute Working project."); },
    async resolveLearningContext(input) { calls.resolutions.push(input); return resolve(input); }
  });
  const execute = (input) => actions.execute({ actionId: "vibe64.project.env.read",
    input: { environment: "dev", sessionId: `training-${attemptId}`, learningAttemptId: attemptId, ...input },
    context: { channel: "internal", surface: "app" } });
  return { calls, execute };
}

test("another account or attempt cannot reach the practice Dashboard, and a source-less lesson has none", async () => {
  const owner = { learningScope: { learnerId: "42", attemptId, pin: { lesson: { code: "L1" } }, noExercise: false } };
  const foreign = admissionFixture({ user: { uid: 43, username: "other", role: "member" }, resolve: () => owner });
  await assert.rejects(foreign.execute(), { code: "vibe64_learning_scope_mismatch" });
  assert.equal(foreign.calls.service, 0);

  const missing = admissionFixture({ user: { uid: 42, username: "learner", role: "member" }, resolve: ({ attemptId: requested }) => {
    if (requested !== attemptId) throw Object.assign(new Error("No such attempt"), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
    return owner;
  } });
  await assert.rejects(missing.execute({ learningAttemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), { code: "VIBE64_TRAINING_ATTEMPT_MISSING" });
  assert.equal(missing.calls.service, 0);
  assert.equal(missing.calls.resolutions[0].access, "observe");

  // The practice gate must refuse a lesson without a project instead of
  // reading whatever project the process would otherwise select.
  const sourceLess = admissionFixture({ user: { uid: 42, username: "learner", role: "member" }, resolve: () => ({
    projectRuntimeRoot: "/private/learning/attempt", learningScope: { ...owner.learningScope, noExercise: true } }) });
  await assert.rejects(sourceLess.execute(), { code: "vibe64_learning_source_required" });
  assert.equal(sourceLess.calls.service, 0);
  assert.equal(currentProjectRequestContext(), null);
});
