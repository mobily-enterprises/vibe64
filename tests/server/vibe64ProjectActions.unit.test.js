import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_CREATE_PROJECT,
  ACTION_REPOSITORY_REMOTE,
  ACTION_READ_ENGINEERING_SETTINGS,
  ACTION_READ_ENV,
  ACTION_READ_PROJECT_SETTINGS,
  ACTION_SAVE_ENV_USER_VALUES,
  ACTION_SAVE_COLLABORATION_SETTINGS,
  ACTION_SAVE_ENGINEERING_PROFILE,
  ACTION_SAVE_PROJECT_PROMPT_HINTS,
  ACTION_SELECT_PROJECT,
  createVibe64ProjectChangedPublisher,
  createProjectActions
} from "../../packages/vibe64-project/src/server/projectActions.js";
import { __testables, registerLearningModeReader } from "@local/vibe64-core/server/learningMode";
import { underActionPolicy, projectServiceCollaborators } from "./vibe64TestHelpers.js";
import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

const { LEARNING_MODE_PROJECT_MESSAGE, PRACTICE_PROJECT_MODE_MESSAGE } = __testables;

const localUser = { username: "local", role: "owner" };

/**
 * A project action as an authorized request runs it: for the project in its
 * URL, `catalogue` unless `context.projectSlug` names another.
 */
function featureAction(project, actionId = "") {
  const declared = createProjectActions({ project }).find((candidate) => candidate.id === actionId);
  assert.ok(declared, `Expected feature action ${actionId} to be registered.`);
  const action = underActionPolicy(declared);
  return { ...action, execute: (input, { projectSlug = "catalogue", ...context } = {}) =>
    action.execute(input, { ...context, projectSlug, vibe64Action: { user: localUser, project: { slug: projectSlug } } }) };
}

test("Env read action forwards its input", async () => {
  const calls = [];
  const project = {
    async readEnv(...args) {
      calls.push(args);
      return {
        ok: true
      };
    }
  };
  const action = featureAction(project, ACTION_READ_ENV);
  const input = {
    scope: "development"
  };

  await action.execute(input, {});

  assert.deepEqual(calls, [[{ ...input, vibe64User: localUser }]]);
});

test("project settings read action uses the Vibe64 project settings boundary", async () => {
  let calls = 0;
  const action = featureAction({
    async readSettings() {
      calls += 1;
      return {
        developmentDatabase: {
          managed: true,
          scope: "session"
        },
        ok: true
      };
    }
  }, ACTION_READ_PROJECT_SETTINGS);

  const result = await action.execute({}, {});

  assert.equal(calls, 1);
  assert.equal(result.developmentDatabase.scope, "session");
});

test("engineering settings actions preserve the selected source context", async () => {
  const calls = [];
  const project = {
    async readEngineeringSettings(input) {
      calls.push(["read", input]);
      return {
        engineering: {
          available: true,
          profile: { id: "focused.v1" }
        },
        ok: true
      };
    },
    async saveEngineeringProfile(input) {
      calls.push(["save", input]);
      return {
        engineering: {
          available: true,
          profile: { id: input.profile }
        },
        ok: true,
        projectSlug: "catalogue"
      };
    }
  };
  const read = featureAction(project, ACTION_READ_ENGINEERING_SETTINGS);
  const save = featureAction(project, ACTION_SAVE_ENGINEERING_PROFILE);
  const input = {
    profile: "durable.v1",
    sessionId: "session-a"
  };

  const readResult = await read.execute({ sessionId: input.sessionId }, {});
  const saveResult = await save.execute(input, {});
  const event = await save.events[0]({
    context: {},
    input,
    result: saveResult
  });

  assert.equal(readResult.engineering.profile.id, "focused.v1");
  assert.equal(saveResult.engineering.profile.id, "durable.v1");
  assert.deepEqual(calls, [
    ["read", { sessionId: "session-a", vibe64User: localUser }],
    ["save", { ...input, vibe64User: localUser }]
  ]);
  assert.equal(event.realtime.event, "vibe64.project.changed");
  assert.deepEqual(event.realtime.payload, { projectSlug: "catalogue" });
});

