import { computed, inject, onScopeDispose, ref, shallowRef, toValue, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { VIBE64_LEARNING_ROUTES, VIBE64_LESSON_IN_PROGRESS_CODE } from "@/lib/vibe64Learning.js";

// The Courses overlay's adapter. It owns neither admission nor progress:
// original Training actions reauthorize every captured attempt before changing
// anything. `active` (a ref or getter) is the overlay's open state; requests
// are made only while it is open, and it stays above the app, so app
// navigation behind it does not retire them.
export function useVibe64LearningCourses({ active } = {}) {
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
  const actorKey = computed(() => String(toValue(viewer)?.actorKey || ""));
  const open = computed(() => toValue(active) === true);
  let generation = 0;
  let disposed = false;
  watch(() => [actorKey.value, open.value], () => { generation += 1; }, { flush: "sync" });
  onScopeDispose(() => { disposed = true; generation += 1; });

  function readResource(name, path, enabled = null) {
    const client = getHttpWebClient();
    const original = useEndpointResource({
      path,
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

  const coursesResource = readResource("courses", VIBE64_LEARNING_ROUTES.courses);
  const learningResource = readResource("learning", VIBE64_LEARNING_ROUTES.learning);
  // The official catalogue is read from GitHub by the server, so only while L is open.
  const availableResource = readResource("available", VIBE64_LEARNING_ROUTES.available, open);
  // A host's own reads beside the courses (hostRead), reread with them.
  const hostReads = new Set();
  // Saved lessons may change while L is closed. Opening L rereads them, not
  // reusing an earlier picker result.
  watch(open, (value, previous) => {
    if (value && !previous) void refresh();
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
    && (!scope.savedIn || scope.savedIn.current() === true);

  async function refresh() {
    if (!actorKey.value || disposed) return null;
    return Promise.all([coursesResource.reload(), learningResource.reload(), availableResource.reload(),
      ...[...hostReads].map(read => read.reload())]);
  }

  // A host's own actor-scoped read shown beside the courses, made in the
  // calling component's setup with the same reader tagging and reread by
  // refresh() while that component is mounted.
  function hostRead(name, path, enabled = null) {
    const resource = readResource(name, path, enabled);
    hostReads.add(resource);
    onScopeDispose(() => hostReads.delete(resource));
    return resource;
  }

  // onAdmitted(attemptId): called once the server confirms an attempt that is
  // still current here, before the progress reread. The caller then closes
  // Courses to show the lesson at once, so from that point only another person
  // or revoked access (not Courses closing) makes the outcome not current.
  async function prepare(path, body, scope, { attemptId = "", onAdmitted = null } = {}) {
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
    const handedOver = typeof onAdmitted === "function" && !admitted.ended && current(scope);
    const stillCurrent = handedOver
      ? () => scope.actor === actorKey.value && scope.learnerId === learnerId.value
      : () => current(scope);
    if (handedOver) onAdmitted(admitted.attemptId);
    if (stillCurrent()) {
      await learningResource.reload();
      if (scope.savedIn) await scope.savedIn.reload();
    }
    return { result, attemptId: admitted.attemptId, learnerId: scope.learnerId,
      ended: Boolean(admitted.ended), current: stillCurrent() };
  }

  // archiveCurrent: the learner confirmed archiving a different lesson in
  // progress, which refused the first start (VIBE64_TRAINING_LESSON_IN_PROGRESS).
  async function startLesson(selection, { onAdmitted = null } = {}) {
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
      const outcome = await prepare(VIBE64_LEARNING_ROUTES.lessonStart,
        { ...request.input, requestId: request.requestId }, scope, { onAdmitted });
      if (pendingStart.value === request) pendingStart.value = null;
      return { ...outcome, requestId: request.requestId };
    } catch (cause) {
      // A definite refusal (another lesson in progress) leaves nothing to retry.
      if (cause?.code === VIBE64_LESSON_IN_PROGRESS_CODE && pendingStart.value === request) pendingStart.value = null;
      throw cause;
    } finally { busy.value = false; starting.value = false; }
  }

  async function resume(attemptId, scope, onAdmitted) {
    busy.value = true;
    try {
      return await prepare(VIBE64_LEARNING_ROUTES.lessonResume(attemptId), {}, scope, { attemptId, onAdmitted });
    } finally { busy.value = false; }
  }

  // savedIn: a saved lesson a host lists from its own read ({ current(),
  // reload() }). It is resumed only while that read still shows it, and
  // reread after the resume.
  async function resumeLesson(attemptId, { onAdmitted = null, savedIn = null } = {}) {
    if (busy.value) return null;
    const scope = Object.freeze({ ...capture(), ...(savedIn ? { savedIn } : {}) });
    if (savedIn && (!attemptId || !current(scope))) throw new Error("Read this exact saved lesson before reopening it.");
    return resume(attemptId, scope, onAdmitted);
  }

  // Owner-only custom course through the original catalogue action; it admits
  // no lesson and changes no saved progress.
  async function createCourse({ title, topics, expectedRevision } = {}) {
    if (busy.value) return null;
    capture();
    busy.value = true;
    try {
      const result = await command.run({ path: VIBE64_LEARNING_ROUTES.courses, body: { title, topics, expectedRevision } });
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
      const result = await command.run({ path: VIBE64_LEARNING_ROUTES.courseInstall, body: { courseId, release } });
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

  return Object.freeze({ active: open,
    coursesResource, learningResource, availableResource, installState, installCourse, learnerId, busy, starting, startRetry,
    refresh, hostRead, startLesson, resumeLesson, createCourse });
}
