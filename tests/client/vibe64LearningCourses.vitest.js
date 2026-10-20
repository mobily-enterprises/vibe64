import { createRenderer, nextTick, ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "../../src/lib/vibe64AssistantHost.js";

const harness = vi.hoisted(() => ({ command: null, options: null }));
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
import { useVibe64LearningCourses } from "../../src/composables/useVibe64LearningCourses.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const selection = { courseId: "getting-started", release: "0.1.7", lessonCode: "V64-START-00", expectedRevision: 4 };
const originalClient = getHttpWebClient();
let app, queryClient, viewer, open, courses, read;
const flush = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); };
const progress = learnerId => ({ ok: true, available: true, learnerId, sessions: [], revision: 4, history: [] });
function mount(options = {}) {
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ setup() { courses = useVibe64LearningCourses({ active: open, ...options }); return () => null; } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  app.use(VueQueryPlugin, { queryClient }); app.provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer); app.mount({});
}
beforeEach(async () => {
  harness.command = vi.fn(async () => ({ ok: true, available: true, active: { attemptId: A }, revision: 5 }));
  viewer = ref({ actorKey: "owner" });
  open = ref(true);
  read = vi.fn(async path => path.endsWith("/learning") ? progress(`learner-${viewer.value.actorKey}`) : { ok: true, courses: [] });
  configureHttpWebClient({ request: read });
  mount();
  await flush();
});
afterEach(() => { app.unmount(); queryClient.clear(); configureHttpWebClient(originalClient); });

it("reads actor-scoped resources while Learning is open, without requiring a project", async () => {
  expect(courses.active.value).toBe(true);
  expect(courses.learnerId.value).toBe("learner-owner");
  // The official catalogue is read only while Learning is open, beside the installed courses.
  expect(read.mock.calls.map(([path]) => path)).toEqual(["/api/vibe64/training/courses", "/api/vibe64/training/learning", "/api/vibe64/training/available"]);
  expect(courses.learningResource.data.value.learnerId).toBe("learner-owner");
});

it("hides old progress synchronously on account change and sign-out using real query observers", async () => {
  const member = Promise.withResolvers();
  read.mockImplementation(path => path.endsWith("/learning") ? member.promise : Promise.resolve({ ok: true, courses: [] }));
  viewer.value = { actorKey: "member" };
  expect(courses.learningResource.data.value).toBeNull();
  expect(courses.learningResource.query.data.value).toBeNull();
  expect(courses.learnerId.value).toBe("");
  await flush();
  member.resolve(progress("learner-member")); await flush();
  expect(courses.learnerId.value).toBe("learner-member");
  viewer.value = null;
  expect(courses.learningResource.data.value).toBeNull();
  const count = read.mock.calls.length;
  await courses.refresh(); await courses.learningResource.reload();
  await courses.learningResource.query.refetch({ cancelRefetch: false });
  expect(read).toHaveBeenCalledTimes(count);
  await expect(courses.startLesson(selection)).rejects.toThrow("read your saved lessons");
});

it("masks revoked progress, while a transient read error retains this actor's saved state", async () => {
  read.mockRejectedValueOnce(Object.assign(new Error("offline"), { status: 503 }));
  await courses.learningResource.reload();
  expect(courses.learningResource.data.value.learnerId).toBe("learner-owner");
  read.mockRejectedValueOnce(Object.assign(new Error("denied"), { status: 403 }));
  await courses.learningResource.reload();
  expect(courses.learningResource.data.value).toBeNull();
  expect(courses.learningResource.query.data.value).toBeNull();
  expect(courses.learnerId.value).toBe("");
  await expect(courses.resumeLesson(A)).rejects.toThrow("read your saved lessons");
});

it("starts through the original action alone and returns the actual attempt", async () => {
  const outcome = await courses.startLesson(selection);
  const [[path, body]] = harness.command.mock.calls;
  expect(harness.command).toHaveBeenCalledTimes(1);
  expect(path).toBe("/api/vibe64/training/lessons/start");
  expect(body).toEqual({ ...selection, requestId: outcome.requestId });
  expect(body.requestId).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
  expect(outcome).toMatchObject({ attemptId: A, learnerId: "learner-owner", current: true, ended: false });
  expect(courses.startRetry.value).toBeNull();
});

it("retains exact start identity and inputs across an uncertain result without admitting changed intent", async () => {
  harness.command.mockRejectedValueOnce(new Error("ack lost"));
  await expect(courses.startLesson(selection)).rejects.toThrow("ack lost");
  const first = harness.command.mock.calls[0][1];
  expect(courses.startRetry.value).toEqual(selection);
  await expect(courses.startLesson({ ...selection, lessonCode: "V64-START-01" })).rejects.toThrow("Retry that same lesson");
  expect(harness.command).toHaveBeenCalledTimes(1);
  await courses.retryStart();
  expect(harness.command.mock.calls[1][1]).toEqual(first);
  expect(courses.startRetry.value).toBeNull();
});

