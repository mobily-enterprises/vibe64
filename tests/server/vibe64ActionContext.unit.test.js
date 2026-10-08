import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { registerVibe64ActionContext, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

function fixture({ ownerRequired = false, projectScoped = true, allowDeleting = false } = {}) {
  const calls = [];
  const state = { user: { username: "member", uid: 42, role: "member" }, allowed: true, deleting: false };
  const actions = createActionCatalogue();
  const definition = withVibe64ActionContext({
    id: "vibe64.test.read", kind: "query", channels: ["api", "automation"], surfaces: ["app"],
    input: { schema: createSchema({ text: { type: "string", required: true }, vibe64User: { type: "object" } }), mode: "create" },
    async execute(input) {
      const project = currentProjectRequestContext();
      await Promise.resolve();
      assert.equal(currentProjectRequestContext(), project);
      calls.push({ input, project });
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

const learningAttempt = "12345678-1234-4234-8234-123456789abc";

function learningActionFixture({ learningAccess = "observe", resolver = true } = {}) {
  const calls = [];
  const state = { actor: { uid: 42, username: "learner", role: "member" }, active: true, foreign: false };
  const actions = createActionCatalogue();
  const definition = withVibe64ActionContext({
    id: "vibe64.test.learning", kind: "query", channels: ["api", "internal"], surfaces: ["app"],
    input: { schema: createSchema({ sessionId: { type: "string", required: true } }), mode: "create" },
    execute(input) {
      const current = currentProjectRequestContext();
      calls.push({ input, current });
      return { attemptId: current.learningScope.attemptId, learnerId: current.learningScope.learnerId };
    }
  }, { learningAccess });
  actions.register({ contributorId: "learning-test", domain: "test", actions: [definition] });
  registerVibe64ActionContext(actions, {
    resolveUser: async () => state.actor,
    authorizeProject() { throw new Error("A source-less learning operation cannot authorize a substitute project."); },
    ...(resolver ? { async resolveLearningContext(input) {
      calls.push({ resolution: input });
      if (input.access === "write" && !state.active) throw Object.assign(new Error("Ended attempt"), { code: "attempt_inactive" });
      return { projectRuntimeRoot: "/private/actual-learner/attempt", learningScope: {
        learnerId: state.foreign ? "other-person" : String(input.actor.uid), attemptId: input.attemptId,
        pin: { lesson: { code: "REAL-LESSON" } }, noExercise: true
      } };
    } } : {})
  });
  const execute = (input = {}, context = {}) => actions.execute({ actionId: definition.id,
    input: { sessionId: "learning-session", ...input }, context: { channel: "internal", surface: "app", ...context } });
  return { calls, state, execute };
}

test("learning operations resolve the exact attempt and current actor through the original action contributor", async () => {
  const f = learningActionFixture();
  assert.deepEqual(await f.execute({ learningAttemptId: learningAttempt }), { attemptId: learningAttempt, learnerId: "42" });
  assert.equal(f.calls[0].resolution.actor, f.state.actor);
  assert.equal(f.calls[0].resolution.sessionId, "learning-session");
  assert.equal(f.calls[0].resolution.access, "observe");
  assert.equal(f.calls[1].input.learningAttemptId, undefined);
  assert.equal(f.calls[1].input.vibe64User, f.state.actor);
  assert.equal(f.calls[1].current.slug, undefined);
  assert.equal(currentProjectRequestContext(), null);
  f.state.actor = null;
  await assert.rejects(f.execute({ learningAttemptId: learningAttempt }), { statusCode: 401 });
  assert.equal(f.calls.length, 2);
});

test("learning route and input cannot mix another attempt, project or reserved authority", async () => {
  const f = learningActionFixture();
  const second = "12345678-1234-4234-8234-123456789abd";
  await assert.rejects(f.execute({ learningAttemptId: second }, {
    requestMeta: { request: { params: { learningAttemptId: learningAttempt } } }
  }), { code: "vibe64_learning_attempt_mismatch" });
  for (const [input, context] of [
    [{ learningAttemptId: learningAttempt, projectSlug: "working" }, {}],
    [{ learningAttemptId: learningAttempt }, { projectSlug: "working" }],
    [{ learningAttemptId: learningAttempt }, { requestMeta: { request: { params: { slug: "working" } } } }]
  ]) await assert.rejects(f.execute(input, context), { code: "vibe64_learning_project_mismatch" });
  await assert.rejects(f.execute({ learningAttemptId: learningAttempt }, { vibe64Action: {
    user: f.state.actor, learning: { learningScope: { attemptId: learningAttempt } }
  } }), { code: "vibe64_action_context_reserved" });
  await assert.rejects(f.execute({ learningAttemptId: "../private" }), { code: "vibe64_learning_attempt_invalid" });
  assert.equal(f.calls.length, 0);
});

test("learning authority fails closed when host support or actor binding is missing", async () => {
  const unsupported = learningActionFixture({ resolver: false });
  await assert.rejects(unsupported.execute({ learningAttemptId: learningAttempt }), { code: "vibe64_learning_unavailable" });
  assert.equal(unsupported.calls.length, 0);
  const foreign = learningActionFixture();
  foreign.state.foreign = true;
  await assert.rejects(foreign.execute({ learningAttemptId: learningAttempt }), { code: "vibe64_learning_scope_mismatch" });
  assert.equal(foreign.calls.length, 1);
  const ordinary = fixture();
  await assert.rejects(ordinary.execute({ text: "do not borrow working authority", learningAttemptId: learningAttempt }), {
    code: "vibe64_learning_unavailable"
  });
  assert.equal(ordinary.calls.length, 0);
});

test("learning writes recheck active authority; ended observations retain the same original context owner", async () => {
  const write = learningActionFixture({ learningAccess: "write" });
  await write.execute({ learningAttemptId: learningAttempt });
  write.state.active = false;
  await assert.rejects(write.execute({ learningAttemptId: learningAttempt }), { code: "attempt_inactive" });
  assert.equal(write.calls.filter(value => value.current).length, 1);
  const observe = learningActionFixture();
  observe.state.active = false;
  await observe.execute({ learningAttemptId: learningAttempt });
  assert.equal(observe.calls[1].current.learningScope.attemptId, learningAttempt);
  assert.equal(currentProjectRequestContext(), null);
});


function learningOnlyContributor() {
  const calls = [];
  const state = { user: { uid: 42, username: "actual-process-owner", role: "owner" }, foreign: false };
  let contributor;
  registerVibe64ActionContext({ registerContextContributor(value) { contributor = value; return value; } }, {
    admissionScope: "learning-only",
    async resolveUser(input) { calls.push({ user: input }); return state.user; },
    authorizeProject() { assert.fail("Learning-only authority cannot admit a working project"); },
    async resolveLearningContext(input) {
      calls.push({ learning: input });
      return { projectRuntimeRoot: "/server-owned/actual-learner/attempt", learningScope: {
        learnerId: state.foreign ? "another-owner" : String(input.actor.uid), attemptId: input.attemptId, noExercise: true
      } };
    }
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
    [scopedDefinition("vibe64.sessions.conversation.context.read", { projectScoped: true, learningAccess: "observe" }), { projectSlug: "working", sessionId: "saved" }],
    [scopedDefinition("vibe64.colleague.state.read", { projectScoped: false }), {}],
    [scopedDefinition("vibe64.accounts.state.read", { projectScoped: false }), {}],
    [scopedDefinition("vibe64.training.author-preview.start", { projectScoped: true }), { projectSlug: "author-project" }],
    [scopedDefinition("vibe64.sessions.source.read", { projectScoped: true }), { learningAttemptId: learningAttempt }],
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

test("learning-only authority uses the original fresh contributor for non-project Training and explicitly selected Main actions", async () => {
  const f = learningOnlyContributor();
  const training = scopedDefinition("vibe64.training.learning.read", { projectScoped: false });
  const first = await f.contribute(training);
  assert.equal(first.actor.id, "42");
  assert.equal(first.vibe64Action.user, f.state.user);
  assert.equal(first.vibe64Action.project, null);
  assert.equal(Object.hasOwn(first.vibe64Action, "learning"), false);
  const main = scopedDefinition("vibe64.sessions.agent-message.send", { projectScoped: true, learningAccess: "write" });
  for (const [input, context] of [
    [{ learningAttemptId: learningAttempt, sessionId: "saved-learning" }, {}],
    [{ sessionId: "saved-learning" }, { requestMeta: { request: { params: { learningAttemptId: learningAttempt } } } }]
  ]) {
    const grant = await f.contribute(main, input, context);
    assert.equal(grant.vibe64Action.user, f.state.user);
    assert.equal(grant.vibe64Action.learning.learningScope.attemptId, learningAttempt);
    assert.equal(grant.vibe64Action.learning.learningScope.learnerId, "42");
    assert.equal(grant.vibe64Action.project, null);
    const resolution = f.calls.at(-1).learning;
    assert.equal(resolution.actor, f.state.user);
    assert.equal(resolution.sessionId, "saved-learning");
    assert.equal(resolution.access, "write");
  }
  assert.equal(f.calls.filter(value => value.user).length, 3);
  f.state.user = null;
  await assert.rejects(f.contribute(training), { code: "vibe64_auth_required" });
  assert.equal(f.calls.filter(value => value.user).length, 4);
});

test("learning-only matching retains reserved authority, exact selector and foreign learner refusals", async () => {
  const f = learningOnlyContributor();
  const main = scopedDefinition("vibe64.sessions.agent-turn.interrupt", { projectScoped: true, learningAccess: "control" });
  await assert.rejects(f.contribute(main, { learningAttemptId: learningAttempt }, { vibe64Action: { user: f.state.user } }),
    { code: "vibe64_action_context_reserved" });
  assert.deepEqual(f.calls, []);
  await assert.rejects(f.contribute(main, { learningAttemptId: "../private" }), { code: "vibe64_learning_attempt_invalid" });
  await assert.rejects(f.contribute(main, { learningAttemptId: learningAttempt, projectSlug: "working" }),
    { code: "vibe64_learning_project_mismatch" });
  await assert.rejects(f.contribute(main, { learningAttemptId: "12345678-1234-4234-8234-123456789abd" }, {
    requestMeta: { request: { params: { learningAttemptId: learningAttempt } } }
  }), { code: "vibe64_learning_attempt_mismatch" });
  assert.equal(f.calls.some(value => value.learning), false);
  f.state.foreign = true;
  await assert.rejects(f.contribute(main, { learningAttemptId: learningAttempt, sessionId: "saved-learning" }),
    { code: "vibe64_learning_scope_mismatch" });
  assert.equal(f.calls.at(-1).learning.access, "control");
});

test("practice Main actions use fresh original hosted authorization and callback grants while exact Create owns one opener barrier", async t => {
  const [{ mkdtemp, rm }, os, path, { createStudioProjectContext }, { createService: createProject },
    { assertProjectEffectAdmission, captureProjectRequestContext, runWithProjectRequestContext }] = await Promise.all([
    import("node:fs/promises"), import("node:os"), import("node:path"),
    import("../../packages/vibe64-core/src/server/studioProjectContext.js"),
    import("../../packages/vibe64-project/src/server/service.js"),
    import("../../packages/vibe64-core/src/server/projectRequestContext.js")
  ]);
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-practice-action-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const core = createStudioProjectContext({ explicitProjectsRoot: path.join(root, "projects"),
    explicitSystemRoot: path.join(root, "system"), env: {}, home: root });
  const project = createProject({ projectContext: core });
  const actor = { uid: 42, username: "learner", role: "member" };
  const training = { schemaVersion: 1, learnerKey: "NDI", attemptId: learningAttempt,
    pin: { course: { courseId: "intro-course", release: "0.1.0" }, topic: { schemaVersion: 1, topicId: "intro-topic", release: "0.1.0",
      repository: "example/learn-intro", commit: "a".repeat(40), topicHash: "b".repeat(64) },
      lesson: { code: "INTRO-01", hash: "c".repeat(64) } }, exercise: { kind: "bundled", sourcePath: "training/exercises/app" } };
  const slug = `training-${learningAttempt.replaceAll("-", "")}`;
  await core.createWorkspaceProjectRecord({ slug, training });
  const learningScope = Object.freeze({ learnerId: "42", attemptId: learningAttempt, pin: training.pin, noExercise: false });
  const actions = createActionCatalogue();
  const calls = [];
  let allowed = true;
  let active = true;
  let openerBarriers = 0;
  let captured;
  for (const [id, access] of [["vibe64.test.practice-write", "write"], ["vibe64.sessions.create", "create"]]) {
    const definition = withVibe64ActionContext({ id, kind: "command", channels: ["internal"], surfaces: ["app"],
      input: { mode: "create", schema: createSchema({ sessionId: { type: "string", required: false } }) },
      async execute(input, context) {
        if (access === "create") return context.vibe64Action.learning.createLearningSession(input);
        assert.doesNotThrow(assertProjectEffectAdmission);
        assert.deepEqual(currentProjectRequestContext().learningScope, learningScope);
        calls.push("effect");
        return { ok: true };
      }
    }, { learningAccess: access });
    actions.register({ contributorId: id, domain: "test", actions: [definition] });
  }
  registerVibe64ActionContext(actions, {
    projectContext: core,
    resolveUser: async () => actor,
    async authorizeProject(input) {
      calls.push("authorize");
      assert.equal(input.user, actor);
      assert.equal(input.slug, slug, "the trusted saved scope selects the original project, never transport input");
      assert.equal((await core.readWorkspaceProject({ slug: input.slug })).project.slug, slug);
      if (!allowed) throw Object.assign(new Error("Actual host denied access"), { code: "actual_host_denied", statusCode: 403 });
    },
    async resolveLearningContext(input) {
      assert.equal(input.actor, actor);
      assert.equal(input.attemptId, learningAttempt);
      if (!active) throw Object.assign(new Error("Ended exact saved attempt"), { code: "saved_attempt_ended" });
      await project.runInProjectContext(slug, () => core.runWithHostedTrainingProjectScope({ actor, training, access: "control" },
        () => runWithProjectRequestContext({ ...currentProjectRequestContext(), learningScope }, () => {
          captured = captureProjectRequestContext();
        })));
      return Object.freeze({ ...captured,
        async runLearningOperation(operation) {
          assert.notEqual(input.access, "create", "Create must not reacquire the opener's own barrier");
          if (!active) throw Object.assign(new Error("Ended exact saved attempt"), { code: "saved_attempt_ended" });
          calls.push("fresh-grant");
          return project.runInProjectContext(slug, () => core.runWithHostedTrainingProjectScope({ actor, training, access: input.access },
            () => runWithProjectRequestContext({ ...currentProjectRequestContext(), learningScope }, operation)));
        },
        async createLearningSession() {
          assert.equal(input.access, "create");
          openerBarriers++;
          if (!active) throw Object.assign(new Error("Ended exact saved attempt"), { code: "saved_attempt_ended" });
          return { ok: true, sessionId: `training-${learningAttempt}` };
        }
      });
    }
  });
  const execute = (actionId, input = {}) => actions.execute({ actionId,
    input: { learningAttemptId: learningAttempt, ...input }, context: { channel: "internal", surface: "app" } });
  await execute("vibe64.test.practice-write", { sessionId: `training-${learningAttempt}` });
  assert.deepEqual(calls, ["authorize", "fresh-grant", "effect"]);
  await runWithProjectRequestContext(captured, () => assert.throws(assertProjectEffectAdmission,
    { code: "vibe64_practice_effect_admission_required" }));
  allowed = false;
  await assert.rejects(() => execute("vibe64.test.practice-write"), { code: "actual_host_denied" });
  assert.deepEqual(calls, ["authorize", "fresh-grant", "effect", "authorize"]);
  allowed = true;
  assert.equal((await execute("vibe64.sessions.create")).sessionId, `training-${learningAttempt}`);
  assert.equal(openerBarriers, 1);
  active = false;
  await assert.rejects(() => execute("vibe64.test.practice-write"), { code: "saved_attempt_ended" });
  assert.equal(openerBarriers, 1);
});
