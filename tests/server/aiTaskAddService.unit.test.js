// The add-service AI task: the AI connects the app to the service Add put in
// genesis/stack.md, then Vibe64 prepares the workspace and restarts Preview.
import assert from "node:assert/strict";
import test from "node:test";
import { createAiTaskKinds } from "../../packages/vibe64-ai-tasks/src/server/aiTaskKinds.js";
import { createAddServiceKind } from "../../packages/vibe64-ai-tasks/src/server/kinds/addService.js";

const SESSION = "s1";
const OWNER = { id: "owner", role: "owner" };
const DB_NAMES = { database: "DB_NAME", host: "DB_HOST", password: "DB_PASSWORD", port: "DB_PORT", username: "DB_USER" };

/** The session's Stack as readStackServiceChoices answers it, and the owners a check calls, recording each call. */
function world({ postgresql = {}, redis = {}, service = {} } = {}) {
  const calls = [];
  const state = {
    choices: [
      { kind: "postgresql", piece: "jskit-postgresql", resourceId: "database", bindings: DB_NAMES,
        alternatives: [{ url: "DATABASE_URL" }], present: true, needsAi: false, refused: "Already added: database (postgresql)", ...postgresql },
      { kind: "mysql", piece: "jskit-mysql", resourceId: "database", bindings: DB_NAMES, alternatives: [], present: false, needsAi: false,
        refused: "A project has one database: this one has database (postgresql)" },
      { kind: "redis", piece: null, resourceId: "redis", bindings: {}, alternatives: [], present: false, needsAi: true, refused: "", ...redis },
      { kind: "bucket", piece: null, resourceId: "files", bindings: {}, alternatives: [], present: false, needsAi: true, refused: "" },
      { kind: "service", piece: null, resourceId: null, bindings: {}, alternatives: [], present: false, needsAi: true, refused: "",
        services: [{ id: "web", exposure: "public" }], ...service }
    ],
    setup: { ok: true, workspaceSetup: { status: "succeeded", finishedAt: "2026-11-19T01:00:00.000Z" } },
    preview: { ok: true, running: true }
  };
  const project = {
    async readStackServiceChoices(input) {
      calls.push(["choices", input]);
      return { ok: true, sessionId: input.sessionId, stackHash: "h1", managed: true, choices: state.choices };
    }
  };
  const sessions = {
    async retryWorkspaceSetup(sessionId, input) {
      calls.push(["prepare", sessionId, input]);
      return state.setup;
    }
  };
  const terminals = {
    async restartPreviewAfterSetup(sessionId, input) {
      calls.push(["restart", sessionId, input]);
      return state.preview;
    }
  };
  const kind = createAddServiceKind({ project, sessions, terminals });
  const context = { runtime: {}, sessionId: SESSION, vibe64User: OWNER };
  const signal = new AbortController().signal;
  const progress = [];
  async function check(problem) {
    const task = { problem, startedBy: OWNER };
    return kind.check.run({ progress: (update) => progress.push(update.step), runtime: {}, sessionId: SESSION, signal, taskId: "task-1" }, task);
  }
  return { calls, check, context, kind, progress, signal, state };
}

test("the brief names the Env names the app reads and what the AI must not do", async () => {
  const { context, kind } = world();
  const problem = await kind.problem(context, { kind: "postgresql", resourceId: "database" });
  assert.equal(problem.key, JSON.stringify(["add-service", "postgresql", "database"]));
  assert.equal(problem.summary, "Connect the app to database (postgresql)");
  const brief = kind.brief(problem);
  for (const text of [
    "genesis/stack.md now declares resource `database` (postgresql) through Stack component `jskit-postgresql`.",
    "The app receives its values as DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT and DB_USER (preferred) or DATABASE_URL.",
    "Read `genesis context` for the paths you change",
    "Use the framework's own database client and migration lifecycle",
    "keep the seed idempotent",
    "`vibe64-helper spec workspace-setup`, `vibe64-helper spec deployment`",
    "Do not change the resource's declaration in `## Resources`.",
    "Never write a value of it into a file.",
    "Do not commit, push or save."
  ]) assert.ok(brief.includes(text), `the brief says: ${text}\n\n${brief}`);
  assert.equal(kind.context(problem).includes("Do not commit, push or save."), true, "each message the person sends repeats it");
  assert.equal(kind.id, "add-service");
  assert.equal(kind.repository, true, "direct Update, Save and Prepare wait for it");
  assert.deepEqual(kind.steps, ["The AI connects the app to the service", "Vibe64 prepares the workspace and restarts Preview"]);
});

test("a kind with no ready entry asks the AI to declare it first, and its check confirms the declaration", async () => {
  const { calls, check, context, kind, state } = world();
  const problem = await kind.problem(context, { kind: "redis", resourceId: "redis" });
  const brief = kind.brief(problem);
  assert.ok(brief.startsWith("Declare resource `redis` (kind `redis`) in `## Resources`, as one fenced `json genesis-resource` block"), brief);
  assert.ok(brief.includes("Do not commit, push or save."));
  const undeclared = await check(problem);
  assert.equal(undeclared.passed, false);
  assert.equal(undeclared.diagnostic, "genesis/stack.md declares no redis resource yet: declare `redis` in `## Resources`.");
  assert.equal(calls.some(([name]) => name === "prepare"), false, "nothing is prepared before the declaration exists");
  state.choices[2] = { ...state.choices[2], present: true, refused: "Already added: redis (redis)", bindings: { url: "REDIS_URL" } };
  assert.equal((await check(problem)).passed, true);
});

