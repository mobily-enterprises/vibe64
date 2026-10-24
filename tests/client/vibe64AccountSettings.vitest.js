import { readFile } from "node:fs/promises";
import { createRenderer, ref, ssrContextKey } from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("vuetify", () => ({ useDisplay: () => ({ smAndDown: ref(false), xs: ref(false) }), useTheme: () => ({ change: vi.fn() }) }));
vi.mock("@local/vibe64-accounts/client", async () => ({
  ...(await import("../../packages/vibe64-accounts/src/client/onboarding/aiOnboardingEvents.js")),
  AiSetup: {},
  ProviderAccountsSetup: {},
  accountRowsForStatus: () => [],
  useVibe64Accounts: () => ({ status: ref(null), savePersonalAiProfileCommand: {}, refresh: vi.fn(), reloadLocalStatus: vi.fn() })
}));

import Vibe64AuthSettingsButton from "../../src/components/studio/Vibe64AuthSettingsButton.vue";
import {
  aiOnboardingBlocked,
  onVibe64AiOnboardingRequested,
  requestVibe64AiOnboarding
} from "../../packages/vibe64-accounts/src/client/onboarding/aiOnboardingEvents.js";

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

  it("gives way to the AI onboarding flow, returning focus to the menu, unless AI Accounts is busy", async () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("CustomEvent", class extends Event {
      constructor(type, options = {}) {
        super(type);
        this.detail = options.detail;
      }
    });
    const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
    const app = renderer.createApp({ ...Vibe64AuthSettingsButton, render: () => null });
    app.provide(ssrContextKey, { modules: new Set() });
    app.mount({});
    const state = app._instance.setupState;
    const activator = { focus: vi.fn() };
    state.root = { querySelector: () => activator };
    const requests = [];
    const stop = onVibe64AiOnboardingRequested((event) => requests.push(event.detail));

    await state.openDialog({ refresh: false });
    expect(requestVibe64AiOnboarding({ start: "choose" })).toBe(true);
    expect(state.dialogOpen).toBe(false);
    expect(requests.at(-1)).toEqual({ start: "choose", redo: false, returnFocus: activator });

    state.redoOnboarding();
    expect(requests.at(-1)).toEqual({ start: "choose", redo: true, returnFocus: activator });

    await state.openDialog({ refresh: false });
    state.aiConnectionsBusy = true;
    await Promise.resolve();
    expect(aiOnboardingBlocked.value).toBe(true);
    expect(requestVibe64AiOnboarding({ start: "choose" })).toBe(false);
    expect(state.dialogOpen).toBe(true);
    expect(requests).toHaveLength(2);

    state.aiConnectionsBusy = false;
    await Promise.resolve();
    expect(aiOnboardingBlocked.value).toBe(false);
    stop();
    app.unmount();
    vi.unstubAllGlobals();
  });

  it("opens AI Accounts on the requested provider through the setup screen", async () => {
    vi.stubGlobal("window", new EventTarget());
    const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
    const app = renderer.createApp({ ...Vibe64AuthSettingsButton, render: () => null });
    app.provide(ssrContextKey, { modules: new Set() });
    app.mount({});
    const state = app._instance.setupState;
    const openProvider = vi.fn();
    state.aiSetup = { openProvider };
    await state.openDialog({ refresh: false, providerId: "deepseek", providerLabel: "DeepSeek" });
    expect([state.dialogOpen, state.selectedProviderId]).toEqual([true, "ai"]);
    expect(openProvider).toHaveBeenCalledExactlyOnceWith("deepseek", { refresh: false, providerId: "deepseek", providerLabel: "DeepSeek" });
    await state.openDialog({ refresh: false, providerId: "ai" });
    expect(openProvider).toHaveBeenCalledTimes(1);
    const component = await readFile(new URL("../../src/components/studio/Vibe64AuthSettingsButton.vue", import.meta.url), "utf8");
    expect(component).toMatch(/<AiSetup\s+v-if="selectedProviderId === 'ai'"\s+ref="aiSetup"\s+inline\s+can-configure\s+:focus="aiFocus"\s+@busy="aiConnectionsBusy = \$event"/u);
    app.unmount();
    vi.unstubAllGlobals();
  });

  it("puts Account settings and Redo onboarding in one account menu", async () => {
    const component = await readFile(
      new URL("../../src/components/studio/Vibe64AuthSettingsButton.vue", import.meta.url),
      "utf8"
    );
    expect(component).toContain('aria-label="Account menu"');
    expect(component).toMatch(/title="Account settings"[\s\S]*v-if="aiOnboardingAvailable"[\s\S]*title="Redo onboarding"/u);
  });

  it("fills a phone screen, wraps its subtitle and fits its tabs without sideways scrolling", async () => {
    const component = await readFile(new URL("../../src/components/studio/Vibe64AuthSettingsButton.vue", import.meta.url), "utf8");
    expect(component).toContain(':fullscreen="smAndDown"');
    expect(component).toMatch(/:grow="xs"\s+:show-arrows="!xs"\s+:stacked="xs"/u);
    expect(component).toMatch(/\.vibe64-auth-settings__dialog-title \{[^}]*white-space: normal;/u);
    expect(component).toMatch(/@media \(max-width: 599\.98px\) \{[\s\S]*\.vibe64-auth-settings__provider-tab \{\s+min-width: 0;/u);
  });
});
