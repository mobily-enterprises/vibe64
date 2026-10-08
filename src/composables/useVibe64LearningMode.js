import { computed, inject, onScopeDispose, ref, shallowRef, toValue, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";

const TRAINING_PATH = "/api/vibe64/training";

// This UI adapter owns neither admission nor progress. Original Training and
// Sessions actions reauthorize every captured attempt before changing anything.
export function useVibe64LearningMode({ onConversationOpened = null } = {}) {
  const route = useRoute();
  const router = useRouter();
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
  const actorKey = computed(() => String(toValue(viewer)?.actorKey || ""));
  const learningMode = computed(() => route.query.mode === "learning");
  const purposeFilter = computed(() => learningMode.value ? "learning" : "working");
  let generation = 0;
  let disposed = false;
  watch(() => [actorKey.value, route.fullPath, learningMode.value], () => { generation += 1; }, { flush: "sync" });
  onScopeDispose(() => { disposed = true; generation += 1; });

  function readResource(name) {
    const client = getHttpWebClient();
    const original = useEndpointResource({
      path: `${TRAINING_PATH}/${name}`,
      queryKey: computed(() => ["vibe64", "training", name, actorKey.value || "signed-out"]),
      enabled: computed(() => Boolean(actorKey.value)),
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
      return actorKey.value && status !== 401 && status !== 403 && result?.reader === actorKey.value
        ? result.value : null;
    });
    async function refetch(options) {
      if (!actorKey.value || disposed) return null;
      const reader = actorKey.value;
      const result = await original.query.refetch(options);
      return { ...result, data: reader === actorKey.value && !disposed ? data.value : null };
    }
    return Object.freeze({ ...original, data,
      query: { ...original.query, data, refetch }, reload: () => refetch() });
  }

  const coursesResource = readResource("courses");
  const learningResource = readResource("learning");
  const learnerId = computed(() => learningResource.data.value?.ok === true && learningResource.data.value?.available === true
    && typeof learningResource.data.value.learnerId === "string" ? learningResource.data.value.learnerId : "");
  const busy = ref(false);
  const pendingStart = shallowRef(null);
  const startRetry = computed(() => pendingStart.value?.actor === actorKey.value ? pendingStart.value.input : null);
  const command = useCommand({
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: "app", access: "never",
    apiSuffix: "/vibe64/training", placementSource: "vibe64.training.learning-mode",
    suppressSuccessMessage: true,
    buildRawPayload: (_model, { context }) => context.body,
    buildCommandOptions: (_model, { context }) => ({ method: "POST", path: context.path }),
    fallbackRunError: "The lesson request was not confirmed. Retry the same request before starting another lesson."
  });

  async function setLearningMode(value) {
    const query = { ...route.query };
    if (value) query.mode = "learning";
    else delete query.mode;
    return router.replace({ path: route.path, hash: route.hash, query });
  }

  function capture() {
    if (disposed || !actorKey.value || !learningMode.value || !learnerId.value) {
      throw new Error("Open Learning mode and read your saved lessons before making a lesson request.");
    }
    return Object.freeze({ actor: actorKey.value, learnerId: learnerId.value, generation });
  }
  const current = scope => !disposed && scope.actor === actorKey.value && scope.learnerId === learnerId.value
    && scope.generation === generation && learningMode.value;

  async function refresh() {
    if (!actorKey.value || disposed) return null;
    return Promise.all([coursesResource.reload(), learningResource.reload()]);
  }

  async function prepare(path, body, scope, { openConversation = true, attemptId = "" } = {}) {
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
    let conversation = null;
    if (openConversation && !admitted.ended && current(scope)) {
      conversation = await command.run({
        path: `/api/learning/${encodeURIComponent(admitted.attemptId)}/vibe64/sessions`, body: {}
      });
      if (conversation?.ok !== true || !conversation?.sessionId) {
        throw new Error("The saved lesson conversation was not confirmed. Resume this exact attempt to open it again.");
      }
    }
    if (current(scope)) {
      await learningResource.reload();
      if (conversation && current(scope)) {
        onConversationOpened?.({ attemptId: admitted.attemptId, sessionId: conversation.sessionId, learnerId: scope.learnerId });
      }
    }
    return { result, attemptId: admitted.attemptId, learnerId: scope.learnerId,
      sessionId: conversation?.sessionId || "", ended: Boolean(admitted.ended), current: current(scope) };
  }

  async function startLesson(selection, options = {}) {
    if (busy.value) return null;
    const scope = capture();
    const input = Object.freeze({ courseId: selection.courseId, release: selection.release,
      lessonCode: selection.lessonCode, expectedRevision: selection.expectedRevision });
    let request = pendingStart.value;
    if (request?.actor === scope.actor) {
      const same = Object.keys(input).every(key => input[key] === request.input[key]);
      if (!same) throw new Error("A previous start was not confirmed. Retry that same lesson request first.");
    } else {
      request = Object.freeze({ actor: scope.actor, input, requestId: globalThis.crypto.randomUUID() });
      pendingStart.value = request;
    }
    busy.value = true;
    try {
      const outcome = await prepare(`${TRAINING_PATH}/lessons/start`,
        { ...request.input, requestId: request.requestId }, scope, options);
      if (pendingStart.value === request) pendingStart.value = null;
      return { ...outcome, requestId: request.requestId };
    } finally { busy.value = false; }
  }

  function retryStart(options = {}) {
    if (!startRetry.value) throw new Error("There is no unconfirmed lesson start for this account.");
    return startLesson(startRetry.value, options);
  }

  async function resumeLesson(attemptId, options = {}) {
    if (busy.value) return null;
    const scope = capture();
    busy.value = true;
    try {
      return await prepare(`${TRAINING_PATH}/attempts/${encodeURIComponent(attemptId)}/resume`, {}, scope, { ...options, attemptId });
    } finally { busy.value = false; }
  }

  return Object.freeze({ learningMode, purposeFilter, setLearningMode,
    coursesResource, learningResource, learnerId, busy, startRetry,
    refresh, startLesson, retryStart, resumeLesson });
}
