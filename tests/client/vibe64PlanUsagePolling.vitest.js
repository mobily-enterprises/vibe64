import { afterEach, expect, it, vi } from "vitest";

// TanStack Query decides on import whether it runs in a browser, so the page and
// its visibility exist before anything else loads.
const page = vi.hoisted(() => {
  const window = Object.assign(new EventTarget(), { navigator: { maxTouchPoints: 0 } });
  const document = new EventTarget();
  // Vue's DOM runtime prepares a template element when it loads.
  Object.assign(document, { hidden: false, visibilityState: "visible", createElement: () => ({}) });
  globalThis.window = window;
  globalThis.document = document;
  return {
    setHidden(hidden) {
      Object.assign(document, { hidden, visibilityState: hidden ? "hidden" : "visible" });
      // The browser fires visibilitychange at the document; it bubbles to the window.
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("visibilitychange"));
    }
  };
});

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => ({ value: "fixture" }) }));
// The chip needs only the accounts event name, not the accounts screens.
vi.mock("@local/vibe64-accounts/client", () => ({ VIBE64_ACCOUNTS_CHANGED_EVENT: "vibe64.accounts.changed" }));
vi.mock("@jskit-ai/assistant-core/client/conversation", () => ({ AssistantGoalControl: { render: () => null } }));
const blank = vi.hoisted(() => ({ render: () => null }));
vi.mock("vuetify/components/VMenu", () => ({ VMenu: blank }));
vi.mock("vuetify/components/VBtn", () => ({ VBtn: blank }));
vi.mock("vuetify/components/VDialog", () => ({ VDialog: blank }));
vi.mock("vuetify/components/VCard", () => ({ VCard: blank, VCardActions: blank, VCardText: blank, VCardTitle: blank }));

const { QueryClient, VueQueryPlugin } = await import("@tanstack/vue-query");
const { configureHttpWebClient, resetHttpWebClientForTests } = await import("@jskit-ai/http-web/client/lib/httpClient");
const { createRenderer, ssrContextKey } = await import("vue");
const { VIBE64_ASSISTANT_VIEWER_KEY } = await import("@/lib/vibe64AssistantHost.js");
const { VIBE64_ACCOUNTS_CHANGED_EVENT } = await import("@local/vibe64-accounts/client");
const { VIBE64_SESSION_CHANGED_EVENT } = await import("@/lib/vibe64SessionRequestConfig.js");
const { default: PlanUsage } = await import("../../src/components/studio/vibe64-session/Vibe64AgentPlanUsage.vue");

let unmount = () => {};
afterEach(() => {
  unmount();
  vi.useRealTimers();
});

function mountPlanUsage() {
  const requests = [];
  configureHttpWebClient({
    request(url) {
      requests.push(url);
      return Promise.resolve({ status: "available", currentForMs: 420_000, checkedAt: Date.now(), windows: [] });
    }
  });
  const listeners = new Map();
  const socket = {
    on(event, listener) { listeners.set(event, [...listeners.get(event) || [], listener]); },
    off(event, listener) { listeners.set(event, (listeners.get(event) || []).filter((entry) => entry !== listener)); }
  };
  const node = () => ({ children: [] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });
  const app = createRenderer({
    createElement: node, createText: node, createComment: node,
    setText() {}, setElementText() {}, insert() {}, remove() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null
  }).createApp(PlanUsage, {
    active: true,
    session: { sessionId: "one", assistantSelection: { engineId: "claude" } },
    sessionsApiPath: "/api/projects/fixture/sessions"
  });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
  app.provide("jskit.realtime.runtime.client.socket", socket);
  // Vitest compiles the component for server rendering; mounting it still runs the
  // setup and lifecycle that decide when to read, which is all this test observes.
  app.provide(ssrContextKey, {});
  app.config.warnHandler = () => {};
  app.mount(node());
  unmount = () => {
    app.unmount();
    queryClient.clear();
    resetHttpWebClientForTests();
    page.setHidden(false);
  };
  return {
    requests,
    emit(event, payload) { for (const listener of listeners.get(event) || []) listener(payload); }
  };
}

it("polls plan allowance once a minute only while the page is visible, without bursts on return", async () => {
  vi.useFakeTimers();
  const view = mountPlanUsage();
  await vi.advanceTimersByTimeAsync(0);
  expect(view.requests).toEqual(["/api/projects/fixture/sessions/one/agent-plan-usage"]);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(view.requests).toHaveLength(2);

  // A hidden tab asks for nothing: no poll, no realtime refresh.
  page.setHidden(true);
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  view.emit(VIBE64_SESSION_CHANGED_EVENT, { projectSlug: "fixture", sessionId: "one", reason: "agent-plan-usage" });
  view.emit(VIBE64_ACCOUNTS_CHANGED_EVENT, {});
  await vi.advanceTimersByTimeAsync(60_000);
  expect(view.requests).toHaveLength(2);

  // Coming back after a missed poll reads once at once.
  page.setHidden(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(view.requests).toHaveLength(3);

  // Switching tabs inside the minute adds no reads.
  for (let flip = 0; flip < 5; flip++) {
    page.setHidden(true);
    await vi.advanceTimersByTimeAsync(2_000);
    page.setHidden(false);
    await vi.advanceTimersByTimeAsync(2_000);
  }
  expect(view.requests).toHaveLength(3);

  // The minute poll resumes from the return.
  await vi.advanceTimersByTimeAsync(56_000);
  expect(view.requests).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(view.requests).toHaveLength(4);
});
