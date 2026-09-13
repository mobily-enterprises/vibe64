import { createSSRApp, h, ref } from "vue";
import { renderToString } from "@vue/server-renderer";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resource: null,
  options: null,
  realtime: null,
  goal: null,
  goalResource: null,
  buttons: [],
  request: vi.fn()
}));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource(options) {
    if (options.path.value.endsWith("/agent-goal")) {
      mocks.goalResource = { data: ref(mocks.goal), loadError: ref(""), reload: vi.fn() };
      return mocks.goalResource;
    }
    mocks.options = options;
    return mocks.resource;
  }
}));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    const payload = { projectSlug: "fixture", sessionId: "one", reason: "codex-plan-usage" };
    if (options.matches({ payload })) {
      mocks.realtime = options;
    }
  }
}));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: mocks.request }) }));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => ({ value: "fixture" }) }));
vi.mock("vuetify/components/VMenu", async () => {
  const { h } = await import("vue");
  return { VMenu: { setup: (_, { slots }) => () => h("div", [slots.activator?.({ props: {} }), slots.default?.()]) } };
});
vi.mock("vuetify/components/VBtn", async () => {
  const { h } = await import("vue");
  return { VBtn: { setup: (_, { slots, attrs }) => () => {
    const children = slots.default?.();
    mocks.buttons.push({ text: children?.map((node) => node.children).join(""), click: attrs.onClick });
    return h("button", children);
  } } };
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
  expect(html.replace(/<!--.*?-->/g, "")).toMatch(/>\s*0%\s*<\/button>/);
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

it("shows a goal and its controls even without plan allowance", async () => {
  for (const [status, label] of [["active", "Pause goal"], ["paused", "Resume goal"], ["blocked", "Resume goal"]]) {
    mocks.goal = { status: "available", goal: { threadId: "thread-one", status, objective: "Finish the migration", createdAt: 10 } };
    const html = await render({ status: "unsupported", windows: [] });
    expect(html).toContain("Finish the migration");
    expect(html).toContain(label);
    expect(html).not.toContain("Codex plan allowance");
  }
  mocks.goal = { status: "available", goal: { status: "complete", objective: "Finished" } };
  const complete = await render(null);
  expect(complete).not.toContain("Resume goal");
  expect(complete).not.toContain("Pause goal");
  mocks.goal = null;
});

it("sends an explicit status action for the displayed goal and reloads after failure", async () => {
  mocks.buttons = [];
  mocks.goal = { status: "available", goal: { threadId: "thread-one", status: "paused", objective: "Finish migration", createdAt: 10 } };
  mocks.request.mockResolvedValueOnce({ ok: false, error: "Goal changed" });
  await render(null);
  await mocks.buttons.find((button) => button.text === "Resume goal").click();
  expect(mocks.request).toHaveBeenCalledWith("/api/projects/fixture/sessions/one/agent-goal", {
    method: "POST", body: { action: "resume", threadId: "thread-one", objective: "Finish migration", createdAt: 10 }
  });
  expect(mocks.goalResource.reload).toHaveBeenCalledOnce();
  mocks.goal = null;
});

it("offers Pause and the compact running dot only for an active goal", async () => {
  for (const status of ["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"]) {
    mocks.goal = { status: "available", goal: { status, objective: "Finish migration" } };
    const html = await render({ status: "available", windows: [{ remainingPercent: 1, windowDurationMins: 10080 }] });
    expect(html.includes("Pause goal")).toBe(status === "active");
    expect(html.includes('class="codex-plan-usage__running"')).toBe(status === "active");
  }
  mocks.goal = null;
});
