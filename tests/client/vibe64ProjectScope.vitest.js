import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VIBE64_ACCOUNTS_CHANGED_EVENT,
  projectTypeQueryKey
} from "../../src/lib/studioGateApi.js";
import {
  resolveWebSocketUrl,
  resolveStudioRequestUrl,
  scopedDevelopmentApiUrl,
  scopedDevelopmentApiPathname
} from "../../src/lib/studioHttp.js";
import {
  targetScriptsQueryKey
} from "../../src/lib/targetScriptsRequestConfig.js";
import {
  readProjects
} from "../../src/lib/vibe64ProjectApi.js";
import {
  vibe64ProjectScopedStorageKey,
  vibe64ProjectQueryScope,
  projectSlugFromPathname
} from "../../src/lib/vibe64ProjectScope.js";

describe("Vibe64 project client scope", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("derives project scope from development paths", () => {
    expect(projectSlugFromPathname("/app/alpha_1")).toBe("alpha_1");
    expect(projectSlugFromPathname("/app/beta-2/dashboard/run")).toBe("beta-2");
    expect(projectSlugFromPathname("/app/manage")).toBe("");
    expect(projectSlugFromPathname("/app/manage/accounts")).toBe("");
  });

  it("adds project scope to query and storage keys", () => {
    expect(VIBE64_ACCOUNTS_CHANGED_EVENT).toBe("vibe64.accounts.changed");
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
      "target-scripts"
    ]);
  });

  it("does not rewrite global Studio setup API paths into project API paths", () => {
    expect(scopedDevelopmentApiPathname("/api/studio/studio-setup", "alpha_1"))
      .toBe("/api/studio/studio-setup");
    expect(scopedDevelopmentApiPathname("/api/studio/studio-setup/stream", "alpha_1"))
      .toBe("/api/studio/studio-setup/stream");
    expect(scopedDevelopmentApiPathname("/api/studio/browser-lifecycle/ws", "alpha_1"))
      .toBe("/api/studio/browser-lifecycle/ws");
    expect(scopedDevelopmentApiPathname("/api/vibe64/accounts", "alpha_1"))
      .toBe("/api/vibe64/accounts");
    expect(scopedDevelopmentApiPathname("/api/vibe64/accounts/auth/session-1", "alpha_1"))
      .toBe("/api/vibe64/accounts/auth/session-1");
    expect(scopedDevelopmentApiPathname("/api/studio/project-setup", "alpha_1"))
      .toBe("/api/app/alpha_1/studio/project-setup");
  });

  it("resolves direct browser transport URLs through the current project scope", () => {
    vi.stubGlobal("window", {
      location: {
        host: "127.0.0.1:5173",
        origin: "http://127.0.0.1:5173",
        pathname: "/app/alpha_1/dashboard/setup"
      }
    });

    expect(resolveStudioRequestUrl("/api/studio/project-setup/stream"))
      .toBe("/api/app/alpha_1/studio/project-setup/stream");
    expect(resolveStudioRequestUrl("/api/studio/studio-setup/stream"))
      .toBe("/api/studio/studio-setup/stream");
    expect(resolveWebSocketUrl("/api/studio/browser-lifecycle/ws"))
      .toBe("ws://127.0.0.1:5173/api/studio/browser-lifecycle/ws");
    expect(resolveStudioRequestUrl("/api/vibe64/accounts"))
      .toBe("/api/vibe64/accounts");
  });

  it("scopes direct command URLs through the current project scope", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:5173",
        pathname: "/app/beepollen"
      }
    });

    expect(scopedDevelopmentApiUrl("/api/vibe64/sessions/session-1/launch-terminal"))
      .toBe("/api/app/beepollen/vibe64/sessions/session-1/launch-terminal");
  });

  it("scopes project API requests on project pages", async () => {
    const requestedUrls = [];
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:5173",
        pathname: "/app/beepollen"
      }
    });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      requestedUrls.push(url);
      return {
        json: async () => ({
          ok: true,
          projects: []
        }),
        status: 200
      };
    }));

    await readProjects();

    expect(requestedUrls).toEqual([
      "/api/app/beepollen/vibe64/projects"
    ]);
  });
});
