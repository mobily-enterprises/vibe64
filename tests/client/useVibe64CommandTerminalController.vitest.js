import { describe, expect, it } from "vitest";

import {
  commandTerminalCanRequestAiFix,
  projectToolRunPayloadFromActionInput,
  projectScopedTerminalApiPaths,
  resolveTerminalApiPath,
  terminalShouldCloseOnUnmount,
  terminalPathForContext
} from "../../src/composables/useVibe64CommandTerminalController.js";

describe("useVibe64CommandTerminalController", () => {
  it("does not offer AI fixes while a terminal is still running", () => {
    expect(commandTerminalCanRequestAiFix({
      aiFixAvailable: true,
      sessionId: "session-1",
      terminalCommandPreview: "npm run server",
      terminalError: "Terminal size must include valid cols and rows.",
      terminalRunning: true
    })).toBe(false);
  });

  it("offers AI fixes after a failed terminal exits", () => {
    expect(commandTerminalCanRequestAiFix({
      aiFixAvailable: true,
      sessionId: "session-1",
      terminalCommandPreview: "npm run server",
      terminalExited: true,
      terminalExitCode: 1
    })).toBe(true);
  });

  it("offers AI fixes for failed project tool terminals without a session id", () => {
    expect(commandTerminalCanRequestAiFix({
      aiFixAvailable: true,
      terminalCommandPreview: "npm run deploy",
      terminalExited: true,
      terminalExitCode: 1
    })).toBe(true);
  });

  it("preserves project tool source selection beside tool parameters", () => {
    expect(projectToolRunPayloadFromActionInput({
      parameters: {
        mode: "dry-run"
      },
      sessionId: "source-session",
      sourcePath: "/runtime/projects/catalog/sessions/active/source-session/source"
    })).toEqual({
      parameters: {
        mode: "dry-run"
      },
      sessionId: "source-session",
      sourcePath: "/runtime/projects/catalog/sessions/active/source-session/source"
    });
    expect(projectToolRunPayloadFromActionInput({
      mode: "legacy"
    })).toEqual({
      parameters: {
        mode: "legacy"
      }
    });
  });

  it("keeps command terminal close paths scoped to the owning project", () => {
    const apiPaths = projectScopedTerminalApiPaths({
      projectSlug: "mercmobily",
      sessionsApiPath: "/api/vibe64/sessions",
      vibe64ApiPath: "/api/vibe64"
    });

    expect(terminalPathForContext({
      ...apiPaths,
      sessionId: "2026-06-21_08-54-03",
      terminalKind: "command",
      terminalSessionId: "terminal one"
    })).toBe("/api/app/mercmobily/vibe64/sessions/2026-06-21_08-54-03/command-terminal/terminal%20one");
  });

  it("allows reusable terminal views to detach on unmount", () => {
    expect(terminalShouldCloseOnUnmount({ closeOnUnmount: false })).toBe(false);
    expect(terminalShouldCloseOnUnmount()).toBe(true);
  });

  it("keeps terminal routes pinned to the session page API path during teardown", () => {
    expect(resolveTerminalApiPath(
      "/api/app/beepollen/vibe64/sessions",
      "/api/vibe64/sessions"
    )).toBe("/api/app/beepollen/vibe64/sessions");
    expect(resolveTerminalApiPath(
      "  ",
      () => "/api/vibe64/sessions"
    )).toBe("/api/vibe64/sessions");
  });
});
