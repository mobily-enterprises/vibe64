import { computed, inject, onScopeDispose, ref, shallowRef, toValue, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { VIBE64_LESSON_IN_PROGRESS_CODE } from "@/lib/vibe64Learning.js";

const TRAINING_PATH = "/api/vibe64/training";

// The Courses overlay's adapter. It owns neither admission nor progress:
// original Training actions reauthorize every captured attempt before changing
// anything. `active` (a ref or getter) is the overlay's open state; requests
// are made only while it is open, and it stays above the app, so app
// navigation behind it does not retire them.
export function useVibe64LearningCourses({ authorPreview = false, active } = {}) {
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
  const actorKey = computed(() => String(toValue(viewer)?.actorKey || ""));
  const open = computed(() => toValue(active) === true);
  let generation = 0;
  let disposed = false;
  watch(() => [actorKey.value, open.value], () => { generation += 1; }, { flush: "sync" });
  onScopeDispose(() => { disposed = true; generation += 1; });

  function readResource(name, enabled = null) {
    const client = getHttpWebClient();
    const original = useEndpointResource({
      path: `${TRAINING_PATH}/${name}`,
      queryKey: computed(() => ["vibe64", "training", name, actorKey.value || "signed-out"]),
      enabled: computed(() => Boolean(actorKey.value) && (!enabled || toValue(enabled) === true)),
      // Tag the existing query result with its admitted reader. Query observers
      // may retain old data briefly while switching keys; it cannot become the
      // next person's progress, even before the observer's next Vue update.
      client: { async request(path, options) {
        const reader = actorKey.value;
        return { reader, value: await client.request(path, options) };
      } },
      queryOptions: { retry: false },
      fallbackLoadError: "The saved lessons could not be read. Refresh to try again."
    });
    const data = computed(() => {
      const status = Number(original.query.error.value?.statusCode || original.query.error.value?.status || 0);
      const result = original.data.value;
      return actorKey.value && (!enabled || toValue(enabled) === true) && status !== 401 && status !== 403 && result?.reader === actorKey.value
        ? result.value : null;
    });
    async function refetch(options) {
      if (!actorKey.value || disposed || (enabled && toValue(enabled) !== true)) return null;
      const reader = actorKey.value;
      const result = await original.query.refetch(options);
      return { ...result, data: reader === actorKey.value && !disposed ? data.value : null };
    }
    return Object.freeze({ ...original, data,
      query: { ...original.query, data, refetch }, reload: () => refetch() });
  }

  const coursesResource = readResource("courses");
  const learningResource = readResource("learning");
  // The official catalogue is read from GitHub by the server, so only while L is open.
  const availableResource = readResource("available", open);
  const authorPreviewEnabled = computed(() => toValue(authorPreview) === true);
  const authorPreviewResource = authorPreview === false ? null : readResource("author-preview", authorPreviewEnabled);
  // Colleague may admit an author trial while L is closed. Opening L must
  // reread the saved attempt, not reuse that earlier empty picker result.
  watch(open, (value, previous) => {
    if (value && !previous) void refresh();
  });
  const savedAuthorPreview = computed(() => {
    const result = authorPreviewResource?.data.value;
    return result?.ok === true && result.available === true && result.authorPreview === true && !result.active?.ended
      ? result.active || null : null;
  });
  const learnerId = computed(() => learningResource.data.value?.ok === true && learningResource.data.value?.available === true
    && typeof learningResource.data.value.learnerId === "string" ? learningResource.data.value.learnerId : "");
  const busy = ref(false);
  const pendingStart = shallowRef(null);
  // A start in flight is not yet unconfirmed: offer its exact retry only after
  // that request settles without confirming the attempt and its conversation.
  const starting = ref(false);
  const startRetry = computed(() => !starting.value && pendingStart.value?.actor === actorKey.value ? pendingStart.value.input : null);
  const command = useCommand({
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: "app", access: "never",
    apiSuffix: "/vibe64/training", placementSource: "vibe64.training.learning-mode",
    suppressSuccessMessage: true,
    buildRawPayload: (_model, { context }) => context.body,
    buildCommandOptions: (_model, { context }) => ({ method: "POST", path: context.path }),
    fallbackRunError: "The lesson request was not confirmed. Retry the same request before starting another lesson."
  });

  function capture() {
    if (disposed || !actorKey.value || !open.value || !learnerId.value) {
      throw new Error("Open Courses and read your saved lessons before making a lesson request.");
    }
    return Object.freeze({ actor: actorKey.value, learnerId: learnerId.value, generation });
  }
  const current = scope => !disposed && scope.actor === actorKey.value && scope.learnerId === learnerId.value
    && scope.generation === generation && open.value
    && (!scope.authorPreviewAttemptId || (authorPreviewEnabled.value &&
      savedAuthorPreview.value?.attemptId === scope.authorPreviewAttemptId && !authorPreviewResource.loadError.value));

  async function refresh() {
    if (!actorKey.value || disposed) return null;
    return Promise.all([coursesResource.reload(), learningResource.reload(), availableResource.reload(),
      ...(authorPreviewResource ? [authorPreviewResource.reload()] : [])]);
  }

  async function prepare(path, body, scope, { attemptId = "" } = {}) {
    const result = await command.run({ path, body });
    if (!result || result.ok !== true || result.available !== true) {
      throw new Error("The lesson request did not return a confirmed saved attempt. Retry the same request.");
    }
    // An ended replay can also describe an unrelated active successor. It is
    // a historical receipt, never permission to open that successor instead.
    const admitted = result.attempt?.ended ? result.attempt : result.active;
    if (!admitted?.attemptId || (attemptId && admitted.attemptId !== attemptId)) {
      throw new Error("The lesson response did not confirm the requested attempt.");
    }
    if (current(scope)) {
      await learningResource.reload();
      if (scope.authorPreviewAttemptId) await authorPreviewResource.reload();
    }
    return { result, attemptId: admitted.attemptId, learnerId: scope.learnerId,
      ended: Boolean(admitted.ended), current: current(scope) };
  }

  // archiveCurrent: the learner confirmed archiving a different lesson in
  // progress, which refused the first start (VIBE64_TRAINING_LESSON_IN_PROGRESS).
  async function startLesson(selection) {
    if (busy.value) return null;
    const scope = capture();
    const input = Object.freeze({ courseId: selection.courseId, release: selection.release,
      lessonCode: selection.lessonCode, expectedRevision: selection.expectedRevision,
      ...(selection.archiveCurrent === true ? { archiveCurrent: true } : {}) });
    let request = pendingStart.value;
    if (request?.actor === scope.actor) {
      const same = Object.keys(input).every(key => input[key] === request.input[key]) &&
        Object.keys(request.input).length === Object.keys(input).length;
      if (!same) throw new Error("A previous start was not confirmed. Retry that same lesson request first.");
    } else {
      request = Object.freeze({ actor: scope.actor, input, requestId: globalThis.crypto.randomUUID() });
      pendingStart.value = request;
    }
    busy.value = true;
    starting.value = true;
    try {
      const outcome = await prepare(`${TRAINING_PATH}/lessons/start`,
        { ...request.input, requestId: request.requestId }, scope);
      if (pendingStart.value === request) pendingStart.value = null;
      return { ...outcome, requestId: request.requestId };
    } catch (cause) {
      // A definite refusal (another lesson in progress) leaves nothing to retry.
      if (cause?.code === VIBE64_LESSON_IN_PROGRESS_CODE && pendingStart.value === request) pendingStart.value = null;
      throw cause;
    } finally { busy.value = false; starting.value = false; }
  }

  async function resumeLesson(attemptId) {
    if (busy.value) return null;
    const scope = capture();
    busy.value = true;
    try {
      return await prepare(`${TRAINING_PATH}/attempts/${encodeURIComponent(attemptId)}/resume`, {}, scope, { attemptId });
    } finally { busy.value = false; }
  }

  // Owner-only custom course through the original catalogue action; it admits
  // no lesson and changes no saved progress.
  async function createCourse({ title, topics, expectedRevision } = {}) {
    if (busy.value) return null;
    capture();
    busy.value = true;
    try {
      const result = await command.run({ path: `${TRAINING_PATH}/courses`, body: { title, topics, expectedRevision } });
      if (result?.ok !== true || !result.course?.courseId) {
        throw new Error(result?.error || "The new course was not confirmed. Refresh courses before trying again.");
      }
      await coursesResource.reload();
      return result;
    } finally { busy.value = false; }
  }

  // Installs or updates one exact official catalogue release through the
  // original course.install action. Its outcome stays visible on that course.
  const installRecord = shallowRef(null);
  const installState = computed(() => installRecord.value?.actor === actorKey.value ? installRecord.value : null);
  async function installCourse({ courseId, release } = {}) {
    if (busy.value) return null;
    const scope = capture();
    const target = Object.freeze({ actor: scope.actor, courseId, release });
    busy.value = true;
    installRecord.value = Object.freeze({ ...target, phase: "installing", message: "" });
    // The server reports per-topic progress on the catalogue read meanwhile.
    const poll = setInterval(() => { void availableResource.reload(); }, 1500);
    try {
      const result = await command.run({ path: `${TRAINING_PATH}/courses/install`, body: { courseId, release } });
      if (result?.ok !== true || result.course?.courseId !== courseId || result.course.release !== release) {
        throw new Error(result?.error || "The course installation was not confirmed. Refresh courses, then retry.");
      }
      if (installRecord.value?.courseId === courseId && installRecord.value.release === release) installRecord.value = null;
      await Promise.all([coursesResource.reload(), availableResource.reload()]);
      return result;
    } catch (cause) {
      if (current(scope)) {
        installRecord.value = Object.freeze({ ...target, phase: "failed",
          message: String(cause?.message || "The course installation was not confirmed. Refresh courses, then retry.") });
      }
      return null;
    } finally {
      clearInterval(poll);
      busy.value = false;
    }
  }

  async function resumeAuthorPreview(attemptId) {
    if (busy.value) return null;
    const scope = Object.freeze({ ...capture(), authorPreviewAttemptId: attemptId });
    if (!attemptId || !current(scope)) throw new Error("Read this owner's exact saved author trial before reopening it.");
    busy.value = true;
    try {
      return await prepare(`${TRAINING_PATH}/attempts/${encodeURIComponent(attemptId)}/resume`, {}, scope, { attemptId });
    } finally { busy.value = false; }
  }

  return Object.freeze({ active: open,
    coursesResource, learningResource, availableResource, installState, installCourse, learnerId, busy, starting, startRetry,
    refresh, startLesson, resumeLesson, createCourse, authorPreviewEnabled, authorPreviewResource, savedAuthorPreview, resumeAuthorPreview });
}
