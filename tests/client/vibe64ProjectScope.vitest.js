import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureUsersWebHttpClient,
  getUsersWebHttpClient,
  resetUsersWebHttpClientForTests
} from "@jskit-ai/users-web/client/lib/httpClient";

import {
  PROJECT_SELECTION_ENDPOINT,
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  projectTypeQueryKey
} from "../../src/lib/studioGateApi.js";
import {
  resolveWebSocketUrl,
  resolveStudioRequestUrl,
  scopedDevelopmentApiUrl,
  scopedDevelopmentApiPathname
} from "../../src/lib/studioUrls.js";
import {
  vibe64CodexTerminalWebSocketUrl
} from "../../src/lib/vibe64SessionApi.js";
import {
  targetScriptsQueryKey
} from "../../src/lib/targetScriptsRequestConfig.js";
import {
  vibe64ProjectScopedStorageKey,
  vibe64ProjectQueryScope,
  projectAppPath,
  projectSlugFromPathname
} from "../../src/lib/vibe64ProjectScope.js";

describe("Vibe64 project client scope", () => {
  afterEach(() => {
    resetUsersWebHttpClientForTests();
    vi.unstubAllGlobals();
  });

  it("derives project scope from development paths", () => {
    expect(projectAppPath("alpha_1")).toBe("/app/project/alpha_1");
    expect(projectAppPath("beta-2", "/dashboard/history")).toBe("/app/project/beta-2/dashboard/history");
    expect(projectSlugFromPathname("/app/project/alpha_1")).toBe("alpha_1");
    expect(projectSlugFromPathname("/app/project/beta-2/dashboard/history")).toBe("beta-2");
    expect(projectSlugFromPathname("/app")).toBe("");
    expect(projectSlugFromPathname("/app/alpha_1")).toBe("");
  });

  it("adds project scope to query and storage keys", () => {
    expect(VIBE64_CONNECTIONS_CHANGED_EVENT).toBe("vibe64.connections.changed");
    expect(vibe64ProjectQueryScope("alpha_1")).toEqual(["project", "alpha_1"]);
    expect(vibe64ProjectQueryScope()).toEqual(["project", "unscoped"]);
    expect(vibe64ProjectScopedStorageKey("vibe64:selected-session-id", "alpha_1"))
      .toBe("vibe64:selected-session-id:project:alpha_1");

    expect(projectTypeQueryKey("app", "public", "alpha_1")).toEqual([
      "vibe64",
      "project",
      "alpha_1",
      "app",
      "public",
      "project-type"
    ]);
    expect(targetScriptsQueryKey("app", "public", "beta_2")).toEqual([
      "vibe64",
      "project",
      "beta_2",
      "app",
      "public",
      "target-scripts",
      ""
    ]);
    expect(targetScriptsQueryKey("app", "public", "beta_2", "session-1")).toEqual([
      "vibe64",
      "project",
      "beta_2",
      "app",
      "public",
      "target-scripts",
      "session-1"
    ]);
  });

  it("does not rewrite global Studio setup API paths into project API paths", () => {
    expect(scopedDevelopmentApiPathname("/api/studio/studio-setup", "alpha_1"))
      .toBe("/api/studio/studio-setup");
    expect(scopedDevelopmentApiPathname("/api/studio/studio-setup/stream", "alpha_1"))
      .toBe("/api/studio/studio-setup/stream");
    expect(scopedDevelopmentApiPathname("/api/studio/browser-lifecycle/ws", "alpha_1"))
      .toBe("/api/studio/browser-lifecycle/ws");
    expect(scopedDevelopmentApiPathname("/api/studio/project-setup", "alpha_1"))
      .toBe("/api/app/alpha_1/studio/project-setup");
  });

  it("resolves direct browser transport URLs through the current project scope", () => {
    vi.stubGlobal("window", {
      location: {
        host: "127.0.0.1:5173",
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/alpha_1/dashboard/setup"
      }
    });

    expect(resolveStudioRequestUrl("/api/studio/project-setup/stream"))
      .toBe("/api/app/alpha_1/studio/project-setup/stream");
    expect(resolveStudioRequestUrl("/api/studio/studio-setup/stream"))
      .toBe("/api/studio/studio-setup/stream");
    expect(resolveWebSocketUrl("/api/studio/browser-lifecycle/ws"))
      .toBe("ws://127.0.0.1:5173/api/studio/browser-lifecycle/ws");
  });

  it("adds the tab origin to session Codex terminal WebSocket URLs", () => {
    vi.stubGlobal("window", {
      location: {
        host: "127.0.0.1:5173",
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/alpha_1"
      }
    });

    const url = vibe64CodexTerminalWebSocketUrl("session 1", "terminal 1");
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/app/alpha_1/vibe64/sessions/session%201/codex-terminal/terminal%201/ws");
    expect(parsed.searchParams.get("originId")).toMatch(/^tab:/u);
  });

  it("scopes direct command URLs through the current project scope", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/beepollen"
      }
    });

    expect(scopedDevelopmentApiUrl("/api/vibe64/sessions/session-1/launch-terminal"))
      .toBe("/api/app/beepollen/vibe64/sessions/session-1/launch-terminal");
  });

  it("scopes JSKIT HTTP client project API requests on project pages", async () => {
    const requestedUrls = [];
    configureUsersWebHttpClient({
      csrf: {
        enabled: false
      },
      resolveRequestUrl(url) {
        return resolveStudioRequestUrl(url);
      }
    });
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/beepollen"
      }
    });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      requestedUrls.push(url);
      return {
        headers: {
          get: () => "application/json"
        },
        json: async () => ({
          ok: true,
          projects: []
        }),
        ok: true,
        status: 200
      };
    }));

    await getUsersWebHttpClient().get(PROJECT_SELECTION_ENDPOINT);

    expect(requestedUrls).toEqual([
      "/api/app/beepollen/vibe64/projects"
    ]);
  });
});
