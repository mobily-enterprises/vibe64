import { createRenderer, createSSRApp, h, nextTick, ref, ssrContextKey } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { afterEach, expect, it, vi } from "vitest";

const feedback = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@jskit-ai/shell-web/client/error", () => ({ useShellWebErrorRuntime: () => feedback }));
import RoutingNotice from "../../src/components/studio/vibe64-session/Vibe64RoutingNotice.vue";

let app;
afterEach(() => { app?.unmount(); feedback.report.mockReset(); });
function mount(request) {
  const props = ref({ request, active: true, mode: "auto" });
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const notice = ref();
  const component = { ...RoutingNotice, render: () => null };
  app = renderer.createApp({ render: () => h(component, { ...props.value, ref: notice }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { props, state: () => notice.value.$.setupState };
}

const request = (stage = "review", delivery = "pending", extra = {}) => ({ messageId: "workflow", status: "waiting",
  stage, workflow: true, delivery, resolvedMode: "junior", followup: { messageId: "followup" }, ...extra });
async function render(value, selection, props = {}) {
  const instance = createSSRApp(RoutingNotice, { request: value, selection, mode: "auto", ...props });
  instance.use(createVuetify());
  return renderToString(instance);
}

it("keeps normal routing and active review in chat without a composer alert", async () => {
  for (const delivery of ["routing", "sending", "accepted"]) {
    const value = request("review", delivery, { status: "working", outcome: { decision: "handoff", explanation: "Ready for review." } });
    expect(mount(value).state().actionable).toBe(false);
    const html = await render(value);
    expect(html).not.toContain("v-alert"); expect(html).not.toContain("Ready for review."); app.unmount();
  }
});

it("names only the retained stage's continuation on desktop and mobile", async () => {
  for (const [stage, label] of Object.entries({ planning: "Continue planning", implementation: "Continue implementation", review: "Continue review" })) {
    const value = request(stage, "pending", { error: "Scheduling disconnected before the handoff was sent." });
    const html = await render(value);
    expect(html).toContain(label); expect(html).not.toContain("Resume workflow"); expect(html).toMatch(/>\s*Stop\s*</u);
    expect(html).not.toContain("Implement plan");
    expect(html).toContain(value.error); expect(html).toContain("flex-wrap");
  }
});

it("collapses long explanations by default while keeping stage actions visible", async () => {
  const value = request("planning", "pending", { error: "Planning finished; explicit implementation authorization is required.",
    workPlan: { status: "active", revision: "saved-plan" } });
  const html = await render(value);
  const details = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/u)?.[0];
  expect(details).toContain("Details"); expect(details).toContain(value.error);
  expect(details).not.toMatch(/<details[^>]*\bopen/u);
  expect(details).not.toContain("Implement plan");
  expect(html.slice(html.indexOf("</details>"))).toContain("Implement plan");
  expect(html).not.toContain("v-alert__prepend");
});

it("keeps a waiting outcome in history with only actions above the composer", async () => {
  const explanation = "The saved plan needs implementation approval.";
  const html = await render(request("planning", "pending", { error: explanation,
    outcome: { decision: "wait", explanation }, workPlan: { status: "active", revision: "saved-plan" } }));
  expect(html).toContain("Implement plan"); expect(html).toContain("View plan");
  expect(html).not.toContain(explanation); expect(html).not.toContain("Details");
  expect(html).not.toContain("Planning waiting");
  const recovery = await render(request("planning", "uncertain", { error: "Delivery receipt lost.", outcome: { explanation } }));
  expect(recovery).toContain("Delivery receipt lost."); expect(recovery).toContain("Check delivery");
});

it("shows Check delivery without an unsent-handoff Stop for uncertain stage delivery", async () => {
  for (const stage of ["planning", "implementation", "review"]) {
    const html = await render(request(stage, "uncertain"));
    expect(html).toContain("Check delivery"); expect(html).not.toMatch(/>\s*Stop\s*</u);
  }
});

it("keeps a refused workflow action visible beside its retry control", async () => {
  const html = await render(request("review", "pending"), null, { actionError: "The retained plan changed." });
  expect(html).toContain("Continue review");
  expect(html).toContain("The retained plan changed.");
  expect(html).toContain('role="alert"');
});

it("can resume a stopped first implementation without an existing follow-up", async () => {
  const value = request("implementation", "accepted", { stopped: true, followup: null, error: "Paused at your request." });
  expect(mount(value).state().followupNeedsAction).toBe(true);
  const html = await render(value); expect(html).toContain("Continue implementation"); expect(html).toContain("Paused at your request.");
});

it("offers explicit implementation and plan viewing only for a saved active plan at the waiting planning stage", async () => {
  const value = request("planning", "pending", { workflow: false, workPlan: { status: "active", revision: "saved-plan" } });
  const html = await render(value);
  expect(html).toContain("Implement plan"); expect(html).toContain("View plan"); expect(html).not.toContain("Continue planning");
  expect(html).not.toContain("Continue implementation"); expect(html).not.toContain("Continue review");
  expect(html).not.toContain("starts coding the saved plan");
  for (const changed of [
    { delivery: "uncertain" }, { status: "working" }, { stage: "implementation" }, { stage: "review" },
    { workPlan: null }, { workPlan: { status: "completed", revision: "done" } }, { helper: { executionId: "pending-cleanup" } }
  ]) expect(await render({ ...value, ...changed })).not.toContain("Implement plan");
  expect(await render(value, null, { mode: "senior" })).not.toContain("Implement plan");
  const busy = await render(value, null, { busy: true });
  expect(busy).toMatch(/disabled[^>]*>[\s\S]*?Implement plan/u);
});

it("keeps initial delivery failures in their message bubble", () => {
  const f = mount(request(null, "failed", { followup: null, workflow: false, error: "Reconnect the AI" }));
  expect(f.state().actionable).toBe(false);
});

it("retains cleanup failures until helper ownership is resolved", async () => {
  const value = request(null, "failed", { stopped: true, workflow: false, followup: null, helper: { executionId: "owned" }, error: "Cleanup failed" });
  const f = mount(value); expect(f.state().actionable).toBe(true);
  f.props.value.request = { ...value, helper: null }; await nextTick(); expect(f.state().actionable).toBe(false);
  expect(f.props.value.request.error).toBe("Cleanup failed");
});

it("does not replay waiting or stopped notices when restored or when hidden", async () => {
  const f = mount(request("review", "pending", { stopped: true })); await nextTick(); expect(feedback.report).not.toHaveBeenCalled();
  f.props.value = { active: false, request: request("review", "accepted", { status: "working" }) }; await nextTick();
  f.props.value.request = request("review", "accepted", { stopped: true }); await nextTick(); expect(feedback.report).not.toHaveBeenCalled();
});

it("reports a newly stopped active workflow once through the snackbar", async () => {
  const f = mount(request("review", "accepted", { status: "working" }));
  f.props.value.request = request("review", "accepted", { stopped: true }); await nextTick();
  expect(feedback.report).toHaveBeenCalledWith(expect.objectContaining({ message: "Paused at your request.", channel: "snackbar" }));
  f.props.value.request = { ...f.props.value.request }; await nextTick(); expect(feedback.report).toHaveBeenCalledTimes(1);
});

it("explains an old uncertain attempt after changing assistants while preserving its receipt", async () => {
  const original = { engineId: "claude", modelProviderId: "anthropic", modelId: "opus", agentId: "claude", variantId: "medium" };
  const selection = { engineId: "codex", modelProviderId: "openai", modelId: "gpt-6-astra", agentId: "codex", variantId: "high" };
  const value = request("implementation", "uncertain", { stopped: true, attemptedMessageId: "original-delivery", deliverySelection: original, error: "Original receipt unknown." });
  const f = mount(value); expect(f.state().previousAttempt).toBe(false);
  f.props.value.selection = selection; await nextTick(); expect(f.state().previousAttempt).toBe(true);
  const html = await render(value, selection); expect(html).toContain("Previous assistant delivery unconfirmed");
  expect(html).toContain("Send a new message to continue with your selected assistant."); expect(html).toContain("Check delivery only checks the previous attempt.");
  expect(html).toContain("Check delivery"); expect(value.attemptedMessageId).toBe("original-delivery");
});

it("immediately labels the submitted action while preventing another submission", async () => {
  const value = request("planning", "pending", { workPlan: { status: "active", revision: "saved-plan" } });
  for (const [pendingAction, label] of [["continue", "Continuing…"], ["implement", "Starting…"]]) {
    const html = await render({ ...value, ...(pendingAction === "continue" ? { workPlan: null } : {}) }, null, { pendingAction });
    expect(html).toContain(label); expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/disabled[^>]*>[\s\S]*(Implement plan|Continue planning)/u);
    expect(html).not.toContain("View plan"); expect(html).not.toMatch(/>\s*Stop\s*</u);
  }
  expect(await render({ ...value, delivery: "uncertain" }, null, { pendingAction: "continue" })).toContain("Checking…");
  expect(await render(value)).not.toContain("Continuing…");
});
