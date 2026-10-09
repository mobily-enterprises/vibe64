import { computed, createSSRApp, h, ref } from "vue";
import { renderToString } from "@vue/server-renderer";
import { expect, it, vi } from "vitest";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";

const mocks = vi.hoisted(() => ({
  resource: null,
  options: null,
  realtime: null,
  goal: null,
  goalView: null,
  goalController: null,
  resources: [],
  buttons: [],
  request: vi.fn()
}));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource(options) {
    mocks.resources.push(options);
    mocks.options = options;
    return mocks.resource;
  }
}));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    const payload = { projectSlug: "fixture", sessionId: "one", reason: "agent-plan-usage" };
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
  mocks.resources = [];
  mocks.goalView = ref(mocks.goal);
  mocks.goalController = {
    goalView: mocks.goalView, goalLoadError: ref(""),
    goalState: computed(() => ({ enabled: Boolean(mocks.goalView.value), pending: false, error: "",
      cancel: () => mocks.goalController.changeGoal("cancel", {}) })),
    changeGoal: vi.fn().mockResolvedValue({ ok: true })
  };
  return renderToString(createSSRApp({ render: () => h(PlanUsage, {
    active: true, session: { sessionId: "one", assistantSelection: { engineId: "codex" } },
    sessionsApiPath: "/api/projects/fixture/sessions", conversationRuntime: mocks.goalController, ...props
  }) }).provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer));
}

it("separates allowance data by viewer and leaves goal ownership in the supplied binding", async () => {
  const viewer = ref({ actorKey: "owner" });
  await render(null, {}, viewer);
  const ownerUsage = [...mocks.options.queryKey.value];
  viewer.value = { actorKey: "member" };
  expect(mocks.options.queryKey.value).not.toEqual(ownerUsage);
  expect(mocks.options.queryKey.value.at(-1)).toBe("member");
  viewer.value = { actorKey: "" };
  expect(mocks.options.enabled.value).toBe(false);
  expect(mocks.resources).toHaveLength(1);
  expect(mocks.resources.every(resource => !resource.path.value.endsWith("/agent-goal"))).toBe(true);
});

