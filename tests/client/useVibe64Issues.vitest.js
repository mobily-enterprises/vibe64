import { effectScope, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ route: null, resources: [], save: vi.fn(), invalidateQueries: vi.fn(),
  feedback: null, push: vi.fn() }));
vi.mock("vue-router", () => ({ useRoute: () => mocks.route, useRouter: () => ({ push: mocks.push }) }));
vi.mock("@tanstack/vue-query", () => ({ useQueryClient: () => mocks }));
vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({ useUiFeedback: () => mocks.feedback }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: () => mocks.resources.shift()
}));
vi.mock("@/lib/vibe64BrowserTabOrigin.js", () => ({ vibe64RealtimeOriginPayload: (body) => ({ ...body, originId: "tab" }) }));

import { useVibe64Issues } from "../../src/composables/useVibe64Issues.js";

let scope;
let model;
let detail;
let projectIndex = 0;
function issue(number = 43, nodes = []) {
  return { number, state: "OPEN", comments: { nodes, totalCount: nodes.length } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.route = reactive({ params: { slug: `comment-project-${++projectIndex}` }, query: { issue: "43" } });
  detail = { data: ref({ issue: issue() }), save: mocks.save };
  mocks.resources = [{}, {}, detail];
  mocks.feedback = { message: ref(""), success: vi.fn(), error: vi.fn((error) => {
    mocks.feedback.message.value = error.message;
  }) };
  mocks.invalidateQueries.mockResolvedValue();
  scope = effectScope();
  model = scope.run(() => useVibe64Issues(ref({ projectContext: {
    repositoryMode: "github", githubRepository: { fullName: "owner/repo" }
  } })));
});
afterEach(() => scope.stop());

it("shows the comment immediately, clears the submitted draft and reconciles the returned GitHub id", async () => {
  const write = Promise.withResolvers();
  mocks.save.mockReturnValueOnce(write.promise);
  model.draft.value = "A **Markdown** update";
  const sending = model.mutate("comment");
  expect(model.comments.value).toHaveLength(1);
  expect(model.comments.value[0]).toMatchObject({ body: "A **Markdown** update", delivery: "sending" });
  expect(model.pending.value).toBe("comment");
  expect(model.draft.value).toBe("");
  await model.mutate("comment");
  expect(mocks.save).toHaveBeenCalledTimes(1);
  model.draft.value = "A newer draft";
  const saved = { id: "github-id", body: "A **Markdown** update", author: { login: "alice" } };
  write.resolve({ comment: saved });
  await sending;
  expect(model.comments.value).toHaveLength(1);
  expect(model.comments.value[0]).toMatchObject({ ...saved, delivery: "sent" });
  expect(model.pending.value).toBe("");
  expect(model.draft.value).toBe("A newer draft");
  detail.data.value = { issue: issue(43, [saved]) };
  await nextTick();
  expect(model.comments.value).toEqual([saved]);
});

it("keeps a failed comment through navigation and retries only its original body and destination", async () => {
  mocks.save.mockRejectedValueOnce(new Error("GitHub refused this action."));
  model.draft.value = "Original comment";
  await model.mutate("comment");
  const original = model.comments.value[0];
  expect(original.delivery).toBe("failed");
  expect(original.error).toBe("GitHub refused this action.");
  model.draft.value = "A newer draft";
  mocks.route.query.issue = "44";
  detail.data.value = { issue: issue(44) };
  await nextTick();
  expect(model.comments.value).toEqual([]);
  expect(model.draft.value).toBe("");
  await model.retryComment(original.id);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  mocks.route.query.issue = "43";
  detail.data.value = { issue: issue() };
  await nextTick();
  expect(model.comments.value[0].id).toBe(original.id);
  const retry = Promise.withResolvers();
  mocks.save.mockReturnValueOnce(retry.promise);
  const retrying = model.retryComment(original.id);
  expect(model.comments.value).toHaveLength(1);
  expect(model.comments.value[0].delivery).toBe("sending");
  await model.retryComment(original.id);
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
  retry.resolve({ comment: { id: "confirmed", body: "Original comment", author: { login: "alice" } } });
  await retrying;
  expect(model.draft.value).toBe("A newer draft");
  expect(model.comments.value[0].id).toBe("confirmed");
});

it("finishes an in-flight comment on its original issue after switching projects", async () => {
  const write = Promise.withResolvers();
  mocks.save.mockReturnValueOnce(write.promise);
  model.draft.value = "First project's comment";
  const path = model.basePath.value;
  const slug = mocks.route.params.slug;
  const sending = model.mutate("comment");
  mocks.route.params.slug = "another-project";
  detail.data.value = { issue: issue() };
  await nextTick();
  model.draft.value = "Other project's draft";
  write.resolve({ comment: { id: "saved-original", body: "First project's comment" } });
  await sending;
  expect(model.comments.value).toEqual([]);
  expect(model.draft.value).toBe("Other project's draft");
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["vibe64.issue", `${path}/43`] });
  mocks.route.params.slug = slug;
  await nextTick();
  expect(model.comments.value[0].id).toBe("saved-original");
});

it("never turns a confirmed write into a retryable failure when cache refresh fails", async () => {
  mocks.save.mockResolvedValueOnce({ comment: { id: "saved", body: "Confirmed" } });
  mocks.invalidateQueries.mockRejectedValueOnce(new Error("Refresh unavailable"));
  model.draft.value = "Confirmed";
  await model.mutate("comment");
  expect(model.comments.value[0].delivery).toBe("sent");
  await model.retryComment("saved");
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.feedback.success).toHaveBeenCalledWith("Comment added.");
});

it("does not duplicate a confirmed comment when realtime delivers it before the write response", async () => {
  const write = Promise.withResolvers();
  mocks.save.mockReturnValueOnce(write.promise);
  model.draft.value = "Realtime update";
  const sending = model.mutate("comment");
  const saved = { id: "realtime-id", body: "Realtime update" };
  detail.data.value = { issue: issue(43, [saved]) };
  await nextTick();
  write.resolve({ comment: saved });
  await sending;
  expect(model.comments.value).toEqual([saved]);
});
