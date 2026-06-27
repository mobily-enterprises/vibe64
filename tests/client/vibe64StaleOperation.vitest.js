import { describe, expect, it } from "vitest";

import {
  isVibe64StaleOperation,
  responseOperationOutcome,
  responseRefreshRecommended,
  vibe64StaleOperationResult
} from "../../src/lib/vibe64StaleOperation.js";

describe("vibe64 stale operation classification", () => {
  it("recognizes refresh metadata carried in HTTP error details", () => {
    const error = {
      code: "vibe64_action_disabled",
      details: {
        operationOutcome: "state_rejected",
        refreshRecommended: true
      },
      status: 409
    };

    expect(isVibe64StaleOperation(error)).toBe(true);
    expect(responseOperationOutcome(error)).toBe("state_rejected");
    expect(responseRefreshRecommended(error)).toBe(true);
    expect(vibe64StaleOperationResult(error)).toMatchObject({
      code: "vibe64_action_disabled",
      ok: false,
      operationOutcome: "state_rejected",
      refreshRecommended: true,
      stale: true,
      status: 409
    });
  });

  it("recognizes older code-only stale 409s", () => {
    expect(isVibe64StaleOperation({
      code: "vibe64_step_input_state_changed",
      status: 409
    })).toBe(true);

    expect(vibe64StaleOperationResult({
      code: "vibe64_step_input_state_changed",
      status: 409
    })).toMatchObject({
      operationOutcome: "stale_operation",
      refreshRecommended: true
    });
  });

  it("does not classify ordinary request failures as stale", () => {
    expect(isVibe64StaleOperation({
      code: "vibe64_terminal_request_failed",
      status: 400
    })).toBe(false);
  });
});
