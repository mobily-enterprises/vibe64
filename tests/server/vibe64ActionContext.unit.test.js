import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { configureStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { registerVibe64ActionContext, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import {
  captureProjectRequestContext,
  currentProjectActionRequestMeta,
  currentProjectRequestContext,
  registerPracticeRequestActor,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";

test("project owner actions admit the standalone local owner but not foreign requests or missing hosted authority", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    const targetRoot = path.join(projectContext.projectsRoot, slug);
    const configure = (projectCatalogEnabled) => configureStudioProjectContext({
      explicitTargetRoot: targetRoot, explicitSystemRoot: path.join(projectContext.projectsRoot, "state"),
      explicitManagedSourceRoot: path.join(projectContext.projectsRoot, "sessions"),
      runtimeProfile: { local: !projectCatalogEnabled, projectCatalogEnabled, singleTargetRoot: targetRoot }, env: {}
    });
    configure(false);
    let writes = 0;
    const actions = createActionCatalogue();
    actions.register({ contributorId: "local-owner", domain: "test", actions: [withVibe64ActionContext({
      id: "vibe64.test.owner", kind: "command", channels: ["api", "automation"], surfaces: ["app"],
      input: { schema: createSchema({}), mode: "create" },
      execute() { writes += 1; return { project: currentProjectRequestContext().slug }; }
    }, { ownerRequired: true })] });
    const app = Fastify();
    app.post("/write", (request) => actions.execute({ actionId: "vibe64.test.owner",
      input: { projectSlug: request.query.project || slug },
      context: { channel: "api", surface: "app", requestMeta: { request } } }));
    const headers = { host: "localhost", origin: "http://localhost" };
    try {
      const response = await app.inject({ method: "POST", url: "/write", headers });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().project, slug);
      assert.equal((await app.inject({ method: "POST", url: "/write", headers: { ...headers, origin: "https://foreign.example" } })).statusCode, 403);
      assert.equal((await app.inject({ method: "POST", url: "/write", headers, remoteAddress: "198.51.100.9" })).statusCode, 403);
      assert.notEqual((await app.inject({ method: "POST", url: "/write?project=other-project", headers })).statusCode, 200);
      await assert.rejects(actions.execute({ actionId: "vibe64.test.owner", input: { projectSlug: slug },
        context: { channel: "automation", surface: "app" } }), { code: "vibe64_owner_required" });
      configure(true);
      assert.equal((await app.inject({ method: "POST", url: "/write", headers })).statusCode, 403);
      assert.equal(writes, 1);
    } finally {
      await app.close();
      configureStudioProjectContext();
    }
  });
});

function fixture({ ownerRequired = false, projectScoped = true, allowDeleting = false } = {}) {
  const calls = [];
  const state = { user: { username: "member", uid: 42, role: "member" }, allowed: true, deleting: false };
  const actions = createActionCatalogue();
  const definition = withVibe64ActionContext({
    id: "vibe64.test.read", kind: "query", channels: ["api", "automation"], surfaces: ["app"],
    input: { schema: createSchema({ text: { type: "string", required: true }, vibe64User: { type: "object" } }), mode: "create" },
    async execute(input, context) {
      const project = currentProjectRequestContext();
      await Promise.resolve();
      assert.equal(currentProjectRequestContext(), project);
      calls.push({ input, project, requestMeta: context.requestMeta });
      return { ok: true, projectSlug: project?.slug, username: input.vibe64User?.username };
    }
  }, { ownerRequired, projectScoped, allowDeleting });
  actions.register({ contributorId: "test", domain: "vibe64-test", actions: [definition] });
  registerVibe64ActionContext(actions, {
    projectContext: {
      projectsRoot: "/test/projects",
      async readWorkspaceProject({ slug, allowDeleting }) {
        if (state.deleting && !allowDeleting) throw Object.assign(new Error("Deleting"), { code: "vibe64_project_deleting" });
        return { project: { path: `/test/projects/${slug}` } };
      }
    },
    resolveUser: async () => state.user,
    async authorizeProject({ slug, user }) {
      assert.equal(user, state.user);
      if (!state.allowed || slug === "denied") throw Object.assign(new Error("Project access denied"), { statusCode: 403 });
    }
  });
  const execute = (input, context = {}) => actions.execute({
    actionId: definition.id, input, context: { channel: "automation", surface: "app", ...context }
  });
  return { actions, calls, definition, execute, state };
}

