import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ActionProvider, createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import {
  PROJECT_OPERATION,
  PROJECT_OWNER_OPERATION,
  createVibe64ActionPolicy,
  WORKSPACE_OPERATION,
  WORKSPACE_OWNER_OPERATION
} from "@local/vibe64-core/server/actionContext";
import { Vibe64ActionPolicyProvider } from "@local/vibe64-core/server/Vibe64ActionPolicyProvider";
import { registerLearningModeReader } from "@local/vibe64-core/server/learningMode";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { configureStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { registerTeamAiReadiness } from "@local/vibe64-core/server/teamAiGate";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";

const OWNER = Object.freeze({ uid: 1, username: "owner", role: "owner" });
const MEMBER = Object.freeze({ uid: 42, username: "member", role: "member" });
const OWNER_REQUIRED = { code: "vibe64_owner_required", statusCode: 403, message: "Only the workspace owner can perform this operation." };
const PRACTICE_SLUG = "training-12345678123442348234123456789abc";

// An operation that reports the input it received and the project it ran in.
function operation(id, vibe64, fields = { text: { type: "string", required: true } }) {
  return {
    id, version: 1, kind: "command", channels: ["api", "automation"], surfaces: ["app"],
    input: { schema: createSchema(fields), mode: "create" }, output: null,
    extensions: vibe64 ? { assistant: { exclude: true }, vibe64 } : { assistant: { exclude: true } },
    execute: (input, context) => ({ input, project: currentProjectRequestContext()?.slug ?? null, channel: context.channel })
  };
}

// Runs a definition under the policy as the pipeline does, after the kernel's checks.
function runUnderPolicy(definition, input, context = {}) {
  return createVibe64ActionPolicy({ localhostCheckBypassed: false }).execute({
    definition, input, context, run: (policyInput, policyContext) => definition.execute(policyInput, policyContext)
  });
}

const resolvedFor = (user, slug = "alpha") => ({ vibe64Action: { user, project: { slug, targetRoot: `/projects/${slug}` } } });

test("the policy registers an operation without the acting user and, in a project, with its optional project slug", () => {
  const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
  const withUser = { text: { type: "string", required: true }, vibe64User: { type: "object", required: false } };
  actions.register({ contributorId: "policy-test", domain: "test", actions: [
    operation("vibe64.test.project", PROJECT_OPERATION, withUser),
    operation("vibe64.test.workspace", WORKSPACE_OPERATION, withUser),
    operation("other.test.plain", null)
  ] });
  const fields = (id) => actions.getDefinition(id).input.schema.getFieldDefinitions();
  assert.deepEqual(Object.keys(fields("vibe64.test.project")), ["text", "projectSlug"]);
  assert.deepEqual(fields("vibe64.test.project").projectSlug, { type: "string", noTrim: false, minLength: 1, required: false });
  assert.deepEqual(Object.keys(fields("vibe64.test.workspace")), ["text"]);
  assert.deepEqual(Object.keys(fields("other.test.plain")), ["text"]);
  assert.equal(actions.getDefinition("vibe64.test.project").input.mode, "create");
  assert.deepEqual(actions.getDefinition("vibe64.test.project").extensions,
    { assistant: { exclude: true }, vibe64: { projectScoped: true, ownerRequired: false, allowDeleting: false } });
});

test("the scopes a definition declares are the four combinations of project and owner", () => {
  assert.deepEqual(
    [PROJECT_OPERATION, PROJECT_OWNER_OPERATION, WORKSPACE_OPERATION, WORKSPACE_OWNER_OPERATION],
    [
      { projectScoped: true, ownerRequired: false, allowDeleting: false },
      { projectScoped: true, ownerRequired: true, allowDeleting: false },
      { projectScoped: false, ownerRequired: false, allowDeleting: false },
      { projectScoped: false, ownerRequired: true, allowDeleting: false }
    ]
  );
  for (const scope of [PROJECT_OPERATION, PROJECT_OWNER_OPERATION, WORKSPACE_OPERATION, WORKSPACE_OWNER_OPERATION]) {
    assert.equal(Object.isFrozen(scope), true);
  }
});

test("an action without a Vibe64 scope runs as declared, with its input and context untouched", async () => {
  const definition = operation("other.test.plain", null);
  const input = { text: "hello", vibe64User: { role: "owner" }, projectSlug: "alpha" };
  const context = { channel: "automation" };
  const result = await runUnderPolicy(definition, input, context);
  assert.equal(result.input, input);
  assert.equal(result.project, null);
});

test("transport never supplies the acting user, and a project slug reaches only an operation that declares it", async () => {
  const forged = { username: "forged", role: "owner" };
  const plain = await runUnderPolicy(operation("vibe64.test.project", PROJECT_OPERATION),
    { text: "hello", projectSlug: "alpha", vibe64User: forged }, resolvedFor(MEMBER));
  assert.deepEqual(plain.input, { text: "hello", vibe64User: MEMBER });
  assert.equal(plain.project, "alpha");

  const declaring = operation("vibe64.test.declared", PROJECT_OPERATION,
    { text: { type: "string", required: true }, projectSlug: { type: "string", required: true } });
  const declared = await runUnderPolicy(declaring, { text: "hello", projectSlug: "alpha", vibe64User: forged }, resolvedFor(MEMBER));
  assert.deepEqual(declared.input, { text: "hello", vibe64User: MEMBER, projectSlug: "alpha" });

  const workspace = await runUnderPolicy(operation("vibe64.test.workspace", WORKSPACE_OPERATION),
    { text: "hello", projectSlug: "alpha", vibe64User: forged }, {});
  assert.deepEqual(workspace.input, { text: "hello" }, "without an authenticated user the input carries none");
  assert.equal(workspace.project, null);
});

test("owner operations refuse every other person with today's message", async () => {
  for (const scope of [PROJECT_OWNER_OPERATION, WORKSPACE_OWNER_OPERATION]) {
    const definition = operation("vibe64.test.owner", scope);
    await assert.rejects(runUnderPolicy(definition, { text: "hello", projectSlug: "alpha" }, resolvedFor(MEMBER)), OWNER_REQUIRED);
    await assert.rejects(runUnderPolicy(definition, { text: "hello", projectSlug: "alpha", vibe64User: OWNER }, {}), OWNER_REQUIRED);
    const result = await runUnderPolicy(definition, { text: "hello", projectSlug: "alpha" }, resolvedFor(OWNER));
    assert.deepEqual(result.input, { text: "hello", vibe64User: OWNER });
    assert.equal(result.project, scope.projectScoped ? "alpha" : null);
  }
});

test("a project operation refuses a slug other than its URL's or its authorized project's, with today's messages", async () => {
  const definition = operation("vibe64.test.project", PROJECT_OPERATION);
  await assert.rejects(runUnderPolicy(definition, { text: "hello", projectSlug: "beta" },
    { ...resolvedFor(MEMBER), requestMeta: { request: { params: { slug: "alpha" } } } }),
  { code: "vibe64_action_project_mismatch", statusCode: 403, message: "The operation must target the project in its URL." });
  await assert.rejects(runUnderPolicy(definition, { text: "hello", projectSlug: "beta" }, resolvedFor(MEMBER, "alpha")),
    { code: "vibe64_action_authorized_project_mismatch", statusCode: 403, message: "The authorized project does not match this operation." });
  const routed = await runUnderPolicy(definition, { text: "hello" },
    { ...resolvedFor(MEMBER), requestMeta: { request: { params: { slug: "alpha" } } } });
  assert.equal(routed.project, "alpha", "the URL's project is the operation's");
});

test("a standalone local owner runs a project owner operation, and nobody else does", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    const targetRoot = path.join(projectContext.projectsRoot, slug);
    const configure = (projectCatalogEnabled) => configureStudioProjectContext({
      explicitTargetRoot: targetRoot, explicitSystemRoot: path.join(projectContext.projectsRoot, "state"),
      explicitManagedSourceRoot: path.join(projectContext.projectsRoot, "sessions"),
      runtimeProfile: { local: !projectCatalogEnabled, projectCatalogEnabled, singleTargetRoot: targetRoot }, env: {}
    });
    const definition = operation("vibe64.test.owner", PROJECT_OWNER_OPERATION);
    const local = { ip: "127.0.0.1", headers: { host: "localhost", origin: "http://localhost" } };
    const run = (request) => runUnderPolicy(definition, { text: "hello", projectSlug: slug }, { requestMeta: { request } });
    try {
      configure(false);
      const result = await run(local);
      assert.deepEqual(result.input, { text: "hello" }, "the local owner has no account to forward");
      assert.equal(result.project, slug);
      await assert.rejects(run({ ...local, headers: { ...local.headers, origin: "https://foreign.example" } }), OWNER_REQUIRED);
      await assert.rejects(run({ ...local, ip: "198.51.100.9" }), OWNER_REQUIRED);
      await assert.rejects(runUnderPolicy(definition, { text: "hello", projectSlug: slug }, {}), OWNER_REQUIRED,
        "requestless work is never the local owner");
      configure(true);
      await assert.rejects(run(local), OWNER_REQUIRED, "a catalogue of projects has no local owner");
    } finally {
      configureStudioProjectContext({ env: process.env });
    }
  });
});

