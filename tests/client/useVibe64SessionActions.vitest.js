import { describe, expect, it } from "vitest";

import {
  runActionSuccessShouldRefreshSession
} from "../../src/composables/useVibe64SessionActions.js";

describe("useVibe64SessionActions refresh ownership", () => {
  it("leaves successful action refresh to realtime", () => {
    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "prompt_ready"
      }
    }, {
      stepMachine: {
        status: "awaiting_agent_result"
      }
    })).toBe(false);

    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "prompt_ready"
      }
    }, {
      stepMachine: {
        status: "done"
      }
    })).toBe(false);

    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "saved"
      }
    }, {
      stepMachine: {
        status: "awaiting_agent_result"
      }
    })).toBe(false);
  });
});
