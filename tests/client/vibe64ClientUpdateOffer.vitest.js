import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// JSKIT's offer to reload after an update (shell-web's client update) as src/error.js routes it: to the editor's top
// banner while one is on the page, so an update is one notice, and to the shell's own banner otherwise. The browser
// test in tests/e2e/self-contained-smoke.spec.ts sees it on a real page.

/**
 * A stand-in for shell-web's error runtime with the parts of its contract the routing relies on: the policy's
 * presenterId picks the presenter (the shell's banner otherwise), a dismissal goes to every presenter, and subscribers
 * hear each report with its decision and presentation id.
 */
function shellRuntime() {
  const banner = new Map();
  const presenters = new Map();
  const listeners = new Set();
  let policy = null;
  let shown = 0;
  presenters.set("material.banner", {
    id: "material.banner",
    present(payload) {
      shown += 1;
      const id = `banner-${shown}`;
      banner.set(id, payload);
      return id;
    },
    dismiss(id = "") {
      if (id) return banner.delete(id) ? 1 : 0;
      const count = banner.size;
      banner.clear();
      return count;
    }
  });
  return {
    banner,
    configure(config) {
      for (const presenter of config.presenters) presenters.set(presenter.id, presenter);
      policy = config.policy;
    },
    report(event) {
      const decision = { ...policy(event, {}), message: event.message, action: event.action || null };
      const presenter = presenters.get(decision.presenterId || "material.banner");
      const presentationId = presenter.present({ ...decision, event });
      const result = { event, decision: { ...decision, presenterId: presenter.id }, presentationId };
      for (const listener of listeners) listener({ type: "reported", result });
      return result;
    },
    dismiss(id = "") {
      let count = 0;
      for (const presenter of presenters.values()) count += presenter.dismiss(id);
      return count;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

/** The offer as shell-web's client update reports it. */
function offerReload(runtime, handler = vi.fn()) {
  return runtime.report({
    source: "shell-web.client-update",
    message: "Vibe64 was updated. Reload to get the latest version.",
    intent: "app-recoverable",
    severity: "info",
    action: { label: "Reload", handler }
  });
}

let offers;
let runtime;

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, "info").mockImplementation(() => {});
  const { default: configureVibe64ErrorRuntime } = await import("../../src/error.js");
  offers = await import("../../src/lib/vibe64ClientUpdateOffer.js");
  runtime = shellRuntime();
  runtime.configure(configureVibe64ErrorRuntime({ runtime }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the client update offer", () => {
  it("goes to the top banner while one is on the page, and JSKIT's withdrawal takes it back", () => {
    const endHosting = offers.hostClientUpdateOffer();
    const shown = offerReload(runtime);

    expect(runtime.banner.size).toBe(0);
    expect(offers.clientUpdateOffer.value).toMatchObject({
      id: shown.presentationId,
      message: "Vibe64 was updated. Reload to get the latest version."
    });
    // The server serves the page's own build again.
    expect(runtime.dismiss(shown.presentationId)).toBe(1);
    expect(offers.clientUpdateOffer.value).toBeNull();

    // Without the banner the shell's own banner shows the next one.
    endHosting();
    offerReload(runtime);
    expect(runtime.banner.size).toBe(1);
    expect(offers.clientUpdateOffer.value).toBeNull();
  });

  it("shown by the shell's banner before a top banner came, moves into the first one, keeping its id", () => {
    const shown = offerReload(runtime);
    expect(runtime.banner.size).toBe(1);

    offers.hostClientUpdateOffer();
    expect(runtime.banner.size).toBe(0);
    expect(offers.clientUpdateOffer.value?.id).toBe(shown.presentationId);
    expect(runtime.dismiss(shown.presentationId)).toBe(1);
    expect(offers.clientUpdateOffer.value).toBeNull();
  });

  it("closed in the shell's banner stays closed when a top banner comes", () => {
    const shown = offerReload(runtime);
    runtime.banner.delete(shown.presentationId);

    offers.hostClientUpdateOffer();
    expect(offers.clientUpdateOffer.value).toBeNull();
  });

  it("reloads with JSKIT's action, closes on Dismiss, and says so when the reload fails", async () => {
    offers.hostClientUpdateOffer();
    const handler = vi.fn();
    offerReload(runtime, handler);
    await offers.reloadForClientUpdate();
    expect(handler).toHaveBeenCalledTimes(1);

    offerReload(runtime, () => { throw new Error("The app cannot reload."); });
    const report = vi.spyOn(runtime, "report");
    await offers.reloadForClientUpdate();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      source: "vibe64.client-update.reload",
      message: "The app cannot reload.",
      severity: "error"
    }));

    offers.dismissClientUpdateOffer();
    expect(offers.clientUpdateOffer.value).toBeNull();
  });

  it("leaves every other report to the app's policy", () => {
    offers.hostClientUpdateOffer();
    const shown = runtime.report({ source: "vibe64.editor.updating", message: "Updating…", channel: "banner", severity: "info" });
    expect(shown.decision.presenterId).toBe("material.banner");
    expect(runtime.banner.size).toBe(1);
    expect(offers.clientUpdateOffer.value).toBeNull();
  });
});