test("the check prepares the workspace, then restarts Preview on what it prepared", async () => {
  const { calls, check, context, kind, progress, signal } = world();
  const problem = await kind.problem(context, { kind: "postgresql", resourceId: "database" });
  const result = await check(problem);
  assert.deepEqual(result, { passed: true, message: "The workspace is prepared, and Preview runs with database." });
  assert.deepEqual(calls.filter(([name]) => name !== "choices"), [
    ["prepare", SESSION, { aiTaskId: "task-1", signal, vibe64User: OWNER }],
    ["restart", SESSION, { finishedAt: "2026-11-19T01:00:00.000Z", signal }]
  ]);
  assert.deepEqual(progress, ["Preparing the workspace", "Restarting Preview"]);
});

test("a failed preparation returns its reason to the AI and restarts nothing; Preview's own failure does too", async () => {
  const { calls, check, context, kind, state } = world();
  const problem = await kind.problem(context, { kind: "postgresql", resourceId: "database" });
  state.setup = { ok: true, workspaceSetup: { status: "failed", diagnostic: "npm run db:migrate failed: relation \"users\" exists" } };
  const failed = await check(problem);
  assert.equal(failed.passed, false);
  assert.equal(failed.diagnostic, "npm run db:migrate failed: relation \"users\" exists");
  assert.equal(calls.some(([name]) => name === "restart"), false);
  const retry = kind.check.retry.message(failed.diagnostic);
  assert.ok(retry.includes("npm run db:migrate failed"), retry);
  assert.ok(retry.includes("Do not commit, push or save."), retry);
  state.setup = { ok: true, workspaceSetup: { status: "succeeded", finishedAt: "t2" } };
  state.preview = { ok: false, code: "vibe64_preview_not_ready", error: "The app exited: ECONNREFUSED 127.0.0.1:5432" };
  const preview = await check(problem);
  assert.equal(preview.passed, false);
  assert.equal(preview.diagnostic, "Preview did not become ready after preparation: The app exited: ECONNREFUSED 127.0.0.1:5432");
  state.preview = { ok: true, running: false };
  assert.deepEqual(await check(problem), { passed: true,
    message: "The workspace is prepared. Preview isn't running: it uses database when it starts." });
});

test("another App Service: the brief asks for its Deployment entry, and the check reads the Deployment", async () => {
  const { calls, check, context, kind, state } = world();
  const problem = await kind.problem(context, { kind: "service", serviceId: "worker", exposure: "internal", reachedBy: "web" });
  const brief = kind.brief(problem);
  for (const text of [
    "Add `### Service `worker`: <summary>` to `## Deployment` (exact grammar: `vibe64-helper spec deployment`)",
    "- Exposure: `internal`",
    "On `web`: `- Reaches: `worker` as `<ENV>``",
    "Never add or change `- Sandbox allows:`.",
    "Do not commit, push or save."
  ]) assert.ok(brief.includes(text), `the brief says: ${text}\n\n${brief}`);
  state.choices[4] = { ...state.choices[4], services: [], refused: "The Deployment does not parse: Deployment line 4 is not a step." };
  const broken = await check(problem);
  assert.equal(broken.passed, false);
  assert.equal(broken.diagnostic, "The Deployment does not parse: Deployment line 4 is not a step.");
  state.choices[4] = { ...state.choices[4], refused: "", services: [{ id: "web", exposure: "public" }] };
  assert.equal((await check(problem)).diagnostic, "The Deployment declares no service worker yet.");
  state.choices[4] = { ...state.choices[4], services: [{ id: "web", exposure: "public" }, { id: "worker", exposure: "internal" }] };
  assert.deepEqual(await check(problem), { passed: true, message: "The Deployment declares worker." });
  assert.equal(calls.some(([name]) => name === "prepare"), false, "a service's check reads the Deployment only");
});

test("the task refuses what Add did not offer: an unknown kind, a refused one and an undeclared resource", async () => {
  const { context, kind } = world({ postgresql: { present: false, refused: "" } });
  await assert.rejects(kind.problem(context, { kind: "mongodb" }), { statusCode: 400, code: "vibe64_stack_service_kind_unknown" });
  await assert.rejects(kind.problem(context, { kind: "mysql" }), { statusCode: 409, code: "vibe64_stack_service_refused",
    message: "A project has one database: this one has database (postgresql)" });
  await assert.rejects(kind.problem(context, { kind: "postgresql" }), { statusCode: 409, code: "vibe64_ai_task_no_problem",
    message: "genesis/stack.md declares no postgresql resource. Add it first." });
  await assert.rejects(kind.problem(context, { kind: "service", serviceId: "web", reachedBy: "web" }), { statusCode: 409,
    code: "vibe64_stack_service_refused" });
});

test("public's kinds include add-service once", () => {
  const owners = { databaseTools: {}, hostKinds: [], pages: {}, project: {}, sessions: {}, terminals: {} };
  assert.equal(createAiTaskKinds(owners)["add-service"].title, "Add a service");
});
