import { computed, onScopeDispose, ref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { mainConversationId } from "@local/vibe64-sessions/shared/conversation";
import { createTrainingNavigation } from "./createTrainingNavigation.js";
import { useTrainingPresentationCue } from "./useTrainingPresentationCue.js";
import { executeTrainingPresentationOperation, trainingPresentationReceipt } from "./presentationOperation.js";

// A captured Main application owns only product read/commands and the original
// shared browser transaction. It creates no subscriber, player or speech queue.
export function useTrainingMainPresentation({ identity, current, preview, voice, enabled, ready }) {
  const clientId = globalThis.crypto.randomUUID();
  const conversationId = mainConversationId(identity);
  const base = `${identity.sessionsApiPath}/${encodeURIComponent(identity.sessionId)}/training/presentation`;
  const error = ref("");
  let mounted = true;
  let generation = 0;
  const alive = () => mounted && current.value && enabled.value;
  const scope = () => ({ mounted: alive(), clientId, conversationId, runtimeConversationId: conversationId,
    actorKey: identity.actorKey });
  const voiceSession = computed(() => voice?.controller.state.binding?.conversationId === conversationId
    ? voice.controller.state.session : null);
  function selectedPreview() {
    const handle = preview?.value;
    return handle?.sessionId === identity.sessionId &&
      (handle.projectSlug || "") === (identity.sourceProjectSlug || "") &&
      handle.learningAttemptId === identity.learningAttemptId && handle.learnerId === identity.learnerId ? handle : null;
  }
  const original = getHttpWebClient();
  const resource = useEndpointResource({
    path: `${base}?clientId=${encodeURIComponent(clientId)}`,
    queryKey: ["vibe64", "training", "main-presentation", identity.actorKey, identity.learnerId,
      identity.learningAttemptId, identity.sessionId, clientId], enabled: computed(() => alive() && ready.value),
    client: { async request(path, options) {
      const expected = generation;
      const value = await original.request(path, options);
      return { generation: expected, value };
    } }, queryOptions: { retry: false }, fallbackLoadError: "The lesson presentation could not be read."
  });
  const product = computed(() => {
    const status = Number(resource.query.error.value?.statusCode || resource.query.error.value?.status || 0);
    return alive() && status !== 401 && status !== 403 && resource.data.value?.generation === generation
      ? resource.data.value.value : null;
  });
  const command = useCommand({ ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: "app", access: "never",
    apiSuffix: "/vibe64/training", placementSource: "vibe64.training.main-presentation",
    suppressSuccessMessage: true, buildRawPayload: (_model, { context }) => context.body,
    buildCommandOptions: (_model, { context }) => ({ path: context.path, method: "POST" }),
    fallbackRunError: "The lesson presentation receipt was not confirmed. Read its current status before continuing." });
  async function acknowledge(body) {
    if (!alive()) throw new Error("This Main lesson browser is no longer selected.");
    const expected = generation;
    const result = await command.run({ path: `${base}/ack`, body });
    if (!alive() || expected !== generation) return result;
    if (result?.ok !== true) throw new Error(result?.error || "The lesson presentation receipt was not confirmed.");
    return result;
  }
  const cue = useTrainingPresentationCue({ scope, presentation: () => selectedPreview()?.presentation,
    voiceSession, acknowledge, error, holdMainReplies: true });
  const navigation = createTrainingNavigation({ scope, navigate: () => selectedPreview() ? async command => {
    const handle = selectedPreview();
    if (!alive() || !handle || (command.projectSlug || "") !== (identity.sourceProjectSlug || "") || command.sessionId !== identity.sessionId || command.pane !== "preview") {
      throw new Error("Use this exact learner lesson’s existing presentation handle.");
    }
    if (command.presentation?.operation === "cue") cue.requireCueCapacity();
    const expected = generation;
    const result = await executeTrainingPresentationOperation(handle.presentation, command.presentation);
    if (!alive() || generation !== expected || selectedPreview() !== handle) {
      throw new Error("The lesson presentation changed while its operation was running.");
    }
    return { focus: { projectSlug: identity.sourceProjectSlug || "", sessionId: identity.sessionId, pane: "preview" },
      presentation: trainingPresentationReceipt(result) };
  } : null, beforeNavigate: () => undefined, acknowledge, error });
  async function refresh() {
    if (!alive()) return null;
    const expected = generation;
    const result = await resource.query.refetch();
    return alive() && expected === generation ? result : null;
  }
  watch(() => [alive(), ready.value, selectedPreview()], async () => {
    if (!alive() || !ready.value) return;
    const expected = generation;
    try {
      const result = await command.run({ path: `${base}/focus`, body: { clientId,
        focus: { pane: selectedPreview() ? "preview" : "session",
          ...(identity.noExercise === false ? { projectSlug: identity.sourceProjectSlug } : {}) } } });
      if (!alive() || expected !== generation) return;
      if (result?.ok !== true) throw new Error(result?.error || "This Main lesson browser could not report its view.");
      await refresh();
    } catch (cause) { if (alive() && expected === generation) error.value = cause.message; }
  }, { immediate: true });
  watch(product, value => {
    if (!value || !alive()) return;
    if (value.cue) cue.observe(value.cue);
    if (value.navigation) void navigation.handle(value.navigation);
  }, { flush: "sync", immediate: true });
  watch(current, valid => {
    if (valid) return;
    generation += 1;
    cue.retire("This Main learner conversation is no longer available.");
    navigation.reset();
  }, { flush: "sync" });
  onScopeDispose(() => {
    cue.retire("This Main lesson owner was retired.");
    mounted = false;
    generation += 1;
    navigation.reset();
    // Do not clear retired origins while an old voice lease could still read
    // this captured binding. Original voice close precedes releasing that lease.
  });
  return { clientId, error, refresh,
    receiveEvent(event) {
      if (!alive()) return;
      if (["configuration", "settled"].includes(event.type)) return refresh();
      if (["error", "replaced"].includes(event.type)) cue.retire("The native explanation was retired.");
    },
    voiceState: (state, turns) => cue.voiceState(state, conversationId, turns),
    narration: value => cue.narration(value, conversationId),
    playback: event => cue.playback(event, conversationId),
    retire: reason => cue.retire(reason)
  };
}
