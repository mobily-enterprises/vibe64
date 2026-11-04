import { createRenderer, h, nextTick, reactive, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: mocks.request }) }));
import Vibe64ConnectedSessionPicker from "../../src/components/studio/vibe64-session/Vibe64ConnectedSessionPicker.vue";

const free = (...ids) => ids.map(sessionId => ({ sessionId, sessionName: sessionId }));
const choice = (sessions, extra = {}) => ({ name: "library", projectSlug: "library", reason: "", repository: "example/library", sessions, ...extra });
const answer = (...choices) => ({ ok: true, choices });
const settled = async () => { await nextTick(); await Promise.resolve(); await nextTick(); };
let app;

async function mount(first) {
  mocks.request.mockResolvedValueOnce(first);
  const props = reactive({ projectSlug: "consumer", sessionId: "task", revision: "one", disabled: false });
  const resolved = vi.fn();
  const component = { ...Vibe64ConnectedSessionPicker, render: () => null };
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ render: () => h(component, { ...props, onResolved: resolved }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  await settled();
  return { props, resolved, state: app._instance.subTree.component.setupState };
}
beforeEach(() => mocks.request.mockReset());
afterEach(() => app?.unmount());

it("preselects the first free session and keeps a choice that is still on offer", async () => {
  const { props, state } = await mount(answer(choice(free("first", "second"))));
  expect(mocks.request.mock.lastCall).toEqual(["/api/app/consumer/vibe64/sessions/task/connected/choices", { method: "GET" }]);
  expect(state.selections["example/library"]).toBe("first");

  state.selections["example/library"] = "second";
  mocks.request.mockResolvedValueOnce(answer(choice(free("first", "second"))));
  props.revision = "two";
  await settled();
  expect(state.selections["example/library"]).toBe("second");

  mocks.request.mockResolvedValueOnce(answer(choice(free("first"))));
  props.revision = "three";
  await settled();
  expect(state.selections["example/library"]).toBe("first");
});

it("links the selected session and asks to continue only when no project still needs a choice", async () => {
  const two = [choice(free("first")), choice(free("other"), { repository: "example/other" })];
  const { resolved, state } = await mount(answer(...two));
  mocks.request.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(answer(two[1]));
  await state.linkSession(state.choices[0]);
  expect(mocks.request.mock.calls[1]).toEqual(["/api/app/consumer/vibe64/sessions/task/connected/link",
    { method: "POST", body: { repository: "example/library", connectedSessionId: "first" } }]);
  expect(resolved).not.toHaveBeenCalled();

  mocks.request.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(answer());
  await state.linkSession(state.choices[0]);
  expect(resolved).toHaveBeenCalledTimes(1);
  expect(state.busy).toBe(false);
});

it("keeps a refusal's message, shows the server's new list and never continues", async () => {
  const { resolved, state } = await mount(answer(choice(free("taken", "free"))));
  mocks.request.mockResolvedValueOnce({ ok: false, code: "vibe64_connected_session_not_free", error: "That session is no longer free. Choose again." })
    .mockResolvedValueOnce(answer(choice(free("free"))));
  await state.linkSession(state.choices[0]);
  expect(state.error).toBe("That session is no longer free. Choose again.");
  expect(state.selections["example/library"]).toBe("free");
  expect(resolved).not.toHaveBeenCalled();

  mocks.request.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce(answer());
  await state.linkSession(state.choices[0]);
  expect(state.error).toBe("Connection lost");
  expect(resolved).not.toHaveBeenCalled();
});

it("finishes a confirmed replacement through its own review", async () => {
  const replacementReview = { repository: "example/library", targetBranch: "main", targetHead: "a".repeat(40),
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", activeHead: "", discardedHead: "b".repeat(40) };
  const { resolved, state } = await mount(answer(choice([], { replacementReview })));
  mocks.request.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(answer());
  await state.finishReplacement(state.choices[0]);
  expect(mocks.request.mock.calls[1]).toEqual(["/api/app/consumer/vibe64/sessions/task/connected/replacement",
    { method: "POST", body: { repository: "example/library", review: replacementReview } }]);
  expect(resolved).toHaveBeenCalledTimes(1);
});

it("ignores an answer for a session no longer shown", async () => {
  const { props, state } = await mount(answer(choice(free("first"))));
  let finishOld;
  mocks.request.mockImplementationOnce(() => new Promise(done => { finishOld = done; }));
  props.revision = "two";
  await settled();
  mocks.request.mockResolvedValueOnce(answer(choice(free("new-session"))));
  props.sessionId = "other-task";
  await settled();
  finishOld(answer(choice(free("old-session"))));
  await settled();
  expect(state.choices[0].sessions).toEqual(free("new-session"));
});