test("HTTP and automation establish the same project and trusted actor", async () => {
  const { calls, definition, execute } = fixture();
  assert.equal(Object.hasOwn(definition.input.schema.getFieldDefinitions(), "vibe64User"), false);
  const api = await execute({ text: "hello" }, {
    channel: "api", requestMeta: { request: { params: { slug: "alpha" } } }
  });
  const automation = await execute({ text: "hello", projectSlug: "alpha" });
  assert.deepEqual(automation, api);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.input.vibe64User.username, "member");
    assert.equal(call.input.projectSlug, undefined);
    assert.equal(call.project.slug, "alpha");
    assert.equal(call.project.targetRoot, "/test/projects/alpha");
  }
  assert.equal(currentProjectRequestContext(), null);
});

test("captured working context retains only the original request for freshly authorized actions", async () => {
  const f = fixture();
  const requestMeta = { request: { params: { slug: "alpha" }, headers: { cookie: "original-test-credential" } } };
  await f.execute({ text: "prepare" }, { requestMeta, unrelatedActionState: "not-retained" });
  const admitted = f.calls[0].project;
  const admittedRequestMeta = f.calls[0].requestMeta;
  assert.equal(admittedRequestMeta.request, requestMeta.request);
  assert.equal(admittedRequestMeta.request.headers, requestMeta.request.headers);
  assert.equal(Object.hasOwn(admitted, "requestMeta"), false);
  assert.equal(Object.hasOwn(admitted, "vibe64Action"), false);
  assert.equal(Object.hasOwn(admitted, "unrelatedActionState"), false);
  assert.equal(JSON.stringify(admitted).includes("original-test-credential"), false);

  let captured;
  await runWithProjectRequestContext(admitted, () => {
    assert.equal(currentProjectActionRequestMeta(), admittedRequestMeta);
    captured = captureProjectRequestContext();
  });
  await runWithProjectRequestContext(captured, async () => {
    assert.equal(currentProjectActionRequestMeta(), admittedRequestMeta);
    const receivingRequestMeta = { ...currentProjectActionRequestMeta(), request: {
      ...currentProjectActionRequestMeta().request, params: { slug: "beta" }
    } };
    await f.execute({ text: "receiving work" }, { requestMeta: receivingRequestMeta });
    assert.equal(f.calls.at(-1).project.slug, "beta");
    f.state.allowed = false;
    await assert.rejects(f.execute({ text: "revoked receiving work" }, { requestMeta: receivingRequestMeta }),
      { statusCode: 403 });
    assert.equal(f.calls.length, 2, "captured request metadata is not a cached permission grant");
    assert.equal(currentProjectActionRequestMeta(), admittedRequestMeta, "nested dispatch preserves the originating scope");
  });
  assert.equal(currentProjectActionRequestMeta(), null);
});

test("requestless actions cannot inherit a working action request", async () => {
  const f = fixture();
  const requestMeta = { request: { params: { slug: "alpha" }, headers: { cookie: "working-test-credential" } } };
  await f.execute({ text: "working" }, { requestMeta });
  const admitted = f.calls[0].project;
  const admittedRequestMeta = f.calls[0].requestMeta;
  assert.equal(admittedRequestMeta.request, requestMeta.request);
  await runWithProjectRequestContext(admitted, async () => {
    await f.definition.execute({ text: "requestless nested action", projectSlug: "alpha" });
    await runWithProjectRequestContext(f.calls.at(-1).project, () => {
      assert.equal(currentProjectActionRequestMeta(), null);
    });
    assert.equal(currentProjectActionRequestMeta(), admittedRequestMeta);
  });
  await runWithProjectRequestContext({ slug: "alpha", requestMeta, actionRequestMeta: requestMeta }, () => {
    assert.equal(currentProjectActionRequestMeta(), null, "ordinary fields cannot supply the private request projection");
  });
});

