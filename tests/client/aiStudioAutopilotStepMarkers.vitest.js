import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_STEP_DONE_MARKER_END,
  AUTOPILOT_STEP_DONE_MARKER_START,
  latestStepDoneMarker,
  stepDoneMarkerInstruction
} from "../../src/lib/aiStudioAutopilotStepMarkers.js";

function stepMarker(payload) {
  return [
    AUTOPILOT_STEP_DONE_MARKER_START,
    JSON.stringify(payload),
    AUTOPILOT_STEP_DONE_MARKER_END
  ].join("\n");
}

describe("aiStudioAutopilotStepMarkers", () => {
  it("extracts the latest matching completion marker", () => {
    const output = [
      stepMarker({
        actionId: "make_plan",
        requestId: "old-request",
        stepId: "plan_made"
      }),
      "\nterminal output\n",
      stepMarker({
        actionId: "make_plan",
        requestId: "new-request",
        stepId: "plan_made"
      })
    ].join("");

    expect(latestStepDoneMarker(output, {
      actionId: "make_plan",
      stepId: "plan_made"
    })).toEqual({
      actionId: "make_plan",
      requestId: "new-request",
      stepId: "plan_made"
    });
  });

  it("ignores ansi controls, invalid json, incomplete blocks, and unrelated requests", () => {
    const output = [
      "\u001b[32m",
      stepMarker({
        actionId: "make_plan",
        requestId: "other-request",
        stepId: "plan_made"
      }),
      "\u001b[0m",
      AUTOPILOT_STEP_DONE_MARKER_START,
      "{not json}",
      AUTOPILOT_STEP_DONE_MARKER_END,
      AUTOPILOT_STEP_DONE_MARKER_START,
      JSON.stringify({
        actionId: "make_plan",
        requestId: "partial-request",
        stepId: "plan_made"
      }),
      stepMarker({
        actionId: "make_plan",
        requestId: "wanted-request",
        stepId: "plan_made"
      })
    ].join("\n");

    expect(latestStepDoneMarker(output, {
      actionId: "make_plan",
      requestId: "wanted-request",
      stepId: "plan_made"
    })).toEqual({
      actionId: "make_plan",
      requestId: "wanted-request",
      stepId: "plan_made"
    });
  });

  it("emits an instruction whose marker can be parsed back", () => {
    const pending = {
      actionId: "run_deslop",
      requestId: "request-123",
      stepId: "review_run"
    };

    expect(latestStepDoneMarker(stepDoneMarkerInstruction(pending), pending)).toEqual(pending);
  });

  it("parses marker ids wrapped by terminal line breaks", () => {
    const output = [
      AUTOPILOT_STEP_DONE_MARKER_START,
      "{",
      '"actionId": "update_project_knowledge",',
      '"requestId": "request-',
      '123",',
      '"stepId": "project_knowledge_',
      'updated"',
      "}",
      AUTOPILOT_STEP_DONE_MARKER_END
    ].join("\n");

    expect(latestStepDoneMarker(output, {
      actionId: "update_project_knowledge",
      requestId: "request-123",
      stepId: "project_knowledge_updated"
    })).toEqual({
      actionId: "update_project_knowledge",
      requestId: "request-123",
      stepId: "project_knowledge_updated"
    });
  });
});
