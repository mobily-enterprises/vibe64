import { describe, expect, it } from "vitest";

import {
  VIBE64_SESSION_CHANGED_EVENT,
  SELECTED_SESSION_STORAGE_KEY,
  vibe64ActionPath,
  vibe64ArtifactPreviewPath,
  vibe64ArtifactPreviewQueryKey,
  vibe64CodexAttachmentPath,
  vibe64ConversationLogPath,
  vibe64ConversationLogQueryKey,
  vibe64SessionQueryKey,
  vibe64SessionPath,
  vibe64SessionsQueryKey,
  commandInputFromContext
} from "../../src/lib/vibe64SessionRequestConfig.js";

describe("Vibe64 session request config", () => {
  it("uses current Vibe64 storage and route names", () => {
    expect(SELECTED_SESSION_STORAGE_KEY).toBe("vibe64:selected-session-id");
    expect(VIBE64_SESSION_CHANGED_EVENT).toBe("vibe64.session.changed");
    expect(vibe64SessionsQueryKey("home", "public")).toEqual([
      "vibe64",
      "home",
      "public",
      "sessions"
    ]);
    expect(vibe64SessionQueryKey("home", "public")).toEqual([
      "vibe64",
      "home",
      "public",
      "session"
    ]);
    expect(vibe64ArtifactPreviewQueryKey("home", "public", "2026-05-16_01:two")).toEqual([
      "vibe64",
      "home",
      "public",
      "artifact-preview",
      "2026-05-16_01%3Atwo"
    ]);
    expect(vibe64ArtifactPreviewQueryKey("home", "public", "2026-05-16_01:two", "issue report")).toEqual([
      "vibe64",
      "home",
      "public",
      "artifact-preview",
      "2026-05-16_01%3Atwo",
      "issue%20report"
    ]);
    expect(vibe64ConversationLogQueryKey("home", "public", "2026-05-16_01:two")).toEqual([
      "vibe64",
      "home",
      "public",
      "conversation-log",
      "2026-05-16_01%3Atwo"
    ]);
  });

  it("builds encoded session action and terminal support paths", () => {
    const apiPath = "/api/studio/vibe64/sessions";
    const sessionId = "2026-05-16_01:two";

    expect(vibe64SessionPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo`);
    expect(vibe64ActionPath(apiPath, sessionId, "make plan")).toBe(`${apiPath}/2026-05-16_01%3Atwo/actions/make%20plan`);
    expect(vibe64ArtifactPreviewPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/artifact-preview`);
    expect(vibe64CodexAttachmentPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/codex-attachments`);
    expect(vibe64ConversationLogPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/conversation-log`);
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
