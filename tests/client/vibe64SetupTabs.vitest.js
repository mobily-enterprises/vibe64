import { describe, expect, it } from "vitest";

import {
  fallbackSetupTab,
  normalizeSetupTab,
  setupTabs
} from "../../src/lib/vibe64SetupTabs.js";

describe("Vibe64 setup tabs", () => {
  it("keeps Studio Setup first when the runtime requires it", () => {
    expect(setupTabs().map((tab) => tab.value)).toEqual([
      "studio-setup",
      "project-setup"
    ]);
    expect(fallbackSetupTab()).toBe("studio-setup");
    expect(normalizeSetupTab("studio-setup")).toBe("studio-setup");
  });

  it("uses only Project Setup when Studio Setup is managed outside the page", () => {
    const options = {
      studioSetupEnabled: false
    };

    expect(setupTabs(options).map((tab) => tab.value)).toEqual(["project-setup"]);
    expect(fallbackSetupTab(options)).toBe("project-setup");
    expect(normalizeSetupTab("studio-setup", options)).toBe("");
    expect(normalizeSetupTab("project-setup", options)).toBe("project-setup");
  });
});