test("project mutations publish first-class action events", async () => {
  const action = featureAction({
    async createDevelopProject() {
      return {
        ok: true,
        project: {
          projectRoot: "/srv/projects/catalogue",
          slug: "catalogue"
        }
      };
    }
  }, ACTION_CREATE_PROJECT);
  const result = await action.execute({ slug: "catalogue" }, {});
  const event = await action.events[0]({
    context: {},
    input: { slug: "catalogue" },
    result
  });

  assert.equal(event.type, "entity.changed");
  assert.equal(event.source, "vibe64");
  assert.equal(event.entity, "project");
  assert.equal(event.operation, "created");
  assert.equal(event.entityId, "catalogue");
  assert.equal(event.realtime.event, "vibe64.project.changed");
  assert.equal(event.realtime.audience, "all_clients");
  assert.deepEqual(event.realtime.payload, {
    projectSlug: "catalogue"
  });
});

test("collaboration and prompt-hint mutations publish project realtime invalidation", async () => {
  const project = {
    async saveCollaborationSettings() {
      return {
        collaboration: { tone: "direct" },
        ok: true,
        projectSlug: "catalogue"
      };
    },
    async savePromptHints() {
      return {
        ok: true,
        projectSlug: "catalogue",
        promptHints: { canEdit: true, enabled: false }
      };
    }
  };

  for (const [actionId, input] of [
    [ACTION_SAVE_COLLABORATION_SETTINGS, { tone: "direct" }],
    [ACTION_SAVE_PROJECT_PROMPT_HINTS, { promptHints: false }]
  ]) {
    const action = featureAction(project, actionId);
    const result = await action.execute(input, {});
    const event = await action.events[0]({ context: {}, input, result });

    assert.equal(event.type, "entity.changed");
    assert.equal(event.entity, "project");
    assert.equal(event.entityId, "catalogue");
    assert.equal(event.realtime.event, "vibe64.project.changed");
    assert.deepEqual(event.realtime.payload, {
      projectSlug: "catalogue"
    });
  }
});

test("Env save action forwards user-owned values and publishes a project refresh", async () => {
  const calls = [];
  const project = {
    async saveEnvUserValues(...args) {
      calls.push(args);
      return {
        ok: true
      };
    }
  };
  const action = featureAction(project, ACTION_SAVE_ENV_USER_VALUES);
  const input = {
    records: [{
      key: "API_URL",
      value: "https://example.test"
    }],
    scope: "development"
  };

  const result = await action.execute(input, {});
  const event = await action.events[0]({ context: {}, input, result });

  assert.deepEqual(calls, [[{ ...input, vibe64User: localUser }]]);
  assert.equal(event.realtime.event, "vibe64.project.changed");
  assert.equal(event.entityId, "projects");
});

test("project change publisher emits the shared project refresh contract", async () => {
  const published = [];
  const publishProjectChanged = createVibe64ProjectChangedPublisher({
    events: {
      async publish(event) {
        published.push(event);
        return event;
      }
    }
  });

  await publishProjectChanged({ projectSlug: "catalogue" }, {
    actorId: "17",
    operation: "deleted",
    reason: "project-archived"
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].actorId, "17");
  assert.equal(published[0].entityId, "projects");
  assert.equal(published[0].realtime.event, "vibe64.project.changed");
  assert.deepEqual(published[0].realtime.payload, {
    reason: "project-archived"
  });
});

test("issue comment notifications retain project scope and omit comment contents", async () => {
  const publish = createVibe64ProjectChangedPublisher({ events: { publish: async (event) => event } });
  const event = await publish({
    projectSlug: "catalogue",
    originId: "tab:writer",
    issueComment: { number: 42, id: "comment-7", author: "contributor", body: "Private comment" }
  }, { reason: "github-issue-commented" });
  assert.equal(event.entityId, "catalogue");
  assert.equal(event.realtime.event, "vibe64.project.changed");
  assert.deepEqual(event.realtime.payload, {
    projectSlug: "catalogue",
    originId: "tab:writer",
    issueComment: { number: 42, id: "comment-7", author: "contributor" },
    reason: "github-issue-commented"
  });
});


