import { describe, expect, it } from "vitest";
import {
  selectedSessionRecord
} from "../../src/composables/useVibe64SessionData.js";

describe("useVibe64SessionData selected session record", () => {
  it("prefers the selected detail record over the shallow list summary", () => {
    const detailRecord = {
      actions: [
        {
          id: "inspect"
        }
      ],
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      revision: 4,
      sessionId: "session-1"
    };
    const listSummary = {
      currentStep: "step_c",
      revision: 5,
      sessionId: "session-1"
    };

    expect(selectedSessionRecord(detailRecord, listSummary, "session-1")).toBe(detailRecord);
  });

  it("uses the list summary while the selected detail record is unavailable", () => {
    const listSummary = {
      currentStep: "step_c",
      sessionId: "session-1"
    };

    expect(selectedSessionRecord(null, listSummary, "session-1")).toBe(listSummary);
    expect(selectedSessionRecord({
      ok: false,
      sessionId: "session-1"
    }, listSummary, "session-1")).toBe(listSummary);
  });
});