test("project and actor authority cannot be supplied in operation input or override its URL", async () => {
  const { calls, execute, state } = fixture();
  await assert.rejects(execute({ text: "hello", projectSlug: "beta" }, {
    channel: "api", requestMeta: { request: { params: { slug: "alpha" } } }
  }), { code: "vibe64_action_project_mismatch" });
  await assert.rejects(execute({ text: "hello", projectSlug: "alpha" }, {
    vibe64Action: { user: { role: "owner" } }
  }), { code: "vibe64_action_context_reserved" });
  await assert.rejects(execute({ text: "hello", projectSlug: "alpha", vibe64User: { role: "owner" } }), {
    code: "ACTION_VALIDATION_FAILED"
  });
  state.user = null;
  await assert.rejects(execute({ text: "hello", projectSlug: "alpha", vibe64User: { role: "owner" } }), {
    statusCode: 401
  });
  assert.equal(calls.length, 0);
});

test("revoked access and invalid input fail before the service executes", async () => {
  const { calls, execute, state } = fixture();
  await execute({ text: "hello", projectSlug: "alpha" });
  state.allowed = false;
  await assert.rejects(execute({ text: "hello", projectSlug: "alpha" }), { statusCode: 403 });
  state.allowed = true;
  await assert.rejects(execute({ projectSlug: "alpha" }));
  await assert.rejects(execute({ text: "hello", projectSlug: "../alpha" }));
  assert.equal(calls.length, 1);
});

test("concurrent projects keep their action contexts isolated", async () => {
  const { calls, execute } = fixture();
  await Promise.all([execute({ text: "a", projectSlug: "alpha" }), execute({ text: "b", projectSlug: "beta" })]);
  assert.deepEqual(calls.map(({ input, project }) => [input.text, project.slug]).sort(), [["a", "alpha"], ["b", "beta"]]);
  assert.equal(currentProjectRequestContext(), null);
});

test("global owner operations need current owner authority but no project", async () => {
  const { calls, execute, state } = fixture({ projectScoped: false, ownerRequired: true });
  await assert.rejects(execute({ text: "hello", vibe64User: { role: "owner" } }), { statusCode: 403 });
  state.user = { ...state.user, role: "owner" };
  await execute({ text: "hello" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].project, null);
});

test("only an action's declared lifecycle scope can enter a deleting project", async () => {
  const ordinary = fixture();
  ordinary.state.deleting = true;
  await assert.rejects(ordinary.execute({ text: "hello", projectSlug: "alpha" }), { code: "vibe64_project_deleting" });
  await assert.rejects(ordinary.execute({ text: "hello", projectSlug: "alpha", allowDeleting: true }));
  assert.equal(ordinary.calls.length, 0);
  const archive = fixture({ allowDeleting: true, ownerRequired: true });
  archive.state.deleting = true;
  archive.state.user.role = "owner";
  await archive.execute({ text: "resume", projectSlug: "alpha" });
  assert.equal(archive.calls[0].project.slug, "alpha");
});

function learningOnlyContributor() {
  const calls = [];
  const state = { user: { uid: 42, username: "actual-process-owner", role: "owner" } };
  let contributor;
  registerVibe64ActionContext({ registerContextContributor(value) { contributor = value; return value; } }, {
    admissionScope: "learning-only",
    async resolveUser(input) { calls.push({ user: input }); return state.user; },
    authorizeProject() { assert.fail("Learning-only authority cannot admit a working project"); }
  });
  const contribute = (definition, input = {}, context = {}) => contributor.contribute({ definition, input, context });
  return { calls, state, contribute };
}

