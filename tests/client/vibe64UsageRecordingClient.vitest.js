import { describe, expect, it } from "vitest";
import { effectScope, isRef } from "vue";

import {
  USAGE_RECORDING_API_SUFFIX,
  Vibe64UsageRecordDialog,
  Vibe64UsageRecordingIndicator,
  useVibe64UsageRecording
} from "@local/vibe64-usage-recording/client";

// The usage view, Preview controls and session layout build on these names.
describe("usage recording client entry", () => {
  it("exports the indicator, the Record dialog and the session composable", () => {
    expect(USAGE_RECORDING_API_SUFFIX).toBe("/vibe64/usage-recordings");
    expect(Vibe64UsageRecordingIndicator.props.sessionId.required).toBe(true);
    expect(Vibe64UsageRecordingIndicator.emits).toEqual(["open-usage"]);
    expect(Object.keys(Vibe64UsageRecordDialog.props).sort()).toEqual(["modelValue", "sessionId"]);
    expect(Vibe64UsageRecordDialog.emits).toEqual(["update:modelValue", "started", "select-preview"]);
  });

  it("returns the session recording state and operations", async () => {
    const scope = effectScope();
    const state = scope.run(() => useVibe64UsageRecording({ sessionId: () => "session-1" }));
    expect(Object.keys(state).sort()).toEqual([
      "active", "dismiss", "elapsedMs", "error", "loading", "readTargets", "recordInteraction", "recording", "refresh", "start", "stop"
    ]);
    for (const name of ["recording", "active", "elapsedMs", "loading", "error"]) expect(isRef(state[name])).toBe(true);
    for (const name of ["refresh", "readTargets", "start", "stop", "dismiss", "recordInteraction"]) {
      expect(state[name]).toBeTypeOf("function");
    }
    expect(state.recording.value).toBe(null);
    expect(state.active.value).toBe(false);
    scope.stop();
  });
});
