import assert from "node:assert/strict";
import test from "node:test";
import { createSessionsService } from "./vibe64SessionsTestHelpers.js";
import { ACTION_START_SESSION_PULL_REQUEST, createSessionActions } from "../../packages/vibe64-sessions/src/server/sessionActions.js";

// The held answer comes after two seconds; a request still waiting a second after that waited for the work.
const ANSWER_MS = 3_000;

async function within(promise, ms, message) {
  let timer;
  const late = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The sessions service over one session whose pull request is created once the test lets it finish. */
function creatingWorld() {
  const session = { agentRuns: [], sessionId: "session-1", status: "active", metadata: {} };
  const runtime = {
    async getSessionWithoutSource() { return session; },
    store: {}
  };
  const finish = Promise.withResolvers();
  const state = { creations: 0, inputs: [] };
  const service = createSessionsService({
    project: {
      async readCurrentProject() { return { slug: "test-project" }; },
      async createRuntime() { return runtime; },
      createRuntimeWithoutSource() { return runtime; }
    },
    terminals: {
      async createSessionPullRequest(_sessionId, input) {
        state.creations += 1;
        state.inputs.push(input);
        await input.onRepositoryWriteAcquired?.();
        await finish.promise;
        return { ok: true, pullRequest: { number: 12, title: input.title } };
      }
    }
  });
  return { finish: () => finish.resolve(), service, state };
}

const CREATE = Object.freeze({
  destinationReview: { sessionId: "session-1", mode: "github", repository: "example/project", branch: "main" },
  requestId: "11111111-1111-4111-8111-111111111111",
  title: "A requested change",
  vibe64User: { username: "owner", role: "owner" }
});

test("a pull request the dialog names answers within two seconds while it is created, and its repeat joins it, then reads its outcome",
  async () => {
    const world = creatingWorld();
    const first = await within(world.service.startSessionPullRequest("session-1", CREATE), ANSWER_MS,
      "Create pull request waited for its Save and GitHub");
    assert.deepEqual(first, { ok: true, creating: true, requestId: CREATE.requestId, waitingFor: "creating" });
    const repeated = await within(world.service.startSessionPullRequest("session-1", CREATE), ANSWER_MS,
      "The repeat waited for the creation");
    assert.equal(repeated.creating, true, JSON.stringify(repeated));
    assert.equal(world.state.creations, 1, "a repeat never creates a second time");
    world.finish();
    const created = await within(world.service.startSessionPullRequest("session-1", CREATE), ANSWER_MS,
      "The repeat after the creation ended waited");
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.pullRequest.number, 12);
    assert.equal(world.state.creations, 1);
    assert.equal(world.state.inputs[0].title, CREATE.title);
    assert.equal(world.state.inputs[0].vibe64User.username, "owner");
  });

test("a pull request created within two seconds answers with its result, as before", async () => {
  const world = creatingWorld();
  world.finish();
  const created = await world.service.startSessionPullRequest("session-1", {
    ...CREATE,
    requestId: "22222222-2222-4222-8222-222222222222"
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.pullRequest.number, 12);
});

test("the dialog's create is its own action, which the assistant's tools do not offer", () => {
  const start = createSessionActions({ sessions: {} }).find(action => action.id === ACTION_START_SESSION_PULL_REQUEST);
  assert.ok(start, ACTION_START_SESSION_PULL_REQUEST);
  assert.equal(start.extensions.assistant.exclude, true);
});
