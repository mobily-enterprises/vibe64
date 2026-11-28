import { computed, createRenderer, createSSRApp, h, nextTick, reactive, ref, ssrContextKey } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { afterEach, expect, it, vi } from "vitest";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "@jskit-ai/shell-web/client/error";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import RoutingNotice from "../../src/components/studio/vibe64-session/Vibe64RoutingNotice.vue";

// Main chat's workflow actions as the person presses them above its composer: the chat's own setup, with the
// composer's other parts stubbed, and the notice rendered from what the chat passes it. The shell's error runtime,
// which shows the snackbar, is the app's, as the shell provides it.
const feedback = { report: vi.fn(() => ({})), dismiss: vi.fn() };
vi.mock("@jskit-ai/assistant-core/client/conversation", () => ({
  AssistantQuestionInputs: { render: () => null }, AssistantComposerSupport: { render: () => null }
}));
vi.mock("../../src/composables/useVibe64MainChatPromptHints.js", () => ({ useVibe64MainChatPromptHints: () => ({}) }));
vi.mock("../../src/composables/useVibe64Passes.js", () => ({ useVibe64Passes: () => ({ recommendation: { value: null } }) }));
vi.mock("../../src/composables/useVibe64SessionTypingPresence.js", () => ({
  useVibe64SessionTypingPresence: () => ({ blur() {}, noteInputActivity() {}, submit() {}, typingLabel: { value: "" } })
}));
for (const child of ["Vibe64AgentPlanUsage", "Vibe64WorkPlan", "Vibe64ChatModeControls", "Vibe64SessionAssistantMenu",
  "Vibe64StarredMenu", "Vibe64PassesMenu", "Vibe64PassSuggestion", "Vibe64PlanPassesBar", "Vibe64AutopilotPromptTextarea",
  "Vibe64ConversationLog", "Vibe64ComposerDelivery", "Vibe64MainChatApprovals", "Vibe64TemporaryAiWorkspace"]) {
  vi.doMock(`../../src/components/studio/vibe64-session/${child}.vue`, () => ({ default: { render: () => null } }));
}

// The refusal the owner's Continue implementation met on 28 Nov 2026, with a plan waiting at item 9 of 14.
const REFUSAL = "The selected AI connection changed. Cancel this request and send it again.";
// A Senior chat's plan, waiting for Continue implementation after its turn was stopped.
const waiting = { messageId: "plan-request", status: "waiting", stage: "implementation", workflow: true, delivery: "pending",
  resolvedMode: "senior", followup: { messageId: "plan-followup" }, input: { message: "Implement the plan." },
  error: "The implementation turn interrupted. Resume when ready." };

let app;
afterEach(() => { app?.unmount(); app = null; feedback.report.mockClear(); feedback.dismiss.mockClear(); });

async function mountChat() {
  const { default: Chat } = await import("../../src/components/studio/vibe64-session/Vibe64AutopilotChat.vue");
  // The session as each read returns it: the saved request travels as text, so every read brings a new object.
  const props = reactive({
    active: true,
    session: { sessionId: "shop-session", metadata: { assistant_routing_request: JSON.stringify(waiting) } },
    conversationRuntime: { continueWorkflow: vi.fn() },
    sendAgentMessage: vi.fn()
  });
  const view = { props, routingRequest: computed(() => assistantRoutingRequestForDisplay(props.session?.metadata)) };
  const chat = ref();
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ render: () => h({ ...Chat, render: () => null }, { view, ref: chat }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, feedback);
  app.mount({});
  const state = () => chat.value.$.setupState;
  return {
    props, state,
    // The read the chat makes after each workflow action, or a request-status event's: by default the same request.
    async read(request = view.routingRequest.value) {
      props.session = { ...props.session, metadata: { ...props.session.metadata, assistant_routing_request: JSON.stringify(request) } };
      await nextTick();
    },
    // The notice above the composer, as the chat renders it now.
    notice: () => renderToString(createSSRApp(RoutingNotice, { request: view.routingRequest.value, mode: "senior",
      actionError: state().routingActionError, pendingAction: state().routingActionSending }).use(createVuetify()))
  };
}

