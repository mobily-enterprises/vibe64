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
async function render(value, selection) {
  const instance = createSSRApp(RoutingNotice, { request: value, selection });
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

it("shows Resume workflow and Stop for every retained unsent stage on desktop and mobile", async () => {
  for (const stage of ["planning", "implementation", "review"]) {
    const value = request(stage, "pending", { error: "Scheduling disconnected before the handoff was sent." });
    const html = await render(value);
    expect(html).toContain("Resume workflow"); expect(html).toMatch(/>\s*Stop\s*</u);
    expect(html).toContain(value.error); expect(html).toContain("flex-wrap");
  }
});

it("shows Check delivery without an unsent-handoff Stop for uncertain stage delivery", async () => {
  for (const stage of ["planning", "implementation", "review"]) {
    const html = await render(request(stage, "uncertain"));
    expect(html).toContain("Check delivery"); expect(html).not.toMatch(/>\s*Stop\s*</u);
  }
});

it("can resume a stopped first implementation without an existing follow-up", async () => {
  const value = request("implementation", "accepted", { stopped: true, followup: null, error: "Paused at your request." });
  expect(mount(value).state().followupNeedsAction).toBe(true);
  const html = await render(value); expect(html).toContain("Resume workflow"); expect(html).toContain("Paused at your request.");
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
