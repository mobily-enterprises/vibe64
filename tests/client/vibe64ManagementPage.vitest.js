import { describe, expect, it } from "vitest";

import {
  managementViewsForRuntime,
  runtimeCapabilityEnabled
} from "../../src/composables/useVibe64ManagementPage.js";

describe("Vibe64 management page runtime capabilities", () => {
  it("shows hosted management views by default", () => {
    expect(managementViewsForRuntime(null).map((view) => view.value)).toEqual([
      "projects",
      "studio-setup",
      "accounts",
      "users"
    ]);
  });

  it("shows local editor management views without hosted tenant controls", () => {
    const runtime = {
      local: true,
      mode: "local",
      capabilities: {
        managedProjectsEnabled: false,
        projectAccessManagementEnabled: false,
        tenantUsersEnabled: false
      }
    };

    expect(managementViewsForRuntime(runtime).map((view) => view.value)).toEqual([
      "local-project",
      "studio-setup",
      "accounts"
    ]);
    expect(runtimeCapabilityEnabled(runtime, "tenantUsersEnabled", true)).toBe(false);
    expect(runtimeCapabilityEnabled(runtime, "projectAccessManagementEnabled", true)).toBe(false);
  });
});
