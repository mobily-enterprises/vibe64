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
