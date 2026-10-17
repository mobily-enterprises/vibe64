import { computed, inject, onScopeDispose, ref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { mainConversationId } from "@local/vibe64-sessions/shared/conversation";
import { createTrainingNavigation } from "./createTrainingNavigation.js";
import { useTrainingPresentationCue } from "./useTrainingPresentationCue.js";
import { executeTrainingPresentationOperation, trainingPresentationReceipt } from "./presentationOperation.js";
import { VIBE64_BROWSER_NAVIGATION_KEY } from "/src/lib/vibe64AssistantHost.js";

function preparationBusy(error) {
  return [error?.code, error?.response?.code, error?.response?.errors?.[0]?.code]
    .includes("VIBE64_TRAINING_PREPARATION_BUSY");
}

// A captured Main application owns only product read/commands and the original
// shared browser transaction. It creates no subscriber, player or speech queue.
export function useTrainingMainPresentation({ identity, current, preview, voice, enabled, ready, retain,
  browserNavigation = inject(VIBE64_BROWSER_NAVIGATION_KEY, null) }) {
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
  const commandOptions = { ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: "app", access: "never",
    apiSuffix: "/vibe64/training", placementSource: "vibe64.training.main-presentation",
    suppressSuccessMessage: true, buildRawPayload: (_model, { context }) => context.body,
    buildCommandOptions: (_model, { context }) => ({ path: context.path, method: "POST" }),
    fallbackRunError: "The lesson presentation receipt was not confirmed. Read its current status before continuing." };
  // Focus reporting and ACK delivery are independent writes. A route remount
  // can report focus while its visual is ready to acknowledge.
  const command = useCommand(commandOptions);
  const focusCommand = useCommand(commandOptions);
  async function acknowledge(body) {
    if (!alive()) throw new Error("This Main lesson browser is no longer selected.");
    const expected = generation;
    // The shared navigator also reports Working conversation/tool context. Main
    // sends only its existing display-report contract; validation stays strict.
    const payload = body.focus ? { ...body, focus: Object.fromEntries([
      "projectSlug", "sessionId", "pane", "learningMode", "learningView", "learningContent", "learningAttemptId",
      "databaseScreen", "databaseView", "previewScreen"
    ].filter(key => Object.hasOwn(body.focus, key)).map(key => [key, body.focus[key]])) } : body;
    let result;
    for (let attempt = 1; ; attempt += 1) {
      try {
        result = await command.run({ path: `${base}/ack`, body: payload });
        break;
      } catch (cause) {
        // Practice Preview/output work shares the saved attempt's preparation
        // barrier. Its busy refusal precedes any receipt effect, so resend this
        // same receipt briefly, well inside the server's navigation deadline.
        if (!preparationBusy(cause) || attempt >= 8 || !alive() || expected !== generation) throw cause;
        await new Promise(resolve => setTimeout(resolve, 250 * attempt));
        if (!alive() || expected !== generation) throw cause;
      }
    }
    if (!alive() || expected !== generation) return result;
    if (result?.ok !== true) throw new Error(result?.error || "The lesson presentation receipt was not confirmed.");
    return result;
  }
  const cue = useTrainingPresentationCue({ scope, presentation: () => selectedPreview()?.presentation,
    voiceSession, acknowledge, error, holdMainReplies: true });
  const navigation = createTrainingNavigation({ scope, navigate: () => browserNavigation?.value || selectedPreview() ? async command => {
    const navigateBrowser = browserNavigation?.value;
    if (!command.presentation) {
      if (navigateBrowser) return navigateBrowser(command);
      throw new Error("Lesson workspace navigation is unavailable in this installation.");
    }
    const handle = selectedPreview();
    if (!alive() || !handle || (command.projectSlug || "") !== (identity.sourceProjectSlug || "") || command.sessionId !== identity.sessionId || command.pane !== "preview") {
      throw new Error("Use this exact learner lesson’s existing presentation handle.");
    }
    if (command.presentation?.operation === "cue") cue.requireCueCapacity();
    const expected = generation;
    // The routed owner executes the visual and confirms focus after it opens.
    // Reading its focus before the operation returns the previous Lessons pane.
    // It also fences the exact player after routing; Main retains its own lifetime.
    const result = navigateBrowser ? await navigateBrowser(command) : {
      focus: { projectSlug: identity.sourceProjectSlug || "", sessionId: identity.sessionId, pane: "preview" },
      presentation: trainingPresentationReceipt(await executeTrainingPresentationOperation(handle.presentation, command.presentation))
    };
    if (!alive() || generation !== expected || (!navigateBrowser && selectedPreview() !== handle)) {
      throw new Error("The lesson presentation changed while its operation was running.");
    }
    return result;
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
      const result = await focusCommand.run({ path: `${base}/focus`, body: { clientId,
        focus: { pane: selectedPreview() ? "preview" : "session",
          ...(identity.noExercise === false ? { projectSlug: identity.sourceProjectSlug } : {}) } } });
      if (!alive() || expected !== generation) return;
      if (result?.ok !== true) throw new Error(result?.error || "This Main lesson browser could not report its view.");
      await refresh();
    } catch (cause) { if (alive() && expected === generation) error.value = cause.message; }
  }, { immediate: true });
  async function handleNavigation(command) {
    // Routing replaces Main’s view reader. Keep this exact conversation through
    // its own navigation and ACK, then restore ordinary last-reader disposal.
    const retained = retain?.();
    try { await navigation.handle(command); }
    finally { retained?.release(); }
  }
  watch(product, value => {
    if (!value || !alive()) return;
    if (value.cue) cue.observe(value.cue);
    if (value.navigation) void handleNavigation(value.navigation);
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
