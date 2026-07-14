import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_INSPECT_SESSION,
  ACTION_RUN_SESSION_ACTION,
  ACTION_UPDATE_CURRENT_SESSION,
  featureActions
} from "../../packages/vibe64-sessions/src/server/actions.js";

function featureAction(actionId = "") {
  const action = featureActions.find((candidate) => candidate.id === actionId);
  assert.ok(action, `Expected feature action ${actionId} to be registered.`);
  return action;
}

test("session action command omits absent agent settings", async () => {
  const action = featureAction(ACTION_RUN_SESSION_ACTION);
  const calls = [];

  await action.execute({
    actionId: "accept_review",
    input: {},
    sessionId: "session-1"
  }, {}, {
    featureService: {
      async runSessionAction(...args) {
        calls.push(args);
        return {
          ok: true
        };
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "session-1",
    "accept_review",
    {
      composerSubmissionId: "",
      displayInput: null,
      originId: "",
      vibe64User: null
    }
  ]);
  assert.equal(Object.hasOwn(calls[0][2], "agentSettings"), false);
});

test("session inspect action forwards composer menu and runtime enrichment options", async () => {
  const action = featureAction(ACTION_INSPECT_SESSION);
  const calls = [];

  await action.execute({
    includeComposerMenu: "1",
    includeRuntimeEnrichment: "1",
    projectSlug: "compas-next",
    sessionId: "session-1",
    vibe64User: {
      email: "owner@example.com"
    }
  }, {}, {
    featureService: {
      async inspectSession(...args) {
        calls.push(args);
        return {
          ok: true
        };
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "session-1",
    {
      includeComposerMenu: "1",
      includeRuntimeEnrichment: "1",
      projectSlug: "compas-next",
      vibe64User: {
        email: "owner@example.com"
      }
    }
  ]);
});

test("current session action forwards the selected session id", async () => {
  const action = featureAction(ACTION_UPDATE_CURRENT_SESSION);
  const calls = [];

  await action.execute({
    sessionId: "session-2"
  }, {}, {
    featureService: {
      async updateCurrentSession(...args) {
        calls.push(args);
        return {
          ok: true
        };
      }
    }
  });

  assert.deepEqual(calls, [["session-2"]]);
});

test("session action command forwards object agent settings", async () => {
  const action = featureAction(ACTION_RUN_SESSION_ACTION);
  const calls = [];
  const agentSettings = {
    model: "gpt-test"
  };

  await action.execute({
    actionId: "accept_review",
    agentSettings,
    input: {},
    sessionId: "session-1"
  }, {}, {
    featureService: {
      async runSessionAction(...args) {
        calls.push(args);
        return {
          ok: true
        };
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "session-1",
    "accept_review",
    {
      agentSettings,
      composerSubmissionId: "",
      displayInput: null,
      originId: "",
      vibe64User: null
    }
  ]);
});
