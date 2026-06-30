import { describe, expect, it } from "vitest";

import {
  VIBE64_COMPOSER_CHANGED_EVENT,
  VIBE64_SESSION_CHANGED_EVENT,
  SELECTED_SESSION_STORAGE_KEY,
  selectedSessionStorageKey,
  vibe64ActionPath,
  vibe64ArtifactPreviewPath,
  vibe64ArtifactPreviewQueryKey,
  vibe64CodexAttachmentPath,
  vibe64ComposerDraftPath,
  vibe64ConversationLogPath,
  vibe64ConversationLogQueryKey,
  vibe64ProjectToolFixPath,
  vibe64ProjectToolRunPath,
  vibe64ProjectToolTerminalPath,
  vibe64SessionQueryKey,
  vibe64SessionPath,
  vibe64SessionsQueryKey,
  vibe64SourceEditorExplanationFollowupsPath,
  vibe64SourceEditorExplanationPath,
  vibe64SourceEditorExplanationsPath,
  vibe64TerminalFailureFixPath,
  commandInputFromContext
} from "../../src/lib/vibe64SessionRequestConfig.js";

describe("Vibe64 session request config", () => {
  it("uses current Vibe64 storage and route names", () => {
    expect(SELECTED_SESSION_STORAGE_KEY).toBe("vibe64:selected-session-id");
    expect(VIBE64_SESSION_CHANGED_EVENT).toBe("vibe64.session.changed");
    expect(VIBE64_COMPOSER_CHANGED_EVENT).toBe("vibe64.composer.changed");
    expect(vibe64SessionsQueryKey("home", "public")).toEqual([
      "vibe64",
      "project",
      "unscoped",
      "home",
      "public",
      "sessions"
    ]);
    expect(vibe64SessionQueryKey("home", "public")).toEqual([
      "vibe64",
      "project",
      "unscoped",
      "home",
      "public",
      "session"
    ]);
    expect(vibe64ArtifactPreviewQueryKey("home", "public", "2026-05-16_01:two")).toEqual([
      "vibe64",
      "project",
      "unscoped",
      "home",
      "public",
      "artifact-preview",
      "2026-05-16_01%3Atwo"
    ]);
    expect(vibe64ArtifactPreviewQueryKey("home", "public", "2026-05-16_01:two", "issue report")).toEqual([
      "vibe64",
      "project",
      "unscoped",
      "home",
      "public",
      "artifact-preview",
      "2026-05-16_01%3Atwo",
      "issue%20report"
    ]);
    expect(vibe64ConversationLogQueryKey("home", "public", "2026-05-16_01:two")).toEqual([
      "vibe64",
      "project",
      "unscoped",
      "home",
      "public",
      "conversation-log",
      "2026-05-16_01%3Atwo"
    ]);
    expect(vibe64SessionsQueryKey("app", "public", "alpha_1")).toEqual([
      "vibe64",
      "project",
      "alpha_1",
      "app",
      "public",
      "sessions"
    ]);
    expect(selectedSessionStorageKey("alpha_1")).toBe("vibe64:selected-session-id:project:alpha_1");
    expect(selectedSessionStorageKey("beta_2")).not.toBe(selectedSessionStorageKey("alpha_1"));
  });

  it("builds encoded session action and terminal support paths", () => {
    const apiPath = "/api/studio/vibe64/sessions";
    const sessionId = "2026-05-16_01:two";

    expect(vibe64SessionPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo`);
    expect(vibe64ActionPath(apiPath, sessionId, "make plan")).toBe(`${apiPath}/2026-05-16_01%3Atwo/actions/make%20plan`);
    expect(vibe64ArtifactPreviewPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/artifact-preview`);
    expect(vibe64CodexAttachmentPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/codex-attachments`);
    expect(vibe64ComposerDraftPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/composer-draft`);
    expect(vibe64ConversationLogPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/conversation-log`);
    expect(vibe64SourceEditorExplanationsPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/source-editor/explanations`);
    expect(vibe64SourceEditorExplanationPath(apiPath, sessionId, "exp one")).toBe(`${apiPath}/2026-05-16_01%3Atwo/source-editor/explanations/exp%20one`);
    expect(vibe64SourceEditorExplanationFollowupsPath(apiPath, sessionId, "exp one")).toBe(`${apiPath}/2026-05-16_01%3Atwo/source-editor/explanations/exp%20one/followups`);
    expect(vibe64TerminalFailureFixPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/terminal-failure-fix`);
  });

  it("builds encoded project tool terminal paths", () => {
    const apiPath = "/api/studio/vibe64";
    const toolId = "deploy:prod";
    const terminalId = "terminal one";

    expect(vibe64ProjectToolRunPath(apiPath, toolId)).toBe(`${apiPath}/tools/deploy%3Aprod/run`);
    expect(vibe64ProjectToolFixPath(apiPath, toolId)).toBe(`${apiPath}/tools/deploy%3Aprod/fix`);
    expect(vibe64ProjectToolTerminalPath(apiPath, toolId, terminalId)).toBe(`${apiPath}/tools/deploy%3Aprod/terminal/terminal%20one`);
  });

  it("normalizes command input payloads from command context", () => {
    expect(commandInputFromContext({
      agentSettings: {
        providerId: "codex",
        thinking: "high"
      },
      displayInput: {
        issueRequest: "Add reports\n\nreport.pdf"
      },
      input: {
        issueRequest: "Add reports"
      }
    })).toEqual({
      agentSettings: {
        providerId: "codex",
        thinking: "high"
      },
      displayInput: {
        issueRequest: "Add reports\n\nreport.pdf"
      },
      issueRequest: "Add reports"
    });
    expect(commandInputFromContext({
      input: ["not", "plain"]
    })).toEqual({});
  });
});
