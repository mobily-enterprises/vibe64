import { createRenderer, h, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";

const feedback = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@jskit-ai/shell-web/client/error", () => ({ useShellWebErrorRuntime: () => feedback }));
import RoutingNotice from "../../src/components/studio/vibe64-session/Vibe64RoutingNotice.vue";

let app;
afterEach(() => { app?.unmount(); feedback.report.mockReset(); });
function mount(request) {
  const props = ref({ request, active: true });
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const notice = ref();
  const component = { ...RoutingNotice, render: () => null };
  app = renderer.createApp({ render: () => h(component, { ...props.value, ref: notice }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { props, state: () => notice.value.$.setupState };
}

it("keeps normal routing in the message bubble and reports review interruption once through the transient snackbar", async () => {
  const request = { messageId: "one", status: "routing", resolvedMode: "code", review: true };
  const f = mount(request);
  expect(f.state().actionable).toBe(false);
  f.props.value.request = { ...request, status: "sent" };
  await nextTick();
  expect(f.state().actionable).toBe(false);
  f.props.value.request = { ...request, status: "done", reviewStatus: "skipped_incomplete" };
  await nextTick();
  expect(f.state().actionable).toBe(false);
  expect(feedback.report).toHaveBeenCalledWith(expect.objectContaining({
    message: "Coding stopped. Automatic review was skipped.", severity: "info", channel: "snackbar"
  }));
  f.props.value.request = { ...f.props.value.request };
  await nextTick();
  expect(feedback.report).toHaveBeenCalledTimes(1);
});

it("does not replay finished notices on restore, background completion or Plan completion", async () => {
  const request = { messageId: "old", status: "done", resolvedMode: "code", reviewStatus: "cancelled" };
  const f = mount(request);
  await nextTick();
  expect(feedback.report).not.toHaveBeenCalled();
  f.props.value = { active: false, request: { ...request, messageId: "new", status: "sent" } };
  await nextTick();
  f.props.value.request.status = "done";
  await nextTick();
  f.props.value = { active: true, request: { ...request, messageId: "plan", status: "sent", resolvedMode: "plan" } };
  await nextTick();
  f.props.value.request.status = "done";
  await nextTick();
  expect(feedback.report).not.toHaveBeenCalled();
  expect(f.state().actionable).toBe(false);
});

it("keeps failures and review recovery controls visible", async () => {
  const f = mount({ messageId: "one", status: "failed", error: "Reconnect the AI" });
  expect(f.state().actionable).toBe(true);
  for (const status of ["review_pending", "review_uncertain"]) {
    f.props.value.request = { messageId: "one", status };
    await nextTick();
    expect(f.state().actionable).toBe(true);
    expect(f.state().followupNeedsAction).toBe(true);
  }
  expect(feedback.report).not.toHaveBeenCalled();
});

it("only offers implementation for a ready plan after completion; paused and revised plans stay read-only", async () => {
  const request = { messageId: "planned", status: "done", resolvedMode: "plan", workPlan: { status: "ready", revision: "one", text: "Detailed plan" } };
  const f = mount(request);
  expect(f.state().planReady).toBe(true);
  f.props.value.request = { ...request, status: "sent" };
  await nextTick();
  expect(f.state().planReady).toBe(false);
  expect(f.state().planStage).toBe("Planning");
  f.props.value.request.resolvedMode = "code";
  await nextTick();
  expect(f.state().planStage).toBe("Coding");
  for (const status of ["drafting", "paused", "blocked", "implemented"]) {
    f.props.value.request = { ...request, workPlan: { ...request.workPlan, status } };
    await nextTick();
    expect(f.state().planReady).toBe(false);
  }
  f.props.value.request = { ...request, error: "Plan changed" };
  await nextTick();
  expect(f.state().planReady).toBe(false);
});

it("shows recovery controls for a stopped planning handoff", () => {
  const f = mount({ status: "planning_pending", continuation: "plan", resolvedMode: "code", assignments: { plan: { engineId: "codex", modelId: "gpt-6-astra" } } });
  expect(f.state().actionable).toBe(true);
  expect(f.state().label).toBe("Back to planning · codex · gpt-6-astra");
});

it("leaves a mixed-request explanation on the unsent bubble instead of adding another banner", () => {
  const f = mount({ status: "failed", reason: "mixed_deslop_request", error: "Please request feature work and Deslop separately." });
  expect(f.state().actionable).toBe(false);
  expect(feedback.report).not.toHaveBeenCalled();
});
