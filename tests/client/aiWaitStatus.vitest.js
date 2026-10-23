import { createRenderer, createSSRApp, effectScope, h, nextTick, reactive, ref, ssrContextKey } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createVuetify } from "vuetify";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sessions: null }));
vi.mock("../../packages/vibe64-accounts/src/client/composables/useAccountAuthSessions.js", async () => {
  const { computed, reactive: makeReactive, ref: makeRef } = await import("vue");
  return { useAccountAuthSessions: () => ({
    activeSessionFor: (id) => mocks.sessions[id] || null,
    authBusy: computed(() => Object.values(mocks.sessions).some((session) => session.status === "authenticating")),
    authCopyStatus: makeReactive({}), authSessionNeedsTerminalAttention: () => false, cancelSession: vi.fn(),
    copyAuthCode: vi.fn(), errorMessage: makeRef(""), localError: makeRef(""), loginDisabled: () => false,
    logoutAccount: vi.fn(), logoutAccountId: makeRef(""), openAuthUrl: vi.fn(), refreshStatus: vi.fn(),
    startApiKeyAuth: vi.fn(), startBrowserAuth: vi.fn(), startDeviceAuth: vi.fn(), stopPolling: vi.fn()
  }) };
});
vi.mock("/src/composables/useVibe64Terminal.js", async () => {
  const { ref: makeRef } = await import("vue");
  return { useVibe64Terminal: () => ({ terminalStatus: makeRef(""), terminalStarting: makeRef(false), terminalOutput: makeRef(""),
    terminalError: makeRef(""), attachTerminal: vi.fn(), applyTerminalSession: vi.fn(), hideTerminal: vi.fn(),
    disposeTerminalDisplay: vi.fn(), disposeTerminalUi: vi.fn(), sendTerminalData: vi.fn(async () => true) }) };
});
import AiWaitStatus from "../../packages/vibe64-accounts/src/client/studio/AiWaitStatus.vue";
import { useProviderAccountsSetup } from "../../packages/vibe64-accounts/src/client/composables/useProviderAccountsSetup.js";

let app;
afterEach(() => {
  app?.unmount();
  app = null;
  vi.useRealTimers();
});

function mount(component, props) {
  const node = () => ({});
  const renderer = createRenderer({ createComment: node, createElement: node, createText: node, setText() {}, setElementText() {},
    patchProp() {}, insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp(component.render ? { ...component, render: () => null } : component, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}

it("shows a spinner and what is happening only while active", async () => {
  const render = (props) => {
    const view = createSSRApp(AiWaitStatus, props);
    view.use(createVuetify({ ssr: true }));
    return renderToString(view);
  };
  expect(await render({ active: false, label: "Starting Claude's sign-in." })).not.toContain("ai-wait");
  const html = await render({ active: true, label: "Starting Claude's sign-in." });
  expect(html).toContain('role="status"');
  expect(html).toContain("v-progress-circular");
  expect(html).toContain("Starting Claude&#39;s sign-in.");
  expect(html).not.toContain("Still working");
});

it("says it is still working once a wait passes its threshold, and starts over for the next wait", async () => {
  vi.useFakeTimers();
  const props = reactive({ active: true, label: "Checking", slowAfterMs: 1000 });
  const child = ref(null);
  mount({ setup: () => () => h(AiWaitStatus, { ...props, ref: child }) });
  const state = { get slow() { return child.value.$.setupState.slow; } };
  vi.advanceTimersByTime(999);
  expect(state.slow).toBe(false);
  vi.advanceTimersByTime(1);
  expect(state.slow).toBe(true);
  props.active = false;
  await nextTick();
  expect(state.slow).toBe(false);
  props.active = true;
  await nextTick();
  vi.advanceTimersByTime(500);
  expect(state.slow).toBe(false);
});

it("names each sign-in phase and spins only while Vibe64 or the provider is working", async () => {
  const session = (id, extra) => ({ id: `auth-${id}`, account: { id, label: id }, status: "authenticating", ...extra });
  mocks.sessions = reactive({});
  const setup = effectScope().run(() => useProviderAccountsSetup({
    accounts: { isLoading: ref(false), saveGitIdentityCommand: {} }, actionsEnabled: true, statusLoaded: true,
    accountRows: [{ id: "claude", label: "Claude Code", connected: false }, { id: "codex", label: "Codex", connected: false }]
  }));
  const phase = (value) => [setup.sessionWaiting(value), setup.sessionStatusMessage(value)];

  expect(phase(session("claude", {}))).toEqual([true, "Starting Claude's sign-in. This can take up to a minute."]);
  const ready = session("claude", { authUrl: "https://claude.com/cai/oauth/authorize" });
  expect(phase(ready)).toEqual([false, "Sign in in the browser, then return here to finish connecting."]);
  mocks.sessions.claude = ready;
  setup.claudeCode.value = "fixture-code";
  await setup.submitClaudeCode(ready);
  expect(phase(ready)).toEqual([true, "Checking your code with Claude. This can take up to a minute."]);
  expect(setup.sessionWaiting({ ...ready, status: "failed" })).toBe(false);

  expect(phase(session("codex", { mode: "device" }))[0]).toBe(true);
  expect(phase(session("codex", { mode: "device", userCode: "ABCD-1234" })))
    .toEqual([false, "Enter the code in ChatGPT. This screen continues by itself once you approve it."]);
  expect(phase(session("codex", { mode: "api_key" }))[0]).toBe(true);
  // A pending sign-in keeps its button's name under the spinner; the line says what is happening.
  const claudeAccount = { id: "claude", label: "Claude Code", authLabel: "Sign in with Claude" };
  expect([setup.primaryAuthPending(claudeAccount), setup.primaryAuthLabel(claudeAccount), setup.primaryAuthWaitLabel(claudeAccount)])
    .toEqual([true, "Sign in with Claude", "Sign-in in progress…"]);
});