it("keeps a refused Continue implementation readable after the read that follows it, and reports it in the snackbar", async () => {
  // Seen on 28 Nov 2026: the refusal showed right of Details for a fraction of a second, then the bar was as before.
  const chat = await mountChat();
  chat.props.conversationRuntime.continueWorkflow.mockRejectedValueOnce(new Error(REFUSAL));
  expect(await chat.state().sendRoutingAction("continue")).toBe(false);
  expect(chat.state().routingActionError).toBe(REFUSAL);
  // The refresh continueWorkflow starts, then a request-status event, each bring the same request back.
  await chat.read();
  await chat.read();
  expect(chat.state().routingActionError).toBe(REFUSAL);
  const html = await chat.notice();
  expect(html).toContain("Continue implementation");
  expect(html).toMatch(new RegExp(`role="alert"[^>]*>${REFUSAL.replaceAll(".", "\\.")}</p>`, "u"));
  // A refused command also goes through the shell's action feedback, as the app's other refused commands do.
  expect(feedback.report).toHaveBeenCalledWith(expect.objectContaining({
    message: REFUSAL, intent: "action-feedback", severity: "error", channel: "snackbar"
  }));
});

it("keeps a refused Implement plan and the checks' Yes and No readable the same way", async () => {
  const chat = await mountChat();
  await chat.read({ ...waiting, stage: "planning", workPlan: { status: "active", revision: "saved-plan" } });
  chat.props.sendAgentMessage.mockResolvedValueOnce({ ok: false, error: "The saved plan changed. View the plan and implement it again." });
  expect(await chat.state().sendRoutingAction("implement")).toBe(false);
  await chat.read();
  expect(chat.state().routingActionError).toBe("The saved plan changed. View the plan and implement it again.");
  // Yes sends the person's message; No goes through the workflow action.
  chat.props.sendAgentMessage.mockRejectedValueOnce(new Error("Yes was refused."));
  expect(await chat.state().sendRoutingAction("run-checks")).toBe(false);
  await chat.read();
  expect(chat.state().routingActionError).toBe("Yes was refused.");
  chat.props.conversationRuntime.continueWorkflow.mockRejectedValueOnce(new Error("No was refused."));
  expect(await chat.state().sendRoutingAction("skip-checks")).toBe(false);
  await chat.read();
  expect(chat.state().routingActionError).toBe("No was refused.");
  expect(feedback.report).toHaveBeenCalledTimes(3);
});

it("clears a refusal when the person acts again or the request really moves on", async () => {
  const chat = await mountChat();
  chat.props.conversationRuntime.continueWorkflow.mockRejectedValueOnce(new Error(REFUSAL));
  await chat.state().sendRoutingAction("continue");
  // Pressing Continue again clears it while the new attempt is sent.
  let finish;
  chat.props.conversationRuntime.continueWorkflow.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const again = chat.state().sendRoutingAction("continue");
  expect(chat.state().routingActionSending).toBe("continue");
  expect(chat.state().routingActionError).toBe("");
  finish({ ok: true });
  expect(await again).toEqual({ ok: true });
  // Refused, then the request starts working: the refusal no longer describes the bar.
  chat.props.conversationRuntime.continueWorkflow.mockRejectedValueOnce(new Error(REFUSAL));
  await chat.state().sendRoutingAction("continue");
  expect(chat.state().routingActionError).toBe(REFUSAL);
  await chat.read({ ...waiting, status: "working", delivery: "accepted" });
  expect(chat.state().routingActionError).toBe("");
  // Refused, then another request replaces this one.
  chat.props.conversationRuntime.continueWorkflow.mockRejectedValueOnce(new Error(REFUSAL));
  await chat.state().sendRoutingAction("continue");
  await chat.read({ ...waiting, messageId: "next-request" });
  expect(chat.state().routingActionError).toBe("");
});