it("keeps retained goal controls on their own engine after a foreign chat turn", async () => {
  mocks.goal = { status: "available", routing: { selection: { engineId: "claude" } },
    goal: { status: "paused", objective: "Finish the implementation", threadId: "claude-goal" } };
  const html = await render(null, { session: { sessionId: "one", assistantSelection: { engineId: "opencode" } } });
  expect(html).toContain("Resume goal");
  expect(html).toContain("Cancel goal");
  expect(mocks.goalController.goalView.value.routing.selection.engineId).toBe("claude");
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

it.each([
  ["deepseek", "DeepSeek", "https://platform.deepseek.com/top_up"],
  ["zai", "GLM", "https://z.ai/manage-apikey/billing"]
])("shows only the currency amount for %s across all three orchestrators", async (modelProviderId, providerLabel, managementUrl) => {
  for (const engineId of ["codex", "claude", "opencode"]) {
    mocks.buttons = [];
    const assistantSelection = { engineId, modelProviderId };
    const html = await render({ ...assistantSelection, status: "available", kind: "balance",
      balances: [{ currency: "USD", amount: "12.40" }], windows: [], providerLabel,
      managementUrl, checkedAt: Date.now()
    }, { session: { sessionId: "one", assistantSelection } });
    expect(mocks.buttons.some(button => button.text.trim() === "$12.40")).toBe(true);
    expect(html).not.toContain("US$");
    expect(html).toContain("USD balance remaining: $12.40");
    expect(html).toContain(`${providerLabel} balance`);
    expect(html).toContain("Account balance associated with this key");
    expect(html).toContain("Checked ");
    expect(html).toContain(managementUrl);
    expect(mocks.buttons.some(button => button.text.trim() === "Refresh")).toBe(false);
    expect(mocks.options.queryOptions.refetchInterval()).toBe(false);
    expect(mocks.options.enabled.value).toBe(true);
    expect(mocks.realtime.matches({ payload: { projectSlug: "fixture", sessionId: "one", reason: "agent-plan-usage" } })).toBe(true);
    mocks.realtime.onEvent();
    expect(mocks.resource.reload).toHaveBeenCalledOnce();
  }
});

it("uses the supplied balance currency and shows a confirmed zero", async () => {
  const assistantSelection = { engineId: "codex", modelProviderId: "deepseek" };
  const html = await render({ ...assistantSelection, status: "available", balances: [{ currency: "CNY", amount: "0" }],
    windows: [], providerLabel: "DeepSeek", checkedAt: Date.now()
  }, { session: { sessionId: "one", assistantSelection } });
  expect(html).toContain("CNY balance remaining: ¥0.00");
});

it("shows GLM's weekly quota, or its supplied short window when no weekly quota is returned", async () => {
  for (const engineId of ["codex", "claude", "opencode"]) {
    const assistantSelection = { engineId, modelProviderId: "zai-coding-plan" };
    const data = { ...assistantSelection, status: "available", providerLabel: "GLM", checkedAt: Date.now(),
      windows: [{ id: "0", windowDurationMins: 300, remainingPercent: 40 }, { id: "1", windowDurationMins: 10080, remainingPercent: 68 }] };
    const props = { session: { sessionId: "one", assistantSelection } };
    expect(await render(data, props)).toContain("Weekly GLM allowance remaining: 68%");
    expect(await render({ ...data, windows: data.windows.slice(0, 1) }, props)).toContain("GLM allowance remaining: 40%");
  }
});

it("hides unavailable and mismatched provider readings during an Auto handoff", async () => {
  const assistantSelection = { engineId: "codex", modelProviderId: "zai-coding-plan" };
  const props = { session: { sessionId: "one", assistantSelection } };
  for (const data of [
    { status: "available", engineId: "codex", modelProviderId: "deepseek", balances: [{ currency: "USD", amount: "12.40" }] },
    { status: "available", engineId: "opencode", modelProviderId: "zai-coding-plan", windows: [{ remainingPercent: 68 }] },
    { ...assistantSelection, status: "unavailable", windows: [] }
  ]) {
    mocks.buttons = [];
    await render(data, props);
    expect(mocks.buttons.some(button => /%|\$/.test(button.text))).toBe(false);
  }
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
  expect(mocks.resources).toHaveLength(1); // Shared binding owns passive goal failure; no second query resource.
});

it("keeps the allowance deadline while the shared binding owns the goal deadline", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  try {
    await render(null);
    await mocks.options.queryOptions.queryFn({ signal: controller.signal });
    expect(timeout.mock.calls).toEqual([[30_000]]);
    expect(mocks.resources).toHaveLength(1);
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

it("delegates explicit status changes for the displayed goal to the supplied controller", async () => {
  mocks.buttons = [];
  mocks.goal = { status: "available", goal: { threadId: "thread-one", status: "paused", objective: "Finish migration", createdAt: 10 } };
  await render(null);
  mocks.goalController.changeGoal.mockResolvedValueOnce(false);
  mocks.request.mockClear();
  await mocks.buttons.find((button) => button.text === "Resume goal").click();
  expect(mocks.goalController.changeGoal).toHaveBeenCalledExactlyOnceWith("resume", {});
  expect(mocks.goalView.value.goal).toEqual(mocks.goal.goal);
  expect(mocks.request).not.toHaveBeenCalled();
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
  const html = await render(null);
  expect(mocks.buttons.filter((button) => button.text.trim() === "Cancel goal")).toHaveLength(1);
  expect(html.match(/Cancel removes this goal\. Use Stop to interrupt a turn already running\./g)).toHaveLength(1);
  await mocks.buttons.find((button) => button.text.trim() === "Cancel goal").click();
  expect(mocks.goalController.changeGoal).toHaveBeenCalledExactlyOnceWith("cancel", {});
  expect(mocks.goalView.value.goal).toEqual({ threadId: "thread-blocked", status: "blocked", objective, createdAt: 30 });
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.goal = null;
});

it("previews long goals without changing the exact objective used by Pause", async () => {
  mocks.buttons = [];
  const objective = "Complete the approved implementation and verification plan. ".repeat(40);
  mocks.goal = { status: "available", goal: { threadId: "thread-long", status: "active", objective, createdAt: 20 } };
  const html = await render(null);
  expect(html).toContain(`${objective.slice(0, 140).trimEnd()}…`);
  expect(html).not.toContain(objective);
  expect(html).toContain("View full goal");
  await mocks.buttons.find((button) => button.text === "Pause goal").click();
  expect(mocks.goalController.changeGoal).toHaveBeenCalledExactlyOnceWith("pause", {});
  expect(mocks.goalView.value.goal.objective).toBe(objective);
  mocks.goal = null;
});

it("offers goal creation before the first goal and hides it for OpenCode", async () => {
  mocks.goal = { status: "available", threadId: "", goal: null };
  expect(await render(null)).toContain("Goal objective");
  expect(await render(null, { session: { sessionId: "one", assistantSelection: { engineId: "opencode" } } })).not.toContain("Goal objective");
  mocks.goal = null;
});

it("explains Auto before goal creation or resume while keeping pause and cancel available", async () => {
  for (const engineId of ["codex", "claude"]) {
    const props = { session: { sessionId: "one", assistantSelection: { engineId },
      metadata: { assistant_routing: JSON.stringify({ schemaVersion: 4, workflowEngineId: engineId, mode: "auto", review: false }) } } };
    for (const status of [null, "paused", "active"]) {
      mocks.goal = { status: "available", goal: status ? { status, objective: "Finish the agreed work" } : null };
      const html = await render(null, props);
      expect(html).toContain("Choose Senior or Junior before starting or resuming a goal.");
      expect(html).not.toContain("Goal objective");
      expect(html).not.toContain("Start goal");
      expect(html).not.toContain("Resume goal");
      expect(html.includes("Pause goal")).toBe(status === "active");
      expect(html.includes("Cancel goal")).toBe(Boolean(status));
    }
  }
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

it("preserves the displayed native goal identity through the actual shared control and HTTP request", async () => {
  const { createHash } = await import("node:crypto");
  const { createRenderer, reactive, nextTick } = await import("vue");
  const { useAssistantConversation } = await import("@jskit-ai/assistant-runtime/client");
  const { createAssistantApi } = await import("@jskit-ai/assistant-core/client");
  const { createConversationFixtureSocket, provideConversationFixture } = await import("./helpers/conversationRuntimeFixture.js");
  const objective = "Complete the approved implementation and verification plan. ".repeat(40);
  const nativeGoal = { threadId: "thread-long", createdAt: 20, objective };
  // The canonical ID retains all three original stale-goal tuple fields. The
  // common transport deliberately does not expose the native thread tuple.
  const goalId = createHash("sha256").update(JSON.stringify([
    nativeGoal.threadId, nativeGoal.createdAt, nativeGoal.objective
  ])).digest("hex");
  const capabilities = { goals: true, goalBudgets: true,
    goalCommands: Object.fromEntries(["set", "pause", "resume", "cancel"].map(action =>
      [action, { delivery: "control", interruptsTurn: false }])) };
  const selected = ref("goal-ui-one");
  const viewer = ref({ actorKey: "goal-ui-owner" });
  const views = new Map([
    ["goal-ui-one", { status: "available", goal: { id: goalId, objective, status: "active" },
      target: { segmentId: "codex:thread-long", capabilities }, routing: { selection: { engineId: "codex" } } }],
    ["goal-ui-two", { status: "available", goal: { id: "successor-goal", objective: "Another goal", status: "active" },
      target: { segmentId: "codex:successor-thread", capabilities }, routing: { selection: { engineId: "codex" } } }]
  ]);
  const snapshots = new Map();
  const read = id => {
    if (!snapshots.has(id)) snapshots.set(id, reactive({ id, segmentId: "codex:visible-thread", status: "working",
      capabilities, conversationLog: [] }));
    return snapshots.get(id);
  };
  const socket = createConversationFixtureSocket(read);
  let reply = async () => ({ ok: true });
  const request = vi.fn(async (url, options) => {
    const id = decodeURIComponent(url.split("/conversations/")[1].split("/")[0]);
    if (options.method === "GET") return url.endsWith("/goal") ? structuredClone(views.get(id)) : read(id);
    return reply(url, options);
  });
  const api = createAssistantApi({ request, resolveBasePath: () => "/api/assistant/app", resolveSurfaceId: () => "app" });
  const renderer = createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setElementText() {}, setText() {}, insert() {}, remove() {}, patchProp() {}, parentNode() {}, nextSibling() {} });
  let binding;
  const app = renderer.createApp({ setup() {
    binding = useAssistantConversation({ conversationId: () => selected.value, actorKey: () => viewer.value.actorKey,
      surfaceId: "app", hostSurfaceId: "app", workspaceSlug: "", goal: true, api, socket });
    return () => h("div");
  } });
  provideConversationFixture(app, socket, viewer.value.actorKey);
  app.mount({});
  const writes = () => request.mock.calls.filter(([, options]) => options.method === "POST");
  const goalReads = id => request.mock.calls.filter(([url, options]) =>
    options.method === "GET" && url === `/api/assistant/app/conversations/${id}/goal`);
  try {
    await vi.waitFor(() => expect(binding.runtime.value.goalView.value).toEqual(views.get("goal-ui-one")));
    const original = binding.runtime.value;
    for (const [action, status, label] of [["pause", "active", "Pause goal"], ["resume", "paused", "Resume goal"],
      ["cancel", "blocked", "Cancel goal"]]) {
      views.get("goal-ui-one").goal.status = status;
      await original.refreshGoal();
      mocks.buttons = [];
      const html = await render(null, { conversationRuntime: original });
      if (action === "pause") {
        expect(html).toContain(`${objective.slice(0, 140).trimEnd()}…`);
        expect(html).not.toContain(objective);
        expect(html).toContain("View full goal");
      }
      const before = writes().length;
      const readsBefore = goalReads("goal-ui-one").length;
      reply = async () => action === "resume" ? { ok: false, error: "Goal changed" } : { ok: true };
      await mocks.buttons.find(button => button.text.trim() === label).click();
      expect(writes().slice(before)).toEqual([["/api/assistant/app/conversations/goal-ui-one/goal", {
        method: "POST", signal: undefined, headers: { "x-jskit-surface": "app" },
        body: { action, expectedSegmentId: "codex:thread-long", expectedGoalId: goalId }
      }]]);
      expect(goalReads("goal-ui-one").length).toBeGreaterThan(readsBefore);
      expect(original.goalView.value.goal.objective).toBe(objective);
      expect(original.snapshot.value.status).toBe("working");
      expect(original.delivery.state.messages).toEqual([]);
      if (action === "resume") expect(original.goalState.value.error).toBe("Goal changed");
    }
    // A selected foreign chat thread cannot replace the separately pinned goal
    // target. A late old control reply must not clear or refresh a new owner.
    expect(original.snapshot.value.segmentId).toBe("codex:visible-thread");
    expect(original.goalView.value.target.segmentId).toBe("codex:thread-long");
    views.get("goal-ui-one").goal.status = "active";
    await original.refreshGoal();
    mocks.buttons = [];
    await render(null, { conversationRuntime: original });
    let finish;
    reply = () => new Promise(resolve => { finish = resolve; });
    const pending = mocks.buttons.find(button => button.text.trim() === "Pause goal").click();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const originalReads = goalReads("goal-ui-one").length;
    selected.value = "goal-ui-two";
    await nextTick();
    await vi.waitFor(() => expect(binding.runtime.value.goalView.value).toEqual(views.get("goal-ui-two")));
    const successor = binding.runtime.value;
    const successorReads = goalReads("goal-ui-two").length;
    finish({ ok: false, error: "Old goal changed" });
    await pending;
    expect(goalReads("goal-ui-one")).toHaveLength(originalReads);
    expect(goalReads("goal-ui-two")).toHaveLength(successorReads);
    expect(successor.goalView.value).toEqual(views.get("goal-ui-two"));
    expect(successor.goalState.value.error).toBe("");
    expect(successor.goalState.value.pending).toBe(false);
    expect(writes()).toHaveLength(4);
    expect(writes().every(([url]) => url === "/api/assistant/app/conversations/goal-ui-one/goal")).toBe(true);
  } finally {
    app.unmount();
    mocks.buttons = [];
    mocks.goal = null;
  }
});
