import { createRenderer, h, nextTick, reactive, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: mocks.request }) }));
import Vibe64ConnectedReplacement from "../../src/components/studio/vibe64-session/Vibe64ConnectedReplacement.vue";

const review = { repository: "example/library", targetBranch: "main", targetHead: "a".repeat(40),
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", activeHead: "", discardedHead: "b".repeat(40) };
let app;
function mount() {
  const props = reactive({ projectSlug: "consumer", sessionId: "task", disabled: false,
    failure: { code: "vibe64_connected_integration_discarded", details: { repository: review.repository } } });
  const replaced = vi.fn();
  const component = { ...Vibe64ConnectedReplacement, render: () => null };
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ render: () => h(component, { ...props, onReplaced: replaced }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { props, replaced, state: app._instance.subTree.component.setupState };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => app?.unmount());

it("requires review and explicit confirmation, and retains that review after an uncertain creation", async () => {
  const { state, props, replaced } = mount();
  await state.replace();
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.request.mockResolvedValueOnce({ ok: true, contributions: [{ review }] });
  await state.inspect();
  expect(state.review).toEqual(review);
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request.mock.lastCall[0]).toBe(
    "/api/app/consumer/vibe64/sessions/task/connected/replacement?repository=example%2Flibrary");
  mocks.request.mockRejectedValueOnce(new Error("Connection lost after allocation"));
  await state.replace();
  expect(state.review).toEqual(review);
  expect(state.error).toContain("Connection lost");
  expect(replaced).not.toHaveBeenCalled();
  const prepared = { repository: review.repository, projectSlug: "library", sessionId: "replacement", sourceReady: true };
  mocks.request.mockResolvedValueOnce({ ok: true, prepared: [prepared] });
  await state.replace();
  expect(mocks.request.mock.calls[1]).toEqual(mocks.request.mock.calls[2]);
  expect(mocks.request.mock.lastCall[1]).toEqual({ method: "POST", body: { repository: review.repository, review } });
  expect(state.replacement).toEqual(prepared);
  expect(state.review).toBe(null);
  expect(replaced).toHaveBeenCalledTimes(1);
  props.failure = null;
  await nextTick();
  expect(state.replacement).toEqual(prepared, "refreshing the old Save failure must retain the replacement link");
});

it("rejects logical failures and ignores review or creation responses after a session switch", async () => {
  const { state, props, replaced } = mount();
  mocks.request.mockResolvedValueOnce({ ok: false, code: "forbidden", error: "Write access revoked" });
  await state.inspect();
  expect(state.review).toBe(null);
  expect(state.error).toContain("Write access revoked");
  let resolve;
  mocks.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const inspection = state.inspect();
  props.sessionId = "other";
  await nextTick();
  resolve({ ok: true, contributions: [{ review }] });
  await inspection;
  expect(state.review).toBe(null);
  mocks.request.mockResolvedValueOnce({ ok: true, contributions: [{ review }] });
  await state.inspect();
  mocks.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const creation = state.replace();
  props.sessionId = "third";
  await nextTick();
  resolve({ ok: true, prepared: [{ repository: review.repository, sessionId: "replacement" }] });
  await creation;
  expect(state.replacement).toBe(null);
  expect(replaced).not.toHaveBeenCalled();
});

it("cannot begin review or creation while repository operations are disabled", async () => {
  const { state, props } = mount();
  props.disabled = true;
  await nextTick();
  await state.inspect();
  state.review = review;
  await state.replace();
  expect(mocks.request).not.toHaveBeenCalled();
});
