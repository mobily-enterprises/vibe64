import { createRenderer, nextTick, reactive, ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "../../src/lib/vibe64AssistantHost.js";

const harness = vi.hoisted(() => ({ route: null, replace: null, command: null, options: null }));
vi.mock("vue-router", () => ({ useRoute: () => harness.route, useRouter: () => ({ replace: harness.replace }) }));
// Only command placement/admission is a bounded harness. Reads run through the
// original resource, real Vue Query observers, cancellation and HTTP client.
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand(options) {
    harness.options = options;
    return { run: context => harness.command(
      options.buildCommandOptions(null, { context }).path,
      options.buildRawPayload(null, { context })
    ) };
  }
}));
import { useVibe64LearningMode } from "../../src/composables/useVibe64LearningMode.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const selection = { courseId: "getting-started", release: "0.1.7", lessonCode: "V64-START-00", expectedRevision: 4 };
const originalClient = getHttpWebClient();
let app, queryClient, viewer, mode, opened, read;
const flush = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); };
const progress = learnerId => ({ ok: true, available: true, learnerId, sessions: [], revision: 4, history: [] });
beforeEach(async () => {
  harness.route = reactive({ path: "/app", fullPath: "/app?mode=learning", hash: "#preview", query: { mode: "learning", session: "working-id" } });
  harness.replace = vi.fn(async location => Object.assign(harness.route, location));
  harness.command = vi.fn(async path => path.endsWith("/sessions") ? { ok: true, sessionId: `learning-${A}` }
    : { ok: true, available: true, active: { attemptId: A }, revision: 5 });
  viewer = ref({ actorKey: "owner" });
  read = vi.fn(async path => path.endsWith("/learning") ? progress(`learner-${viewer.value.actorKey}`) : { ok: true, courses: [] });
  configureHttpWebClient({ request: read });
  opened = vi.fn();
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ setup() { mode = useVibe64LearningMode({ onConversationOpened: opened }); return () => null; } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  app.use(VueQueryPlugin, { queryClient }); app.provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer); app.mount({});
  await flush();
});
afterEach(() => { app.unmount(); queryClient.clear(); configureHttpWebClient(originalClient); });

it("uses original route flag and actor-scoped resources without requiring a project", async () => {
  expect(mode.learningMode.value).toBe(true);
  expect(mode.purposeFilter.value).toBe("learning");
  expect(mode.learnerId.value).toBe("learner-owner");
  expect(read.mock.calls.map(([path]) => path)).toEqual(["/api/vibe64/training/courses", "/api/vibe64/training/learning"]);
  await mode.setLearningMode(false);
  expect(harness.replace).toHaveBeenCalledWith({ path: "/app", hash: "#preview", query: { session: "working-id" } });
  expect(mode.purposeFilter.value).toBe("working");
  expect(mode.learningResource.data.value.learnerId).toBe("learner-owner");
  await mode.setLearningMode(true);
  expect(harness.replace.mock.calls[1][0].query).toEqual({ session: "working-id", mode: "learning" });
});

it("hides old progress synchronously on account change and sign-out using real query observers", async () => {
  const member = Promise.withResolvers();
  read.mockImplementation(path => path.endsWith("/learning") ? member.promise : Promise.resolve({ ok: true, courses: [] }));
  viewer.value = { actorKey: "member" };
  expect(mode.learningResource.data.value).toBeNull();
  expect(mode.learningResource.query.data.value).toBeNull();
  expect(mode.learnerId.value).toBe("");
  await flush();
  member.resolve(progress("learner-member")); await flush();
  expect(mode.learnerId.value).toBe("learner-member");
  viewer.value = null;
  expect(mode.learningResource.data.value).toBeNull();
  const count = read.mock.calls.length;
  await mode.refresh(); await mode.learningResource.reload();
  await mode.learningResource.query.refetch({ cancelRefetch: false });
  expect(read).toHaveBeenCalledTimes(count);
  await expect(mode.startLesson(selection)).rejects.toThrow("read your saved lessons");
});

it("masks revoked progress, while a transient read error retains this actor's saved state", async () => {
  read.mockRejectedValueOnce(Object.assign(new Error("offline"), { status: 503 }));
  await mode.learningResource.reload();
  expect(mode.learningResource.data.value.learnerId).toBe("learner-owner");
  read.mockRejectedValueOnce(Object.assign(new Error("denied"), { status: 403 }));
  await mode.learningResource.reload();
  expect(mode.learningResource.data.value).toBeNull();
  expect(mode.learningResource.query.data.value).toBeNull();
  expect(mode.learnerId.value).toBe("");
  await expect(mode.resumeLesson(A)).rejects.toThrow("read your saved lessons");
});

it("starts through original action, then original empty-body Create, and returns actual IDs", async () => {
  const outcome = await mode.startLesson(selection);
  const [[path, body], [createPath, createBody]] = harness.command.mock.calls;
  expect(path).toBe("/api/vibe64/training/lessons/start");
  expect(body).toEqual({ ...selection, requestId: outcome.requestId });
  expect(body.requestId).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
  expect(createPath).toBe(`/api/learning/${A}/vibe64/sessions`);
  expect(createBody).toEqual({});
  expect(opened).toHaveBeenCalledWith({ attemptId: A, sessionId: `learning-${A}`, learnerId: "learner-owner" });
  expect(outcome).toMatchObject({ attemptId: A, sessionId: `learning-${A}`, current: true, ended: false });
  expect(mode.startRetry.value).toBeNull();
});

