import { describe, expect, it, vi } from "vitest";
import { createApp, effectScope, isRef } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";

vi.mock("/src/composables/useVibe64ProjectScope.js", async () => {
  const { ref } = await import("vue");
  return { useVibe64ProjectSlug: () => ref("fixture") };
});
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ api: (suffix) => `/api${suffix}` }) }));

import {
  USAGE_RECORDING_API_SUFFIX,
  Vibe64UsageRecordDialog,
  Vibe64UsageRecordingIndicator,
  Vibe64UsageRecordingSummary,
  useVibe64UsageRecording
} from "@local/vibe64-usage-recording/client";

// The usage view, Preview controls and session layout build on these names.
describe("usage recording client entry", () => {
  it("exports the indicator, the Record dialog, the recording summary and the session composable", () => {
    expect(USAGE_RECORDING_API_SUFFIX).toBe("/vibe64/usage-recordings");
    expect(Vibe64UsageRecordingIndicator.props.sessionId.required).toBe(true);
    expect(Vibe64UsageRecordingIndicator.emits).toEqual(["open-usage"]);
    expect(Object.keys(Vibe64UsageRecordDialog.props).sort()).toEqual(["modelValue", "sessionId"]);
    expect(Vibe64UsageRecordDialog.emits).toEqual(["update:modelValue", "started", "select-preview"]);
    expect(Object.keys(Vibe64UsageRecordingSummary.props).sort()).toEqual(["recording", "sessionId"]);
    expect(Vibe64UsageRecordingSummary.emits).toEqual(["deleted"]);
  });

  it("returns the session recording state and operations", async () => {
    const originalClient = getHttpWebClient();
    configureHttpWebClient({ request: () => new Promise(() => {}) });
    const app = createApp({}).use(VueQueryPlugin, { queryClient: new QueryClient() });
    const scope = effectScope();
    const state = app.runWithContext(() => scope.run(() => useVibe64UsageRecording({ sessionId: () => "session-1" })));
    expect(Object.keys(state).sort()).toEqual([
      "active", "dismiss", "elapsedMs", "error", "loading", "readTargets", "recordInteraction", "recording", "refresh", "remove", "start", "stop"
    ]);
    for (const name of ["recording", "active", "elapsedMs", "loading", "error"]) expect(isRef(state[name])).toBe(true);
    for (const name of ["refresh", "readTargets", "start", "stop", "dismiss", "remove", "recordInteraction"]) {
      expect(state[name]).toBeTypeOf("function");
    }
    expect(state.recording.value).toBe(null);
    expect(state.active.value).toBe(false);
    scope.stop();
    configureHttpWebClient(originalClient);
  });
});