test("Colleague opens only the projects its thread allows, and only once team AI allows the person, with today's messages", async (t) => {
  let mode = { on: false, currentAttemptId: "", lessonCode: "", practiceSlug: PRACTICE_SLUG };
  const releaseMode = registerLearningModeReader(() => mode);
  let teamAiReady = true;
  const releaseReadiness = registerTeamAiReadiness(async () => teamAiReady);
  t.after(() => {
    releaseMode();
    releaseReadiness();
  });
  const definition = operation("vibe64.test.project", PROJECT_OPERATION);
  const open = (projectSlug, thread) => runUnderPolicy(definition, { text: "hello", projectSlug },
    { colleague: thread ? { thread } : {}, requestMeta: { request: { vibe64User: MEMBER } } });
  await assert.rejects(open(PRACTICE_SLUG), { code: "vibe64_learning_mode_project", statusCode: 403,
    message: "This is a practice project. Press L to switch to Learn." });
  mode = { ...mode, on: true, currentAttemptId: "12345678-1234-4234-8234-123456789abc" };
  await assert.rejects(open("alpha"), { code: "vibe64_learning_mode_project", statusCode: 403,
    message: "You're in Learn mode. Press L to go back to your projects.", details: { practiceSlug: PRACTICE_SLUG } });
  await assert.rejects(open("alpha", "learn"), { message: "You're in Learn mode. Press L to go back to your projects." });
  mode = { ...mode, on: false };
  teamAiReady = false;
  await assert.rejects(open("alpha", "develop"), { code: "vibe64_team_ai_required", statusCode: 403 });
  // A host contributor that resolved the project applied both gates already.
  const resolved = await runUnderPolicy(definition, { text: "hello", projectSlug: PRACTICE_SLUG },
    { colleague: { thread: "develop" }, ...resolvedFor(MEMBER, PRACTICE_SLUG) });
  assert.equal(resolved.project, PRACTICE_SLUG);
});

test("Vibe64ActionPolicyProvider supplies the policy to the action catalogue as runtime.actions.policy", async () => {
  let catalogue;
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.env": {}, "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, Vibe64ActionPolicyProvider, defineProvider({
      id: "policy-test.actions",
      requires: { actions: "runtime.actions" },
      setup({ actions }) {
        catalogue = actions;
        actions.register({ contributorId: "policy-test", domain: "test", actions: [operation("vibe64.test.project", PROJECT_OPERATION)] });
        return {};
      }
    })]
  });
  await runtime.start();
  try {
    assert.deepEqual(Vibe64ActionPolicyProvider.provides, { policy: "runtime.actions.policy" });
    assert.deepEqual(Object.keys(catalogue.getDefinition("vibe64.test.project").input.schema.getFieldDefinitions()), ["text", "projectSlug"]);
    const result = await catalogue.execute({ actionId: "vibe64.test.project", input: { text: "hello", projectSlug: "alpha" },
      context: { channel: "automation", surface: "app", ...resolvedFor(OWNER) } });
    assert.deepEqual(result, { input: { text: "hello", vibe64User: OWNER }, project: "alpha", channel: "automation" });
  } finally {
    await runtime.shutdown();
  }
});
