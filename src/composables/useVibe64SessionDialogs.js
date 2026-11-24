import { computed, reactive, ref, unref } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import { followHeldRequest } from "@/lib/vibe64HeldRequest.js";

const ARCHIVE_FAILED = "Vibe64 session could not be archived.";
const ARCHIVE_LOST_CONTACT =
  "Vibe64 could not be reached to follow this archive. Check the session list, and archive the session again if it is still there.";

/**
 * The selected session's archive confirmation and its archive request.
 * @param {{
 *   beginArchive: (sessionId: string) => unknown,
 *   finishArchive: (sessionId: string, succeeded: boolean, archiveScope: unknown) => void,
 *   isSelectedSessionArchived: import("vue").Ref<boolean>,
 *   refreshSessionData: (options: { reason: string }) => Promise<unknown>,
 *   selectedSessionId: import("vue").Ref<string>,
 *   selectedSessionTitle: import("vue").Ref<string>,
 *   sessionsApiPath: import("vue").MaybeRefOrGetter<string>
 * }} options
 */
function useVibe64SessionDialogs({
  beginArchive,
  finishArchive,
  isSelectedSessionArchived,
  refreshSessionData,
  selectedSessionId,
  selectedSessionTitle,
  sessionsApiPath
}) {
  const archiveDialogOpen = ref(false);
  const archiveDialogSessionId = ref("");
  const archiveDialogSessionTitle = ref("");
  const archivingSessionId = ref("");
  const resolvedSessionsApiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || ""));

  // The request names its archive (`requestId`), and the server answers within two seconds, as archiving while the
  // session's work stops and its source goes; the page repeats it (`repeat: true`) until its outcome, shown once.
  const archiveResource = useEndpointResource({
    path: resolvedSessionsApiPath,
    queryKey: computed(() => ["vibe64.sessions.archive", resolvedSessionsApiPath.value]),
    enabled: false
  });
  const feedback = useUiFeedback({ source: "vibe64.sessions.archive" });
  // Archive's running state, read as `archive.command.isRunning` by the archive dialog and the session toolbar.
  const archiveCommand = reactive({ isRunning: computed(() => Boolean(archivingSessionId.value)) });

  /** Sends the page's archive of the session until its outcome (`followHeldRequest`). */
  async function archiveFollowed(sessionId) {
    const request = vibe64RealtimeOriginPayload({ requestId: globalThis.crypto.randomUUID() });
    const path = vibe64SessionPath(resolvedSessionsApiPath.value, sessionId, "/archive");
    const response = await followHeldRequest(repeat => archiveResource.save(repeat ? { ...request, repeat } : request,
      { method: "POST", path }), { heldAs: "archiving", lostContact: ARCHIVE_LOST_CONTACT, notWorded: ARCHIVE_FAILED });
    if (response?.ok !== true) {
      throw new Error(response?.errors?.[0]?.message || response?.error || ARCHIVE_FAILED);
    }
    return response;
  }

  function clearArchiveDialog() {
    archiveDialogOpen.value = false;
    archiveDialogSessionId.value = "";
    archiveDialogSessionTitle.value = "";
  }

  function requestArchiveSelectedSession() {
    if (
      !unref(selectedSessionId) ||
      archivingSessionId.value ||
      archiveCommand.isRunning ||
      unref(isSelectedSessionArchived)
    ) {
      return;
    }
    archiveDialogSessionId.value = unref(selectedSessionId);
    archiveDialogSessionTitle.value = unref(selectedSessionTitle);
    archiveDialogOpen.value = true;
  }

  function cancelArchiveSession() {
    if (!archiveCommand.isRunning) {
      clearArchiveDialog();
    }
  }

  async function confirmArchiveSession() {
    if (
      !archiveDialogSessionId.value ||
      archivingSessionId.value ||
      archiveCommand.isRunning
    ) {
      return false;
    }
    const sessionId = archiveDialogSessionId.value;
    archivingSessionId.value = sessionId;
    clearArchiveDialog();
    const archiveScope = beginArchive(sessionId);
    let succeeded = false;
    try {
      const response = await archiveFollowed(sessionId);
      succeeded = true;
      feedback.success("Vibe64 session archived.");
      return response;
    } catch (error) {
      // The failure goes to shared action feedback, out of the newly selected session's runtime, and the gray tab is
      // restored.
      feedback.error(error, ARCHIVE_FAILED);
      return false;
    } finally {
      finishArchive(sessionId, succeeded, archiveScope);
      if (archivingSessionId.value === sessionId) {
        archivingSessionId.value = "";
      }
      void refreshSessionData({ reason: "archive-session" }).catch(() => null);
    }
  }

  return {
    archiving: computed(() => Boolean(archivingSessionId.value)),
    archivingSessionId,
    cancel: cancelArchiveSession,
    command: archiveCommand,
    confirm: confirmArchiveSession,
    open: archiveDialogOpen,
    request: requestArchiveSelectedSession,
    sessionId: archiveDialogSessionId,
    sessionTitle: archiveDialogSessionTitle
  };
}

export { useVibe64SessionDialogs };