it("retains exact start identity and inputs across an uncertain result without admitting changed intent", async () => {
  harness.command.mockRejectedValueOnce(new Error("ack lost"));
  await expect(mode.startLesson(selection)).rejects.toThrow("ack lost");
  const first = harness.command.mock.calls[0][1];
  expect(mode.startRetry.value).toEqual(selection);
  await expect(mode.startLesson({ ...selection, lessonCode: "V64-START-01" })).rejects.toThrow("Retry that same lesson");
  expect(harness.command).toHaveBeenCalledTimes(1);
  await mode.retryStart({ openConversation: false });
  expect(harness.command.mock.calls[1][1]).toEqual(first);
  expect(opened).not.toHaveBeenCalled();
  expect(mode.startRetry.value).toBeNull();
});

it("does not open an unrelated active successor returned beside an ended original replay", async () => {
  harness.command.mockResolvedValueOnce({ ok: true, available: true,
    attempt: { attemptId: A, ended: { reason: "discarded" } }, active: { attemptId: B } });
  const outcome = await mode.startLesson(selection);
  expect(outcome).toMatchObject({ attemptId: A, ended: true, sessionId: "" });
  expect(harness.command).toHaveBeenCalledTimes(1);
  expect(opened).not.toHaveBeenCalled();
});

it.each(["mode", "actor", "project"])("keeps an admitted start truthful but stops new Create/navigation after %s changes", async change => {
  const admitted = Promise.withResolvers(); harness.command.mockReturnValueOnce(admitted.promise);
  const pending = mode.startLesson(selection);
  if (change === "mode") harness.route.query.mode = undefined;
  if (change === "actor") viewer.value = { actorKey: "member" };
  if (change === "project") harness.route.fullPath = "/app/projects/other?mode=learning";
  admitted.resolve({ ok: true, available: true, active: { attemptId: A } });
  const outcome = await pending;
  expect(outcome).toMatchObject({ attemptId: A, current: false, sessionId: "" });
  expect(harness.command).toHaveBeenCalledTimes(1);
  expect(opened).not.toHaveBeenCalled();
});

it("suppresses late Create selection and opens only the exact resumed attempt", async () => {
  const created = Promise.withResolvers();
  harness.command.mockResolvedValueOnce({ ok: true, available: true, active: { attemptId: A } }).mockReturnValueOnce(created.promise);
  const pending = mode.resumeLesson(A); await flush();
  expect(harness.command.mock.calls[0]).toEqual([`/api/vibe64/training/attempts/${A}/resume`, {}]);
  harness.route.query.mode = undefined;
  created.resolve({ ok: true, sessionId: `learning-${A}` });
  expect(await pending).toMatchObject({ attemptId: A, sessionId: `learning-${A}`, current: false });
  expect(opened).not.toHaveBeenCalled();
  harness.route.query.mode = "learning";
  harness.command.mockResolvedValueOnce({ ok: true, available: true, active: { attemptId: B } });
  await expect(mode.resumeLesson(A)).rejects.toThrow("requested attempt");
  expect(harness.command).toHaveBeenCalledTimes(3);
});

it("retains start retry after uncertain Create and never overlaps another UI operation", async () => {
  const created = Promise.withResolvers();
  harness.command.mockResolvedValueOnce({ ok: true, available: true, active: { attemptId: A } }).mockReturnValueOnce(created.promise);
  const pending = mode.startLesson(selection); await flush();
  expect(await mode.resumeLesson(B)).toBeNull();
  expect(harness.command).toHaveBeenCalledTimes(2);
  created.reject(new Error("create acknowledgement lost"));
  await expect(pending).rejects.toThrow("acknowledgement lost");
  expect(mode.startRetry.value).toEqual(selection);
  await mode.retryStart();
  expect(harness.command.mock.calls[2][1]).toEqual(harness.command.mock.calls[0][1]);
});

it("does not select a created conversation after the fresh progress read revokes access", async () => {
  read.mockRejectedValueOnce(Object.assign(new Error("revoked"), { status: 403 }));
  const outcome = await mode.startLesson(selection);
  expect(outcome).toMatchObject({ attemptId: A, sessionId: `learning-${A}`, current: false });
  expect(mode.learningResource.data.value).toBeNull();
  expect(opened).not.toHaveBeenCalled();
});

it("retains exact retry rather than claiming a failed Create response is an open conversation", async () => {
  harness.command.mockResolvedValueOnce({ ok: true, available: true, active: { attemptId: A } })
    .mockResolvedValueOnce({ ok: false, sessionId: `learning-${A}` });
  await expect(mode.startLesson(selection)).rejects.toThrow("conversation was not confirmed");
  expect(mode.startRetry.value).toEqual(selection);
  expect(opened).not.toHaveBeenCalled();
});