it("retains exact retry when the start response is not a confirmed saved attempt", async () => {
  harness.command.mockResolvedValueOnce({ ok: false });
  await expect(courses.startLesson(selection)).rejects.toThrow("did not return a confirmed saved attempt");
  expect(courses.startRetry.value).toEqual(selection);
});

it("reports the ended original replay, not an unrelated active successor returned beside it", async () => {
  harness.command.mockResolvedValueOnce({ ok: true, available: true,
    attempt: { attemptId: A, ended: { reason: "discarded" } }, active: { attemptId: B } });
  const outcome = await courses.startLesson(selection);
  expect(outcome).toMatchObject({ attemptId: A, ended: true });
  expect(harness.command).toHaveBeenCalledTimes(1);
});

it.each(["closed", "actor"])("keeps an admitted start truthful but not current after Learning is %s", async change => {
  const admitted = Promise.withResolvers(); harness.command.mockReturnValueOnce(admitted.promise);
  const pending = courses.startLesson(selection);
  if (change === "closed") open.value = false;
  if (change === "actor") viewer.value = { actorKey: "member" };
  admitted.resolve({ ok: true, available: true, active: { attemptId: A } });
  const outcome = await pending;
  expect(outcome).toMatchObject({ attemptId: A, current: false });
  expect(harness.command).toHaveBeenCalledTimes(1);
});

it("resumes only the exact requested attempt", async () => {
  const outcome = await courses.resumeLesson(A);
  expect(harness.command.mock.calls[0]).toEqual([`/api/vibe64/training/attempts/${A}/resume`, {}]);
  expect(outcome).toMatchObject({ attemptId: A, current: true });
  harness.command.mockResolvedValueOnce({ ok: true, available: true, active: { attemptId: B } });
  await expect(courses.resumeLesson(A)).rejects.toThrow("requested attempt");
  expect(harness.command).toHaveBeenCalledTimes(2);
});

it("continues a left lesson as a new attempt, reusing its continuation request ID on retry", async () => {
  harness.command.mockRejectedValueOnce(new Error("ack lost"));
  await expect(courses.continueLesson({ attemptId: A, expectedRevision: 4 })).rejects.toThrow("ack lost");
  const [path, first] = harness.command.mock.calls[0];
  expect(path).toBe(`/api/vibe64/training/attempts/${A}/continue`);
  expect(first).toEqual({ requestId: expect.stringMatching(/^[a-f0-9]{18}$/u), expectedRevision: 4 });
  expect(courses.starting.value).toBe(false);
  harness.command.mockResolvedValueOnce({ ok: true, available: true, active: { attemptId: B } });
  const outcome = await courses.continueLesson({ attemptId: A, expectedRevision: 4 });
  expect(harness.command.mock.calls[1][1], "the retry repeats the same continuation").toEqual(first);
  expect(outcome).toMatchObject({ attemptId: B, current: true });
  await courses.continueLesson({ attemptId: A, expectedRevision: 5 });
  expect(harness.command.mock.calls[2][1].requestId, "a confirmed continuation is not reused").not.toBe(first.requestId);
});

it("never overlaps another UI operation and retains the exact start retry", async () => {
  const admitted = Promise.withResolvers(); harness.command.mockReturnValueOnce(admitted.promise);
  const pending = courses.startLesson(selection); await flush();
  expect(await courses.resumeLesson(B)).toBeNull();
  expect(harness.command).toHaveBeenCalledTimes(1);
  admitted.reject(new Error("acknowledgement lost"));
  await expect(pending).rejects.toThrow("acknowledgement lost");
  expect(courses.startRetry.value).toEqual(selection);
  await courses.retryStart();
  expect(harness.command.mock.calls[1][1]).toEqual(harness.command.mock.calls[0][1]);
});

it("reports a start in flight as starting, offering its exact retry only after it settles unconfirmed", async () => {
  const admitted = Promise.withResolvers(); harness.command.mockReturnValueOnce(admitted.promise);
  const pending = courses.startLesson(selection); await flush();
  expect(courses.starting.value).toBe(true);
  expect(courses.startRetry.value).toBeNull();
  admitted.reject(new Error("ack lost"));
  await expect(pending).rejects.toThrow("ack lost");
  expect(courses.starting.value).toBe(false);
  expect(courses.startRetry.value).toEqual(selection);
  await courses.retryStart();
  expect(courses.startRetry.value).toBeNull();
});

it("reports an admitted start as not current after the fresh progress read revokes access", async () => {
  read.mockRejectedValueOnce(Object.assign(new Error("revoked"), { status: 403 }));
  const outcome = await courses.startLesson(selection);
  expect(outcome).toMatchObject({ attemptId: A, current: false });
  expect(courses.learningResource.data.value).toBeNull();
});

it("fences requests while Learning is closed and makes them again once it opens", async () => {
  open.value = false; await flush();
  expect(courses.active.value).toBe(false);
  await expect(courses.startLesson(selection)).rejects.toThrow("Open Learning");
  expect(harness.command).not.toHaveBeenCalled();
  open.value = true; await flush();
  const outcome = await courses.startLesson(selection);
  expect(outcome).toMatchObject({ attemptId: A, current: true });
  expect(harness.command.mock.calls.map(([path]) => path)).toEqual(["/api/vibe64/training/lessons/start"]);
});


