import { computed, effectScope, markRaw, onScopeDispose, ref, toValue, watch } from "vue";
import { createVibe64ConversationDelivery } from "../../../src/composables/useVibe64ConversationRuntime.js";
import { useVibe64AgentSettings } from "../../../src/composables/useVibe64AgentSettings.js";

// The view receives a runtime from its host. Exercise the real delivery owner
// here while the fixture supplies session data and HTTP admission responses.
export function attachConversationRuntime(props, viewer = { actorKey: "local" }) {
  let owner;
  let current;
  function release() { if (current) current.value = false; owner?.stop(); }
  watch(() => [props.session?.sessionId, toValue(viewer)?.actorKey || ""], () => {
    release();
    owner = effectScope();
    current = ref(true);
    props.conversationRuntime = markRaw(owner.run(() => {
      const turn = computed(() => props.session?.agentSession?.turn || {});
      const steerable = computed(() => Boolean(turn.value.active && turn.value.id && turn.value.state === "active" &&
        turn.value.status !== "observation_lost" && props.agentConnectionStatus === "connected"));
      return { agentSettings: useVibe64AgentSettings(), ...createVibe64ConversationDelivery({
        current, available: computed(() => Boolean(toValue(viewer)?.actorKey)),
        access: { canUseChat: ref(true) }, turn, steerable,
        conversationLog: props.conversationLog, sendAgentMessage: payload => props.sendAgentMessage(payload)
      }) };
    }));
  }, { immediate: true, flush: "sync" });
  onScopeDispose(release);
  return props;
}
