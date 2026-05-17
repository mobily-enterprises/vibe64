import { describe, expect, it } from "vitest";

import {
  SELECTED_SESSION_STORAGE_KEY,
  aiStudioActionPath,
  aiStudioArtifactsPath,
  aiStudioArtifactsQueryKey,
  aiStudioCodexAttachmentPath,
  aiStudioCodexPromptHandoffPath,
  aiStudioCodexThreadPath,
  aiStudioSessionPath,
  aiStudioSessionsQueryKey,
  commandInputFromContext
} from "../../src/lib/aiStudioSessionRequestConfig.js";

describe("AI Studio session request config", () => {
  it("uses current AI Studio storage and route names", () => {
    expect(SELECTED_SESSION_STORAGE_KEY).toBe("ai-studio:selected-session-id");
    expect(aiStudioSessionsQueryKey("home", "public")).toEqual([
      "ai-studio",
      "home",
      "public",
      "sessions"
    ]);
    expect(aiStudioArtifactsQueryKey("home", "public", "2026-05-16_01:two")).toEqual([
      "ai-studio",
      "home",
      "public",
      "session-artifacts",
      "2026-05-16_01%3Atwo"
    ]);
  });

  it("builds encoded session action and terminal support paths", () => {
    const apiPath = "/api/studio/ai-studio/sessions";
    const sessionId = "2026-05-16_01:two";

    expect(aiStudioSessionPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo`);
    expect(aiStudioActionPath(apiPath, sessionId, "make plan")).toBe(`${apiPath}/2026-05-16_01%3Atwo/actions/make%20plan`);
    expect(aiStudioArtifactsPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/artifacts`);
    expect(aiStudioCodexPromptHandoffPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/codex-prompt-handoff`);
    expect(aiStudioCodexAttachmentPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/codex-attachments`);
    expect(aiStudioCodexThreadPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/codex-thread`);
  });

  it("normalizes command input payloads from command context", () => {
    expect(commandInputFromContext({
      input: {
        issueRequest: "Add reports"
      }
    })).toEqual({
      issueRequest: "Add reports"
    });
    expect(commandInputFromContext({
      input: ["not", "plain"]
    })).toEqual({});
  });
});
