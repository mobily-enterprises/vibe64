import { describe, expect, it } from "vitest";

import {
  runActionSuccessShouldRefreshSession
} from "../../src/composables/useVibe64SessionActions.js";

describe("useVibe64SessionActions refresh ownership", () => {
  it("does not refresh prompt-ready actions after realtime already marked the session awaiting Codex", () => {
    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "prompt_ready"
      }
    }, {
      stepMachine: {
        status: "awaiting_agent_result"
      }
    })).toBe(false);
  });

  it("keeps the action-success refresh when realtime has not already moved the session", () => {
    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "prompt_ready"
      }
    }, {
      stepMachine: {
        status: "done"
      }
    })).toBe(true);

    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "saved"
      }
    }, {
      stepMachine: {
        status: "awaiting_agent_result"
      }
    })).toBe(true);
  });
});
