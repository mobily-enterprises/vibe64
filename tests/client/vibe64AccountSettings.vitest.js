import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import {
  onVibe64AccountConnectionsDialogRequested,
  requestVibe64AccountConnectionsDialog
} from "../../src/lib/vibe64AccountConnectionsDialog.js";
import {
  preferredNameDraftState
} from "../../src/lib/vibe64PersonalAiProfile.js";
import { readAppearance, writeAppearance } from "../../src/lib/appearance.js";

describe("standalone personal AI profile settings", () => {
  it("opens the account settings dialog directly on the personal profile section", () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("CustomEvent", class extends Event {
      constructor(type, options = {}) {
        super(type);
        this.detail = options.detail;
      }
    });
    const handler = vi.fn();
    const dispose = onVibe64AccountConnectionsDialogRequested(handler);

    expect(requestVibe64AccountConnectionsDialog({
      refresh: false,
      section: "profile"
    })).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({
      codexReconnectRequired: false,
      providerId: "",
      providerLabel: "",
      providerRevision: "",
      refresh: false,
      section: "profile"
    });
    dispose();
    vi.unstubAllGlobals();
  });

  it("keeps the profile form Material-sized, compact, and explicit about scope", async () => {
    const component = await readFile(
      new URL("../../src/components/studio/Vibe64AuthSettingsButton.vue", import.meta.url),
      "utf8"
    );

    expect(component).toContain("What should Vibe64 call you?");
    expect(component).toContain("You — all projects");
    expect(component).toContain("min-height: 3rem");
    expect(component).toContain("profileRequested");
    expect(component).toContain("await accounts.reloadLocalStatus()");
    expect(component).not.toContain(":loading=\"preferredNameSaving\"");
    expect(component).not.toContain("maxlength=\"80\"");
  });

  it("counts preferred-name limits by Unicode characters rather than UTF-16 units", () => {
    const eightyEmoji = "😀".repeat(80);

    expect(preferredNameDraftState(eightyEmoji)).toMatchObject({
      error: "",
      length: 80,
      preferredName: eightyEmoji,
      valid: true
    });
    expect(preferredNameDraftState(`${eightyEmoji}😀`)).toMatchObject({
      error: "Name cannot exceed 80 characters.",
      length: 81,
      valid: false
    });
  });

  it("remembers the chosen appearance per browser and defaults to light", () => {
    const store = new Map();
    vi.stubGlobal("window", { localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value))
    } });
    expect(readAppearance()).toBe("light");
    writeAppearance("dark");
    expect(readAppearance()).toBe("dark");
    writeAppearance("system");
    expect(readAppearance()).toBe("system");
    writeAppearance("neon");
    expect(readAppearance()).toBe("system");
    store.set("vibe64.appearance", "\"neon\"");
    expect(readAppearance()).toBe("light");
    vi.unstubAllGlobals();
    expect(readAppearance()).toBe("light");
  });

  it("offers Light, Dark and System on the You tab and applies the choice through the theme", async () => {
    const component = await readFile(
      new URL("../../src/components/studio/Vibe64AuthSettingsButton.vue", import.meta.url),
      "utf8"
    );
    const main = await readFile(new URL("../../src/main.js", import.meta.url), "utf8");

    expect(component).toContain(">Appearance</h3>");
    expect(component).toMatch(/label: "Light", value: "light"[\s\S]*label: "Dark", value: "dark"[\s\S]*label: "System", value: "system"/u);
    expect(component).toContain("theme.change(value);");
    expect(component).toContain("writeAppearance(value);");
    expect(main).toContain("defaultTheme: readAppearance(),");
  });
});
