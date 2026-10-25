import { createRenderer, h, ref, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";

// useCommand's real behaviour: it reports a failure through its own feedback,
// then rethrows.
const mocks = vi.hoisted(() => ({ save: vi.fn(), error: vi.fn(), command: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({ useCommand: (options) => {
  mocks.command(options);
  return { run: async () => {
    try {
      return await mocks.save(options.buildRawPayload(), options.buildCommandOptions());
    } catch (error) {
      mocks.error(error, options.fallbackRunError);
      throw error;
    }
  } };
} }));
import Rename from "../../src/components/studio/vibe64-session/Vibe64RenameSessionDialog.vue";

let app;
afterEach(() => {
  app?.unmount();
  vi.clearAllMocks();
});

function mount() {
  const events = { close: vi.fn(), renamed: vi.fn() };
  const component = { ...Rename, render: () => null };
  const dialog = ref();
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ render: () => h(component, {
    session: { sessionId: "visible", sessionName: "Old" },
    sessionsApiPath: "/api/project/test/vibe64/sessions",
    onClose: events.close, onRenamed: events.renamed, ref: dialog
  }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { events, state: dialog.value.$.setupState };
}

it("renames the session through the shared session command", async () => {
  mocks.save.mockResolvedValue({ ok: true });
  const { events, state } = mount();
  state.name = "  New name  ";
  await state.submit();
  expect(mocks.command).toHaveBeenCalledWith(expect.objectContaining({
    placementSource: "vibe64.sessions.rename", writeMethod: "PATCH"
  }));
  expect(mocks.save).toHaveBeenCalledWith({ name: "New name" },
    { method: "PATCH", path: "/api/project/test/vibe64/sessions/visible/name" });
  expect(events.renamed).toHaveBeenCalledOnce();
  expect(events.close).toHaveBeenCalledOnce();
  expect(state.pending).toBe(false);
});

it("stays open after a failure the command has reported", async () => {
  mocks.save.mockRejectedValue(new Error("Project closed"));
  const { events, state } = mount();
  state.name = "New name";
  await state.submit();
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(events.renamed).not.toHaveBeenCalled();
  expect(events.close).not.toHaveBeenCalled();
  expect(state.pending).toBe(false);
});
