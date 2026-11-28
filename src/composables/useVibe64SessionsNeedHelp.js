import { computed, onMounted, ref, watch } from "vue";
import { vibe64NeedHelpPresentation, vibe64SessionNeedHelp } from "@/lib/vibe64NeedHelp.js";

// The session tabs' Need help (@/lib/vibe64NeedHelp.js): what each tab says of its session's, kept current by a clock
// that moves while one is shown, so a request that waits unanswered says so; and the session whose Need help is open,
// read from the list as it changes, so its dialog shows each change as it arrives.

/** @param {import("vue").Ref<object[]>} sessions the sessions the tabs show */
function useVibe64SessionsNeedHelp(sessions) {
  const now = ref(Date.now());
  onMounted(() => {
    watch(() => sessions.value.some((session) => vibe64SessionNeedHelp(session)), (shown, _previous, onCleanup) => {
      now.value = Date.now();
      if (!shown) return;
      const timer = setInterval(() => { now.value = Date.now(); }, 30_000);
      onCleanup(() => clearInterval(timer));
    }, { immediate: true });
  });
  const openSessionId = ref("");
  const sessionsApiPath = ref("");
  const session = computed(() => sessions.value.find((entry) => entry.sessionId === openSessionId.value) || null);

  /** What the session's tab says of its Need help, or null without one. */
  const presentation = (entry) => vibe64NeedHelpPresentation(vibe64SessionNeedHelp(entry), now.value);

  /** The tab details' Need help line: where it stands and its newest request, cut to a line; "" without one. */
  function fact(entry) {
    const flag = vibe64SessionNeedHelp(entry);
    if (!flag) return "";
    const request = flag.messages.findLast((message) => message.kind === "request") || flag.messages[0];
    const line = request.text.split("\n")[0];
    const state = presentation(entry).label.replace(/^Need help(?: · )?/u, "") || "Open";
    return `${state}: ${line.length > 120 ? `${line.slice(0, 119)}…` : line}`;
  }

  /** Opens the session's Need help through the sessions API it is listed by; false without one. */
  function open(entry, apiPath) {
    if (!apiPath) return false;
    sessionsApiPath.value = apiPath;
    openSessionId.value = entry.sessionId;
    return true;
  }

  const close = () => { openSessionId.value = ""; };

  return { close, fact, open, presentation, session, sessionsApiPath };
}

export { useVibe64SessionsNeedHelp };
