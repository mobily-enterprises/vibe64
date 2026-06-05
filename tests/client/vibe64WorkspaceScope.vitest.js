import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
  vibe64ScopedStorageKey,
  vibe64WorkspaceQueryScope,
  workspaceSlugFromPathname
} from "../../src/lib/vibe64WorkspaceScope.js";

describe("Vibe64 workspace client scope", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("derives workspace scope from development paths", () => {
    expect(workspaceSlugFromPathname("/app/alpha_1")).toBe("alpha_1");
    expect(workspaceSlugFromPathname("/app/beta-2/dashboard/run")).toBe("beta-2");
    expect(workspaceSlugFromPathname("/app/manage")).toBe("");
  });

  it("adds workspace scope to query and storage keys", () => {
    expect(vibe64WorkspaceQueryScope("alpha_1")).toEqual(["workspace", "alpha_1"]);
    expect(vibe64WorkspaceQueryScope()).toEqual(["workspace", "unscoped"]);
    expect(vibe64ScopedStorageKey("vibe64:selected-session-id", "alpha_1"))
      .toBe("vibe64:selected-session-id:workspace:alpha_1");

    expect(projectTypeQueryKey("app", "public", "alpha_1")).toEqual([
      "vibe64",
      "workspace",
      "alpha_1",
      "app",
      "public",
      "project-type"
    ]);
    expect(targetScriptsQueryKey("app", "public", "beta_2")).toEqual([
      "vibe64",
      "workspace",
      "beta_2",
      "app",
      "public",
      "target-scripts"
    ]);
  });

  it("does not rewrite global Studio setup API paths into workspace API paths", () => {
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

  it("resolves direct browser transport URLs through the current workspace scope", () => {
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

  it("scopes direct command URLs through the current workspace scope", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:5173",
        pathname: "/app/beepollen"
      }
    });

    expect(scopedDevelopmentApiUrl("/api/vibe64/sessions/session-1/launch-terminal"))
      .toBe("/api/app/beepollen/vibe64/sessions/session-1/launch-terminal");
  });
});
