import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_READ_PROJECT_TYPE,
  featureActions
} from "../../packages/vibe64-project/src/server/actions.js";

function featureAction(actionId = "") {
  const action = featureActions.find((candidate) => candidate.id === actionId);
  assert.ok(action, `Expected feature action ${actionId} to be registered.`);
  return action;
}

test("project type read action forwards source selection input", async () => {
  const action = featureAction(ACTION_READ_PROJECT_TYPE);
  const calls = [];
  const input = {
    sessionId: "2026-06-23_10-58-14"
  };

  await action.execute(input, {}, {
    featureService: {
      async readProjectType(...args) {
        calls.push(args);
        return {
          ok: true
        };
      }
    }
  });

  assert.deepEqual(calls, [[input]]);
});
