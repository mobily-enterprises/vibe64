import { createSSRApp, h, ref } from "vue";
import { renderToString } from "@vue/server-renderer";
import { expect, it, vi } from "vitest";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";

const mocks = vi.hoisted(() => ({
  resource: null,
  options: null,
  realtime: null,
  goal: null,
  goalResource: null,
  goalOptions: null,
  buttons: [],
  request: vi.fn()
}));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource(options) {
    if (options.path.value.endsWith("/agent-goal")) {
      mocks.goalOptions = options;
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
vi.mock("vuetify/components/VTextarea", async () => {
  const { h } = await import("vue");
  return { VTextarea: { setup: (_, { attrs }) => () => h("textarea", { "aria-label": attrs.label }) } };
});
vi.mock("vuetify/components/VTextField", async () => {
  const { h } = await import("vue");
  return { VTextField: { setup: (_, { attrs }) => () => h("input", { "aria-label": attrs.label }) } };
});
import PlanUsage from "../../src/components/studio/vibe64-session/Vibe64AgentPlanUsage.vue";

async function render(data, props = {}, viewer = { actorKey: "local" }) {
  mocks.resource = { data: ref(data), loadError: ref(""), reload: vi.fn() };
  return renderToString(createSSRApp({ render: () => h(PlanUsage, {
    active: true, session: { sessionId: "one", assistantSelection: { engineId: "codex" } },
    sessionsApiPath: "/api/projects/fixture/sessions", ...props
  }) }).provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer));
}

it("separates cached goal and allowance data by viewer and disables both when signed out", async () => {
  const viewer = ref({ actorKey: "owner" });
  await render(null, {}, viewer);
  const ownerUsage = [...mocks.options.queryKey.value];
  const ownerGoal = [...mocks.goalOptions.queryKey.value];
  viewer.value = { actorKey: "member" };
  expect(mocks.options.queryKey.value).not.toEqual(ownerUsage);
  expect(mocks.goalOptions.queryKey.value).not.toEqual(ownerGoal);
  expect(mocks.options.queryKey.value.at(-1)).toBe("member");
  expect(mocks.goalOptions.queryKey.value.at(-1)).toBe("member");
  viewer.value = { actorKey: "" };
  expect(mocks.options.enabled.value).toBe(false);
  expect(mocks.goalOptions.enabled.value).toBe(false);
});

it("keeps retained goal controls on their own engine after a foreign chat turn", async () => {
  mocks.goal = { status: "available", routing: { selection: { engineId: "claude" } },
    goal: { status: "paused", objective: "Finish the implementation", threadId: "claude-goal" } };
  const html = await render(null, { session: { sessionId: "one", assistantSelection: { engineId: "opencode" } } });
  expect(html).toContain("Resume goal");
  expect(html).toContain("Cancel goal");
  expect(mocks.goalOptions.enabled.value).toBe(true);
  expect(mocks.options.enabled.value).toBe(false);
  mocks.goal = null;
});
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

it("keeps passive allowance and goal lookup failures out of app-wide network recovery", async () => {
  await render(null);
  expect(mocks.options.queryOptions.meta.jskit.requestRecovery).toBe(false);
  expect(mocks.goalOptions.queryOptions.meta.jskit.requestRecovery).toBe(false);
});

it("gives both passive status requests the agreed 30-second deadline", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  try {
    await render(null);
    await mocks.options.queryOptions.queryFn({ signal: controller.signal });
    await mocks.goalOptions.queryOptions.queryFn({ signal: controller.signal });
    expect(timeout.mock.calls).toEqual([[30_000], [30_000]]);
  } finally {
    timeout.mockRestore();
  }
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
    expect(html).toContain("Cancel goal");
    expect(html).not.toContain("Codex plan allowance");
  }
  mocks.goal = { status: "available", goal: { status: "complete", objective: "Finished" } };
  const complete = await render(null);
  expect(complete).not.toContain("Resume goal");
  expect(complete).not.toContain("Pause goal");
  expect(complete).not.toContain("Cancel goal");
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

it("uses the shared running and paused indicators for native goal state", async () => {
  for (const status of ["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"]) {
    mocks.goal = { status: "available", goal: { status, objective: "Finish migration" } };
    const html = await render({ status: "available", windows: [{ remainingPercent: 1, windowDurationMins: 10080 }] });
    expect(html.includes("Pause goal")).toBe(status === "active");
    expect(html.includes("Cancel goal")).toBe(status !== "complete");
    expect(html.includes("assistant-goal__light--running")).toBe(status === "active");
    expect(html.includes("assistant-goal__light--paused")).toBe(status === "paused");
  }
  mocks.goal = null;
});

it("cancels the exact displayed goal without sending a resume action", async () => {
  mocks.buttons = [];
  const objective = "Finish the approved implementation. ".repeat(20);
  mocks.goal = { status: "available", goal: { threadId: "thread-blocked", status: "blocked", objective, createdAt: 30 } };
  mocks.request.mockClear();
  mocks.request.mockResolvedValueOnce({ ok: true, status: "available", goal: null });
  await render(null);
  await mocks.buttons.find((button) => button.text.trim() === "Cancel goal").click();
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith("/api/projects/fixture/sessions/one/agent-goal", {
    method: "POST", body: { action: "cancel", threadId: "thread-blocked", objective, createdAt: 30 }
  });
  expect(mocks.goalResource.reload).toHaveBeenCalledOnce();
  mocks.goal = null;
});

it("previews long goals without changing the exact objective used by Pause", async () => {
  mocks.buttons = [];
  const objective = "Complete the approved implementation and verification plan. ".repeat(40);
  mocks.goal = { status: "available", goal: { threadId: "thread-long", status: "active", objective, createdAt: 20 } };
  mocks.request.mockResolvedValueOnce({ ok: true });
  const html = await render(null);
  expect(html).toContain(`${objective.slice(0, 140).trimEnd()}…`);
  expect(html).not.toContain(objective);
  expect(html).toContain("View full goal");
  await mocks.buttons.find((button) => button.text === "Pause goal").click();
  expect(mocks.request).toHaveBeenLastCalledWith("/api/projects/fixture/sessions/one/agent-goal", {
    method: "POST", body: { action: "pause", threadId: "thread-long", objective, createdAt: 20 }
  });
  mocks.goal = null;
});

it("offers goal creation before the first goal and hides it for OpenCode", async () => {
  mocks.goal = { status: "available", threadId: "", goal: null };
  expect(await render(null)).toContain("Goal objective");
  expect(await render(null, { session: { sessionId: "one", assistantSelection: { engineId: "opencode" } } })).not.toContain("Goal objective");
  mocks.goal = null;
});


it("shows Claude allowance and native goal controls without an unsupported token budget", async () => {
  mocks.goal = { status: "available", goal: null };
  const props = { session: { sessionId: "one", assistantSelection: { engineId: "claude" } } };
  const html = await render({ status: "available", windows: [
    { id: "seven_day_opus", remainingPercent: 5, windowDurationMins: 10080 },
    { id: "seven_day", remainingPercent: 61, windowDurationMins: 10080 },
    { id: "five_hour", remainingPercent: 20, windowDurationMins: 300 }
  ] }, props);
  expect(mocks.options.enabled.value).toBe(true);
  expect(html).toContain("Weekly Claude allowance remaining: 61%");
  expect(html).toContain("5h allowance remaining: 20%");
  expect(html).toContain("opus: 5% weekly remaining");
  expect(html).toContain("Set a Claude goal");
  expect(html).not.toContain("Token budget");
  mocks.goal = { status: "available", goal: { status: "active", objective: "Make tests pass" } };
  const running = await render(null, props);
  expect(running).toContain("Pause goal");
  expect(running).toContain("Pause stops the current turn");
  mocks.goal = null;
});