const scopedDefinition = (id, vibe64) => ({ id, extensions: { vibe64 } });

test("action context rejects unsupported construction admission scopes before registration or resolution", () => {
  for (const admissionScope of [null, "", "local", "learning", true, [], {}]) {
    assert.throws(() => registerVibe64ActionContext({ registerContextContributor() { assert.fail("No registration"); } }, {
      admissionScope, resolveUser() { assert.fail("No identity resolution"); }, authorizeProject() { assert.fail("No project authorization"); }
    }), /admissionScope must be all or learning-only/u);
  }
});

test("learning-only authority leaves ordinary Working and Colleague contributions empty before resolving an actor", async () => {
  const f = learningOnlyContributor();
  const cases = [
    [scopedDefinition("vibe64.sessions.conversation.context.read", { projectScoped: true }), { projectSlug: "working", sessionId: "saved" }],
    [scopedDefinition("vibe64.colleague.state.read", { projectScoped: false }), {}],
    [scopedDefinition("vibe64.accounts.state.read", { projectScoped: false }), {}],
    [scopedDefinition("vibe64.training.author-preview.start", { projectScoped: true }), { projectSlug: "author-project" }],
    [scopedDefinition("vibe64.training-other.read", { projectScoped: false }), {}],
    [{ id: "unscoped.action" }, {}]
  ];
  for (const [definition, input] of cases) {
    const context = { channel: "internal", localMarker: "retain" };
    assert.deepEqual(await f.contribute(definition, input, context), {});
    assert.deepEqual(context, { channel: "internal", localMarker: "retain" });
  }
  assert.deepEqual(f.calls, []);
  const { authenticatedVibe64User } = await import("@local/vibe64-core/server/actionContext");
  const colleague = withVibe64ActionContext({ id: "vibe64.colleague.state.read",
    input: { schema: createSchema({}), mode: "create" }, execute(_input, context) { return authenticatedVibe64User(context); }
  }, { projectScoped: false });
  assert.equal(await colleague.execute({}, {}), null);
  assert.deepEqual(await f.contribute(cases[0][0], cases[0][1], { vibe64Action: { existingHostMarker: true } }), {});
  assert.deepEqual(f.calls, []);
});

test("learning-only authority uses the original fresh contributor for non-project Training actions", async () => {
  const f = learningOnlyContributor();
  const training = scopedDefinition("vibe64.training.learning.read", { projectScoped: false });
  const first = await f.contribute(training);
  assert.equal(first.actor.id, "42");
  assert.equal(first.vibe64Action.user, f.state.user);
  assert.equal(first.vibe64Action.project, null);
  await assert.rejects(f.contribute(training, {}, { vibe64Action: { user: f.state.user } }),
    { code: "vibe64_action_context_reserved" });
  assert.equal(f.calls.length, 1);
  f.state.user = null;
  await assert.rejects(f.contribute(training), { code: "vibe64_auth_required" });
  assert.equal(f.calls.length, 2);
});

