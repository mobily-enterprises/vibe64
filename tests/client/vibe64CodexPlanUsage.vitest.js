import { createSSRApp, h, ref } from "vue";
import { renderToString } from "@vue/server-renderer";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null, options: null, realtime: null }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: (options) => { mocks.options = options; return mocks.resource; }
}));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent: (options) => { mocks.realtime = options; }
}));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => ({ value: "fixture" }) }));
vi.mock("vuetify/components/VMenu", async () => {
  const { h } = await import("vue");
  return { VMenu: { setup: (_, { slots }) => () => h("div", [slots.activator?.({ props: {} }), slots.default?.()]) } };
});
vi.mock("vuetify/components/VBtn", async () => {
  const { h } = await import("vue");
  return { VBtn: { setup: (_, { slots }) => () => h("button", slots.default?.()) } };
});
vi.mock("vuetify/components/VCard", async () => {
  const { h } = await import("vue");
  return { VCard: { setup: (_, { slots }) => () => h("div", slots.default?.()) } };
});
import PlanUsage from "../../src/components/studio/vibe64-session/Vibe64CodexPlanUsage.vue";

async function render(data, props = {}) {
  mocks.resource = { data: ref(data), loadError: ref(""), reload: vi.fn() };
  return renderToString(createSSRApp({ render: () => h(PlanUsage, {
    active: true, session: { sessionId: "one", assistantSelection: { engineId: "codex" } },
    sessionsApiPath: "/api/projects/fixture/sessions", ...props
  }) }));
}
it("shows only the weekly percentage with explanatory details", async () => {
  const html = await render({ status: "available", windows: [
    { id: "primary", remainingPercent: 72, windowDurationMins: 300, resetsAt: 2000000000 },
    { id: "secondary", remainingPercent: 0, windowDurationMins: 10080, resetsAt: null }
  ] });
  expect(html).toContain("Weekly Codex allowance remaining: 0%");
  expect(html).toContain("5h allowance remaining: 72%");
  expect(html).not.toContain("5h:");
  expect(html).toContain("Shared across sessions");
  expect(html).toContain("5h resets");
  expect(html).not.toContain("Weekly resets");
  expect(html).toMatch(/>\s*0%\s*<\/button>/);
  expect(mocks.options.enabled.value).toBe(true);
  expect(mocks.realtime.matches({ payload: { projectSlug: "fixture", sessionId: "one", reason: "codex-plan-usage" } })).toBe(true);
  expect(mocks.realtime.matches({ payload: { projectSlug: "fixture", sessionId: "two", reason: "codex-plan-usage" } })).toBe(false);
  mocks.realtime.onEvent();
  expect(mocks.resource.reload).toHaveBeenCalledOnce();
});
it("resolves the reactive sessions path used by the live chat", async () => {
  const sessionsApiPath = ref("/api/app/fixture/vibe64/sessions");
  await render(null, { sessionsApiPath });
  expect(mocks.options.path.value).toBe("/api/app/fixture/vibe64/sessions/one/agent-plan-usage");
  sessionsApiPath.value = "/api/app/next/vibe64/sessions";
  expect(mocks.options.path.value).toBe("/api/app/next/vibe64/sessions/one/agent-plan-usage");
  expect(mocks.options.queryKey.value).toContain(sessionsApiPath.value);
});

it("never invents a refreshed allowance after the reset deadline", async () => {
  const html = await render({ status: "available", windows: [{ id: "primary", remainingPercent: 0, windowDurationMins: 10080, resetsAt: 1 }] });
  expect(html).not.toContain("Weekly Codex allowance remaining");
  expect(html).not.toContain("100% left");
  expect(await render({ status: "unavailable", windows: [] })).not.toContain("Codex plan allowance");
});
it("hides plan information for other assistants, API accounts and inactive sessions", async () => {
  expect(await render({ status: "unsupported", windows: [] })).not.toContain("Codex plan allowance");
  expect(await render(null, { session: { sessionId: "one", assistantSelection: { engineId: "opencode" } } })).not.toContain("Codex plan allowance");
  expect(mocks.options.enabled.value).toBe(false);
  expect(await render(null, { active: false })).not.toContain("Codex plan allowance");
});

it("includes known weekly reset times and omits missing five-hour data", async () => {
  const html = await render({ status: "available", windows: [
    { id: "secondary", remainingPercent: 40, windowDurationMins: 10080, resetsAt: 2000000000 }
  ] });
  expect(html).toContain("Weekly resets");
  expect(html).not.toContain("5h allowance");
});
