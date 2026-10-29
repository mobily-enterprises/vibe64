import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
  VIBE64_SURFACE_ID,
  vibe64SessionPath,
  vibe64SessionQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";

// Decided messages stay as one-line rows for a day, then behind "Show earlier".
const RECENT_DECISION_MS = 24 * 60 * 60 * 1000;
const APPROVAL_REASON = /^main-chat-approval-/u;

function titleWithoutCount(title = "") {
  return String(title).replace(/^\(\d+\) /u, "");
}

// A team member's main-chat messages wait for the owner. One reader per chat:
// everyone sees the same queue; actions depend on who is looking.
function useVibe64MainChatApprovals({
  active = true,
  projectSlug,
  projectLabel = projectSlug,
  sessionId,
  sessionsApiPath,
  onReview = null
} = {}) {
  const feedback = useShellWebErrorRuntime();
  const slug = computed(() => String(readRefOrGetterValue(projectSlug) || ""));
  const id = computed(() => String(readRefOrGetterValue(sessionId) || ""));
  const apiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || ""));
  const enabled = computed(() => readRefOrGetterValue(active) !== false && Boolean(id.value && apiPath.value));
  const path = computed(() => enabled.value ? vibe64SessionPath(apiPath.value, id.value, "/main-chat-approvals") : "");
  const resource = useEndpointResource({
    enabled,
    fallbackLoadError: "Messages waiting for approval could not be loaded.",
    path,
    queryKey: computed(() => [...vibe64SessionQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, slug.value),
      id.value, "main-chat-approvals"]),
    queryOptions: { refetchOnMount: "always", refetchOnWindowFocus: true },
    readMethod: "GET",
    realtime: {
      events: [VIBE64_SESSION_CHANGED_EVENT],
      matches: ({ payload = {} } = {}) => payload.sessionId === id.value && APPROVAL_REASON.test(String(payload.reason || ""))
    },
    refreshOnPull: true,
    requestRecoveryLabel: "Messages for approval"
  });
  const view = computed(() => resource.data.value?.ok === false ? null : resource.data.value || null);
  const loaded = computed(() => Boolean(view.value));
  const isOwner = computed(() => view.value?.owner !== false);
  // A team member's own lesson runs on the team AI and is never queued.
  const lessonTeamAi = computed(() => loaded.value && !isOwner.value && view.value?.practice === true);
  // Before the read arrives the composer keeps its ordinary owner behaviour.
  const memberMode = computed(() => loaded.value && !isOwner.value && !lessonTeamAi.value);
  const ownerName = computed(() => view.value?.ownerName || "the owner");
  const viewerId = computed(() => view.value?.viewer?.id || "");
  const entries = computed(() => Array.isArray(view.value?.entries) ? view.value.entries : []);
  const open = computed(() => entries.value.filter((entry) => ["waiting", "sending"].includes(entry.status)));
  const waitingCount = computed(() => entries.value.filter((entry) => entry.status === "waiting").length);
  const decided = computed(() => entries.value.filter((entry) => !["waiting", "sending"].includes(entry.status)).reverse());
  const now = ref(Date.now());
  const clock = setInterval(() => { now.value = Date.now(); }, 60_000);
  const recentDecided = computed(() => decided.value.filter((entry) =>
    now.value - Date.parse(entry.decidedAt || entry.updatedAt) < RECENT_DECISION_MS));
  const earlierDecided = computed(() => decided.value.slice(recentDecided.value.length));
  const pending = reactive({});
  const sending = ref(false);

  function own(entry) {
    return Boolean(viewerId.value) && entry?.sender?.id === viewerId.value;
  }

  async function request(suffix, body, method = "POST", fallback = "The message could not be changed.") {
    const result = await getHttpWebClient().request(vibe64SessionPath(apiPath.value, id.value, suffix), { method, body });
    if (result?.ok === false) throw vibe64ApiError(result, fallback);
    void resource.reload();
    return result;
  }

  async function act(entry, action, operation) {
    if (pending[entry.id]) return false;
    pending[entry.id] = action;
    try {
      await operation();
      return true;
    } catch (error) {
      feedback.report({ source: `vibe64.main-chat-approvals.${action}`, intent: "action-feedback",
        severity: "error", channel: "snackbar", message: error.message });
      return false;
    } finally {
      delete pending[entry.id];
    }
  }

  async function send(message) {
    if (sending.value || !String(message || "").trim()) return false;
    sending.value = true;
    try {
      await request("/agent-message", { message, messageId: globalThis.crypto.randomUUID() }, "POST",
        "The message could not be sent for approval.");
      return true;
    } catch (error) {
      feedback.report({ source: "vibe64.main-chat-approvals.send", intent: "action-feedback",
        severity: "error", channel: "snackbar", message: error.message });
      return false;
    } finally {
      sending.value = false;
    }
  }

  const route = (entry, suffix = "") => `/main-chat-approvals/${encodeURIComponent(entry.id)}${suffix}`;
  const edit = (entry, text) => act(entry, "edit", () =>
    request(route(entry), { text, expectedRevision: entry.revision }, "PATCH"));
  const withdraw = (entry) => act(entry, "withdraw", () =>
    request(route(entry, "/withdraw"), { expectedRevision: entry.revision }));
  const decline = (entry, note = "") => act(entry, "decline", () =>
    request(route(entry, "/decline"), { expectedRevision: entry.revision, ...(note.trim() ? { note } : {}) }));
  const approve = (entry, text = "") => act(entry, "approve", () =>
    request(route(entry, "/approve"), { expectedRevision: entry.revision, ...(text.trim() ? { text } : {}) },
      "POST", "The message could not be sent."));

  // The sender hears about decisions on their messages while the chat is open.
  let seen = null;
  watch(entries, (next) => {
    const statuses = new Map(next.map((entry) => [entry.id, entry.status]));
    if (seen) {
      for (const entry of next) {
        const before = seen.get(entry.id);
        if (!own(entry) || !["waiting", "sending"].includes(before) || before === entry.status) continue;
        const by = entry.decidedBy?.displayName || ownerName.value;
        if (entry.status === "sent") {
          feedback.report({ source: "vibe64.main-chat-approvals.decided", intent: "action-feedback", severity: "success",
            channel: "snackbar", message: `${by} approved and sent your message`, dedupeKey: `approval:${entry.id}:sent` });
        } else if (entry.status === "declined") {
          feedback.report({ source: "vibe64.main-chat-approvals.decided", intent: "action-feedback", severity: "info",
            channel: "snackbar", message: `${by} declined your message`, dedupeKey: `approval:${entry.id}:declined` });
        }
      }
    }
    if (loaded.value) seen = statuses;
  }, { immediate: true });

  // The owner hears about every new message for approval in this project.
  useRealtimeEvent({
    enabled: computed(() => enabled.value && loaded.value && isOwner.value),
    event: VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => payload.reason === "main-chat-approval-queued" && payload.projectSlug === slug.value,
    onEvent: ({ payload = {} } = {}) => feedback.report({
      source: "vibe64.main-chat-approvals.queued", intent: "action-feedback", severity: "info", channel: "snackbar",
      message: `${payload.approvalSender || "A team member"} sent a message for your approval in ${readRefOrGetterValue(projectLabel) || slug.value}`,
      dedupeKey: `approval:${payload.sessionId}:${payload.approvalId || ""}`,
      ...(typeof onReview === "function" ? { action: { label: "Review", handler: () => onReview(payload.sessionId) } } : {})
    })
  });

  // The owner's tab title counts what waits for them.
  watch([waitingCount, isOwner, loaded], ([count, owner, ready]) => {
    if (typeof document === "undefined") return;
    const title = titleWithoutCount(document.title);
    document.title = ready && owner && count > 0 ? `(${count}) ${title}` : title;
  }, { immediate: true });
  onScopeDispose(() => {
    clearInterval(clock);
    if (typeof document !== "undefined") document.title = titleWithoutCount(document.title);
  });

  return { loaded, isOwner, memberMode, lessonTeamAi, ownerName, viewerId, entries, open, waitingCount, recentDecided, earlierDecided,
    pending, sending, own, send, edit, withdraw, decline, approve, loadError: resource.loadError };
}

export { useVibe64MainChatApprovals };