test("conversation authority diagnostics separate slow phases without retaining request contents or changing admission", async t => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const logs = [];
  const user = { uid: 42, username: "private-account" };
  let lookups = 0;
  let allowed = true;
  let slow = true;
  let contributor;
  const env = { JSKIT_REALTIME_DEBUG: "1" };
  registerVibe64ActionContext({ registerContextContributor(value) { contributor = value; } }, {
    env, logger: { warn(record) { logs.push(record); } },
    resolveUser() { lookups++; clock += slow ? 20 : 0; return user; },
    authorizeProject() { clock += slow ? 30 : 0; if (!allowed) throw new Error("private-project-error"); },
    projectContext: { projectsRoot: "/test/projects", readWorkspaceProject({ slug }) {
      clock += slow ? 60 : 0; return { project: { path: `/test/projects/${slug}` } };
    } }
  });
  const definition = { id: "vibe64.sessions.conversation.context.read",
    extensions: { vibe64: { projectScoped: true } } };
  const input = { projectSlug: "alpha", sessionId: "session-1", text: "private-message" };
  const context = { requestMeta: { request: { headers: { cookie: "private-cookie" } } } };
  const execute = (value = input, selected = definition) => contributor.contribute({ definition: selected, input: value, context });
  assert.equal((await execute()).actor.id, "42");
  assert.equal((await execute()).actor.id, "42");
  assert.equal(lookups, 2, "Every repeated snapshot/stream grant still rechecks the current user");
  assert.equal(logs.length, 2);
  assert.deepEqual(logs[0].timings, { user: 20, "project-access": 30, "project-context": 60 });
  assert.equal(logs[0].durationMs, 110);
  assert.equal(logs[0].completed, true);
  assert.equal(logs[0].phase, "authorization-detail");
  allowed = false;
  await assert.rejects(execute(), /private-project-error/u);
  assert.deepEqual(logs.at(-1).timings, { user: 20, "project-access": 30 });
  assert.equal(logs.at(-1).completed, false);
  assert.doesNotMatch(JSON.stringify(logs), /private-|cookie|username/u);
  const count = logs.length;
  allowed = true;
  slow = false;
  await execute();
  assert.equal(logs.length, count, "Fast healthy streaming checks remain quiet");
  slow = true;
  await execute(input, { ...definition, id: "vibe64.other.action" });
  assert.equal(logs.length, count, "Other actions do not acquire conversation diagnostics");
  env.JSKIT_REALTIME_DEBUG = "0";
  await execute();
  allowed = false;
  await assert.rejects(execute(), /private-project-error/u);
  assert.equal(logs.length, count, "Disabled diagnostics remain silent on success and failure");
});

test("a practice project action admits only its own learner, through the host contributor and the action itself", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-practice-action-"));
  const projectsRoot = path.join(root, "projects");
  const projectContext = configureStudioProjectContext({ explicitProjectsRoot: projectsRoot, explicitSystemRoot: path.join(root, "system"),
    explicitManagedSourceRoot: projectsRoot, env: {}, home: root, learningSpace: { root: path.join(projectsRoot, ".learning") } });
  const learner = { uid: 42, username: "learner", role: "member" };
  const other = { uid: 43, username: "other", role: "owner" };
  const training = { schemaVersion: 2, learnerKey: "NDI", practiceId: "12345678-1234-4234-8234-123456789abc",
    pin: { course: { courseId: "intro-course", release: "0.1.0" }, topic: { schemaVersion: 1, topicId: "intro-topic", release: "0.1.0",
      repository: "example/learn-intro", commit: "b".repeat(40), topicHash: "a".repeat(64) }, lesson: { code: "INTRO-01", hash: "c".repeat(64) } },
    exercise: { kind: "bundled", sourcePath: "training/exercises/app" } };
  const slug = "training-12345678123442348234123456789abc";
  const deleted = { code: "vibe64_practice_project_deleted", statusCode: 404 };
  try {
    const practice = await projectContext.runWithPracticeProjectScope({ actor: learner, training, access: "create" },
      async () => (await projectContext.createWorkspaceProjectRecord({ slug, training })).project);
    const state = { user: learner };
    const actions = createActionCatalogue();
    const definition = withVibe64ActionContext({
      id: "vibe64.test.practice", kind: "query", channels: ["api", "automation"], surfaces: ["app"],
      input: { schema: createSchema({}), mode: "create" },
      execute() { return { targetRoot: currentProjectRequestContext().targetRoot }; }
    });
    actions.register({ contributorId: "practice-test", domain: "test", actions: [definition] });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => state.user, authorizeProject() {} });
    const execute = () => actions.execute({ actionId: definition.id, input: { projectSlug: slug },
      context: { channel: "automation", surface: "app" } });
    assert.deepEqual(await execute(), { targetRoot: practice.projectRoot });
    state.user = other;
    await assert.rejects(execute(), deleted, "another learner, even the workspace owner, does not find it");
    // Without a host contributor the action resolves the same rule with its actor (a request without headers).
    const direct = (vibe64User) => definition.execute({ projectSlug: slug }, { requestMeta: { request: { vibe64User } } });
    assert.deepEqual(await direct(learner), { targetRoot: practice.projectRoot });
    await assert.rejects(direct(other), deleted);
    // A local person's action carries no vibe64User: it stays that person's
    // request, so the host-supplied actor is compared with the learner.
    const local = (headers) => definition.execute({ projectSlug: slug }, { requestMeta: { request: { headers } } });
    await assert.rejects(local({ host: "localhost" }), deleted, "a person without an actor is not admitted as the marker's learner");
    registerPracticeRequestActor(({ request }) => (request.headers.host === "localhost" ? learner : other));
    try {
      assert.deepEqual(await local({ host: "localhost" }), { targetRoot: practice.projectRoot });
      await assert.rejects(local({ host: "remote" }), deleted, "another local person is refused");
    } finally {
      registerPracticeRequestActor(null);
    }
    assert.deepEqual(await definition.execute({ projectSlug: slug }, {}), { targetRoot: practice.projectRoot },
      "requestless internal work runs as the marker's learner");
  } finally {
    configureStudioProjectContext();
    await rm(root, { force: true, recursive: true });
  }
});