// New opt-in uses the SAME original real Query/resource/command fixture.
async function mountSavedAuthorTrial() {
  app.unmount(); queryClient.clear();
  const enabled = ref(true);
  read.mockImplementation(async path => path.endsWith("/author-preview")
    ? { ok: true, available: true, authorPreview: true, revision: 7,
        active: { attemptId: B, pin: { topic: { commit: "b".repeat(40) }, lesson: { code: "DRAFT-ONE" } } }, history: [] }
    : path.endsWith("/learning") ? progress(`learner-${viewer.value.actorKey}`) : { ok: true, courses: [] });
  mount({ authorPreview: enabled });
  await flush(); return enabled;
}

it("resumes only the already admitted author trial through original Resume", async () => {
  await mountSavedAuthorTrial();
  const normal = JSON.parse(JSON.stringify(courses.learningResource.data.value));
  harness.command.mockResolvedValueOnce({ ok: true, available: true, active: { attemptId: B } });
  const outcome = await courses.resumeAuthorPreview(B);
  expect(harness.command.mock.calls).toEqual([[`/api/vibe64/training/attempts/${B}/resume`, {}]]);
  expect(outcome).toMatchObject({ attemptId: B, current: true, ended: false });
  expect(courses.learningResource.data.value).toEqual(normal);
  expect(harness.command.mock.calls.some(([path]) => path.includes("/lessons/start") || path.includes("author-preview"))).toBe(false);
  await expect(courses.resumeAuthorPreview(A)).rejects.toThrow("exact saved author trial");
});

it("masks saved author trial immediately on role loss and refuses new requests without effects", async () => {
  const enabled = await mountSavedAuthorTrial(); const count = read.mock.calls.length;
  enabled.value = false;
  expect(courses.savedAuthorPreview.value).toBeNull(); expect(courses.authorPreviewResource.data.value).toBeNull();
  await courses.authorPreviewResource.reload(); await courses.authorPreviewResource.query.refetch();
  expect(read).toHaveBeenCalledTimes(count);
  await expect(courses.resumeAuthorPreview(B)).rejects.toThrow("exact saved author trial");
  expect(harness.command).not.toHaveBeenCalled();
});

it.each(["role", "actor", "attempt"])("keeps author Resume admitted but not current when %s changes", async change => {
  const enabled = await mountSavedAuthorTrial(); const admitted = Promise.withResolvers();
  harness.command.mockReturnValueOnce(admitted.promise); const pending = courses.resumeAuthorPreview(B);
  if (change === "role") enabled.value = false;
  if (change === "actor") viewer.value = { actorKey: "another-owner" };
  if (change === "attempt") {
    read.mockImplementation(async path => path.endsWith("/author-preview")
      ? { ok: true, available: true, authorPreview: true, active: { attemptId: A } }
      : path.endsWith("/learning") ? progress("learner-owner") : { ok: true, courses: [] });
    await courses.authorPreviewResource.reload();
  }
  admitted.resolve({ ok: true, available: true, active: { attemptId: B } });
  expect(await pending).toMatchObject({ attemptId: B, current: false });
  expect(harness.command).toHaveBeenCalledTimes(1);
});

it("retries an uncertain author Resume exactly and reports it not current after preview read revocation", async () => {
  await mountSavedAuthorTrial();
  harness.command.mockRejectedValueOnce(new Error("Resume acknowledgement lost"));
  await expect(courses.resumeAuthorPreview(B)).rejects.toThrow("Resume acknowledgement lost");
  read.mockImplementation(async path => {
    if (path.endsWith("/author-preview")) throw Object.assign(new Error("owner revoked"), { status: 403 });
    return path.endsWith("/learning") ? progress("learner-owner") : { ok: true, courses: [] };
  });
  harness.command.mockResolvedValueOnce({ ok: true, available: true, active: { attemptId: B } });
  const outcome = await courses.resumeAuthorPreview(B);
  expect(outcome).toMatchObject({ attemptId: B, current: false });
  expect(harness.command.mock.calls[1]).toEqual(harness.command.mock.calls[0]);
  expect(courses.savedAuthorPreview.value).toBeNull();
});

it("refreshes a newly admitted author trial when Learning reopens without reload", async () => {
  await mountSavedAuthorTrial();
  open.value = false; await flush();
  read.mockImplementation(async path => path.endsWith("/author-preview")
    ? { ok: true, available: true, authorPreview: true, revision: 8, active: { attemptId: A } }
    : path.endsWith("/learning") ? progress("learner-owner") : { ok: true, courses: [] });
  read.mockClear();
  open.value = true; await flush();
  expect(courses.savedAuthorPreview.value.attemptId).toBe(A);
  expect(read.mock.calls.filter(([path]) => path.endsWith("/author-preview"))).toHaveLength(1);
  expect(harness.command).not.toHaveBeenCalled();
});
