import { createRenderer, createSSRApp, h, ref, ssrContextKey } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { afterEach, expect, it, vi } from "vitest";

// useCommand's real behaviour: it reports a failure through its own feedback,
// then rethrows.
const mocks = vi.hoisted(() => ({ save: vi.fn(), error: vi.fn(), command: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({ useCommand: (options) => {
  mocks.command(options);
  return { run: async () => {
    const payload = options.buildRawPayload();
    try {
      return await mocks.save(payload, options.buildCommandOptions());
    } catch (error) {
      mocks.error(error, options.fallbackRunError);
      throw error;
    }
  } };
} }));
import Pin from "../../src/components/studio/vibe64-session/Vibe64SessionPin.vue";
let app;
afterEach(() => {
  app?.unmount();
  vi.clearAllMocks();
});
function mount(pinnedSessionId = "") {
  const props = { session: { sessionId: "visible", pinnedSessionId }, sessionsApiPath: "/api/project/test/vibe64/sessions", refresh: vi.fn() };
  const component = { ...Pin, render: () => null };
  const pin = ref();
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ render: () => h(component, { ...props, ref: pin }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { props, state: pin.value.$.setupState };
}

it("pins the exact mounted session once and waits for its refreshed status", async () => {
  const { props, state } = mount();
  let finish;
  mocks.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = state.toggle();
  expect(state.pending).toBe(true);
  expect(state.label).toBe("Updating session pin…");
  await state.toggle();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledWith({ pinned: true },
    { method: "PATCH", path: "/api/project/test/vibe64/sessions/visible/pin" });
  expect(mocks.command).toHaveBeenCalledWith(expect.objectContaining({
    placementSource: "vibe64.sessions.pin", writeMethod: "PATCH"
  }));
  finish({ pinnedSessionId: "visible" });
  await pending;
  expect(props.refresh).toHaveBeenCalledOnce();
  expect(state.pending).toBe(false);
});

it("unpins only this session and does not overwrite another session's pin", async () => {
  mocks.save.mockResolvedValue({});
  const pinned = mount("visible");
  await pinned.state.toggle();
  expect(mocks.save).toHaveBeenLastCalledWith({ pinned: false },
    { method: "PATCH", path: "/api/project/test/vibe64/sessions/visible/pin" });
  app.unmount();
  mocks.save.mockClear();
  const other = mount("other");
  await other.state.toggle();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(other.state.label).toContain("Unpin the project's pinned session first");
});

it("restores the control after an error through the command's feedback", async () => {
  mocks.save.mockRejectedValue(new Error("Project closed"));
  const { props, state } = mount();
  await state.toggle();
  expect(state.pending).toBe(false);
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(props.refresh).not.toHaveBeenCalled();
});

it("exposes the pin state accessibly without adding a text banner", async () => {
  const instance = createSSRApp(Pin, { session: { sessionId: "a", pinnedSessionId: "a" }, sessionsApiPath: "/api/vibe64/sessions" });
  instance.use(createVuetify());
  const html = await renderToString(instance);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('aria-label="Unpin session"');
  expect(html).not.toContain("v-alert");
});