test("Colleague acting for a learner opens only the projects of their mode and relays the exact reason", async (t) => {
  const { registerLearningModeReader, LEARNING_MODE_PROJECT_MESSAGE, PRACTICE_PROJECT_MODE_MESSAGE } =
    await import("@local/vibe64-core/server/learningMode");
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-colleague-mode-"));
  configureStudioProjectContext({ explicitProjectsRoot: path.join(root, "projects"), explicitSystemRoot: path.join(root, "system"),
    explicitManagedSourceRoot: path.join(root, "projects"), env: {}, home: root, learningSpace: { root: path.join(root, "projects", ".learning") } });
  t.after(async () => {
    registerLearningModeReader(null);
    configureStudioProjectContext();
    await rm(root, { force: true, recursive: true });
  });
  const practiceSlug = "training-12345678123442348234123456789abc";
  const user = { uid: 42, username: "learner", role: "member" };
  const definition = withVibe64ActionContext({
    id: "vibe64.test.colleague-open", kind: "query", channels: ["automation"], surfaces: ["app"],
    input: { schema: createSchema({}), mode: "create" }, execute: () => ({ ok: true })
  });
  const open = projectSlug => definition.execute({ projectSlug }, { colleague: {}, requestMeta: { request: { vibe64User: user } } });
  const reads = [];
  let mode = { on: false, currentAttemptId: "", lessonCode: "", practiceSlug };
  registerLearningModeReader(({ actor }) => { reads.push(actor); return mode; });
  await assert.rejects(open(practiceSlug), { code: "vibe64_learning_mode_project", statusCode: 403, message: PRACTICE_PROJECT_MODE_MESSAGE });
  assert.deepEqual(reads.at(-1), user, "the mode is the acting person's");
  mode = { ...mode, on: true, currentAttemptId: "12345678-1234-4234-8234-123456789abc" };
  await assert.rejects(open("alpha"), { code: "vibe64_learning_mode_project", statusCode: 403, message: LEARNING_MODE_PROJECT_MESSAGE,
    details: { practiceSlug } });
  // Learn lets the practice project through to admission (here: no such project).
  await assert.rejects(open(practiceSlug), { code: "vibe64_practice_project_deleted" });
});
