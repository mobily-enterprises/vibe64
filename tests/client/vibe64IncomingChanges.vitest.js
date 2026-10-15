import { createRenderer, nextTick, reactive, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null, route: null, success: vi.fn(), error: vi.fn(), invalidate: vi.fn() }));
vi.mock("vue-router", () => ({ useRoute: () => mocks.route,
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), options: { history: { state: {} } } }) }));
vi.mock("@tanstack/vue-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({ useEndpointResource: () => mocks.resource }));
vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({ useUiFeedback: () => ({ success: mocks.success, error: mocks.error }) }));
import IncomingChangesPanel from "../../src/components/studio/IncomingChangesPanel.vue";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const review = { repository: "example/library", targetBranch: "main", targetHead: "a".repeat(40),
  activeHead: "b".repeat(40), discardedHead: "", id };
let app;
function mount() {
  const requestTemporaryAi = vi.fn(async () => true);
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ ...IncomingChangesPanel, render: () => null }, { dashboardContext: {
      sessionId: "receiving-session", projectContext: { repositoryMode: "github" },
      assistantSeniorAllowed: true, requestTemporaryAi
    } });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { state: app._instance.setupState, requestTemporaryAi };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.route = reactive({ params: { slug: "library" }, query: { contribution: id } });
  mocks.resource = { data: ref({ ok: true, repository: review.repository, targetBranch: "main", targetHead: review.targetHead,
    actions: { merge: "", discard: "" }, contributions: [{ id, review, status: "pending", head: review.activeHead }] }),
  isInitialLoading: ref(false), isFetching: ref(false), loadError: ref(""), save: vi.fn(), reload: vi.fn() };
});
afterEach(() => app?.unmount());

it("recognizes logical conflict failure, opens existing AI, and requires reviewed Merge after repair", async () => {
  const { state, requestTemporaryAi } = mount();
  mocks.resource.save.mockResolvedValueOnce({ ok: false, code: "vibe64_incoming_merge_conflict", error: "Conflict.",
    details: { conflictPaths: ["shared.txt"], checkpointCommit: "c".repeat(40), review } });
  state.confirm("merge");
  await state.apply();
  expect(mocks.success).not.toHaveBeenCalled();
  expect(state.conflict.conflictPaths).toEqual(["shared.txt"]);
  expect(state.uncertain).toBe(false);
  await state.fixConflict();
  expect(requestTemporaryAi).toHaveBeenCalledWith(expect.objectContaining({ code: "vibe64_incoming_merge_conflict",
    error: expect.stringContaining(review.activeHead) }));
  expect(mocks.resource.save).toHaveBeenCalledTimes(1);
  const repairReview = { tree: "d".repeat(40), worktreeTree: "e".repeat(40), head: "f".repeat(40), indexTree: "1".repeat(40) };
  mocks.resource.save.mockResolvedValueOnce({ ok: true, status: "repair-review", review, repairReview,
    diff: { content: "+both intended changes", truncated: false } });
  await state.reviewRepair();
  expect(mocks.success).not.toHaveBeenCalled();
  expect(state.repair.repairReview).toEqual(repairReview);
  expect(mocks.resource.save).toHaveBeenLastCalledWith({ sessionId: "receiving-session", action: "review-repair", review }, expect.any(Object));
  state.confirm("merge");
  mocks.resource.save.mockResolvedValueOnce({ ok: true, status: "merged" });
  await state.apply();
  expect(mocks.resource.save).toHaveBeenLastCalledWith({ sessionId: "receiving-session", action: "merge", review, repairReview }, expect.any(Object));
  expect(mocks.success).toHaveBeenCalledWith("Contribution merged.");
});

it("keeps uncertain and stale actions blocked until a successful refresh and rejects logical read failures", async () => {
  const { state } = mount();
  mocks.resource.save.mockResolvedValueOnce({ ok: false, code: "vibe64_incoming_review_changed", error: "Heads changed." });
  state.confirm("merge");
  await state.apply();
  expect(state.uncertain).toBe(true);
  expect(mocks.success).not.toHaveBeenCalled();
  state.confirm("discard");
  expect(state.confirmation).toBe(null);
  mocks.resource.data.value = { ok: false, error: "Remote unavailable." };
  await state.refresh();
  expect(state.loadError).toBe("Remote unavailable.");
  expect(state.uncertain).toBe(true);
});

it("does not attach a delayed repair review to another contribution", async () => {
  const { state } = mount();
  const response = Promise.withResolvers();
  mocks.resource.save.mockReturnValueOnce(response.promise);
  const reviewing = state.reviewRepair();
  mocks.route.query.contribution = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await nextTick();
  response.resolve({ ok: true, status: "repair-review", repairReview: { tree: "d".repeat(40) } });
  await reviewing;
  expect(state.repair).toBe(null);
  expect(mocks.success).not.toHaveBeenCalled();
});