test("remote actions preserve review inputs and only invalidate projects after mutations", async () => {
  const input = { action: "pull", review: { branch: "trunk", head: "head", configId: "configuration", upstreamCommit: "remote" }, merge: true };
  const action = featureAction({ repositoryRemote: async (received) => {
    assert.deepEqual(received, { ...input, vibe64User: localUser });
    return { ok: true, projectSlug: "local", remoteChanged: true };
  } }, ACTION_REPOSITORY_REMOTE);
  const parsed = action.input.schema.patch(input);
  assert.deepEqual(parsed.errors, {});
  assert.deepEqual(parsed.validatedObject, input);
  const result = await action.execute(parsed.validatedObject);
  const event = await action.events[0]({ context: {}, input, result });
  assert.deepEqual(event.realtime.payload, { projectSlug: "local", action: "pull" });
  assert.equal(await action.events[0]({ context: {}, input: { action: "fetch" }, result: { ok: true, remoteChanged: false } }), null);
});


test("repository policy changes carry only their public setting on the existing project event", async () => {
  const publish = createVibe64ProjectChangedPublisher({ events: { publish: async (event) => event } });
  const event = await publish({ projectSlug: "project-a", repositoryWorkflow: { requirePullRequest: true, privatePath: "/private/settings" } }, { reason: "repository-workflow-settings" });
  assert.deepEqual(event.realtime.payload, {
    projectSlug: "project-a", repositoryWorkflow: { requirePullRequest: true }, reason: "repository-workflow-settings"
  });
});

test("Learn mode creates no projects and selects only the practice project; Develop never selects it", async (t) => {
  let releaseMode = () => {};
  t.after(() => releaseMode());
  const calls = [];
  const project = createService({ ...projectServiceCollaborators(), logger: silentLogger, projectContext: {
    createWorkspaceProject: input => { calls.push(["create", input.name]); return { ok: true }; },
    selectWorkspaceProject: input => { calls.push(["select", input.slug]); return { ok: true }; }
  } });
  const create = featureAction(project, ACTION_CREATE_PROJECT);
  const selectAction = featureAction(project, ACTION_SELECT_PROJECT);
  // A selection posts to the chosen project's own URL.
  const select = slug => selectAction.execute({ slug }, { projectSlug: slug });
  const practiceSlug = "training-12345678123442348234123456789abc";
  let mode = { on: true, currentAttemptId: "12345678-1234-4234-8234-123456789abc", lessonCode: "INTRO-01", practiceSlug };
  releaseMode = registerLearningModeReader(() => mode);
  const learn = { code: "vibe64_learning_mode_project", statusCode: 403, message: LEARNING_MODE_PROJECT_MESSAGE };
  await assert.rejects(create.execute({ name: "shop" }), learn);
  await assert.rejects(select("shop"), learn);
  // Learn mode never lets another project's URL select the practice project.
  await assert.rejects(selectAction.execute({ slug: practiceSlug }, { projectSlug: "shop" }),
    { code: "vibe64_action_project_mismatch", statusCode: 403 });
  await select(practiceSlug);
  mode = { ...mode, on: false };
  await assert.rejects(select(practiceSlug),
    { code: "vibe64_learning_mode_project", statusCode: 403, message: PRACTICE_PROJECT_MODE_MESSAGE });
  await create.execute({ name: "shop" });
  await select("shop");
  assert.deepEqual(calls, [["select", practiceSlug], ["create", "shop"], ["select", "shop"]]);
});

test("project actions hide secret reveal, Env download and undescribed actions from Colleague", () => {
  const actions = createProjectActions({ project: {} });
  for (const id of ["vibe64.project.env.secret.reveal", "vibe64.project.env.download"]) {
    const action = actions.find((candidate) => candidate.id === id);
    assert.equal(action.extensions.assistant.exclude, true, id);
    assert.equal(action.extensions.vibe64.ownerRequired, true, id);
  }
  for (const action of actions.filter(({ extensions }) => !extensions.assistant.exclude)) {
    assert.ok(action.extensions.assistant.description?.trim(), action.id);
  }
});
