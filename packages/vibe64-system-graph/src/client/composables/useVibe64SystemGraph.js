import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  unref,
  watch
} from "vue";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";

const SYSTEM_GRAPH_API_SUFFIX = "/vibe64/system-graph";
const SYSTEM_GRAPH_SURFACE = "app";
const UPDATE_EVENT_TYPES = Object.freeze([
  "system-update.started",
  "system-update.analysis-started",
  "system-update.source-raced",
  "system-update.writing",
  "system-update.completed",
  "system-update.failed",
  "system-update.stream-failed"
]);

function encodeSegment(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

function systemSessionPath(apiPath = "", sessionId = "", suffix = "") {
  return `${apiPath}/sessions/${encodeSegment(sessionId)}${suffix}`;
}

function systemQueryKey(sessionId = "", resource = "", key = "") {
  return ["vibe64", "system-graph", String(sessionId || ""), resource, String(key || "")];
}

function useVibe64SystemGraph({
  active = true,
  resolveRequestUrl = (value) => value,
  sessionId = ""
} = {}) {
  const paths = usePaths();
  const selectedEntityKey = ref("");
  const selectedFileKey = ref("");
  const updateEvents = ref([]);
  const updateId = ref("");
  const updateStreamError = ref("");
  let updateEventSource = null;

  const normalizedSessionId = computed(() => String(unref(sessionId) || "").trim());
  const enabled = computed(() => Boolean(unref(active) && normalizedSessionId.value));
  const apiPath = computed(() => paths.api(SYSTEM_GRAPH_API_SUFFIX, {
    surface: SYSTEM_GRAPH_SURFACE
  }));
  const sessionPath = computed(() => systemSessionPath(apiPath.value, normalizedSessionId.value));

  const statusResource = useEndpointResource({
    enabled,
    fallbackLoadError: "System status could not be loaded.",
    path: computed(() => enabled.value ? `${sessionPath.value}/status` : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "status")),
    requestRecoveryLabel: "System status"
  });
  const systemStatus = computed(() => statusResource.data.value || {});
  const modelAvailable = computed(() => Boolean(
    enabled.value &&
    systemStatus.value.documentExists === true &&
    ["current", "stale", "updating"].includes(systemStatus.value.status)
  ));

  const overviewResource = useEndpointResource({
    enabled: modelAvailable,
    fallbackLoadError: "System world could not be loaded.",
    path: computed(() => modelAvailable.value ? `${sessionPath.value}/overview` : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "overview")),
    requestRecoveryLabel: "System world"
  });
  const findingsResource = useEndpointResource({
    enabled: modelAvailable,
    fallbackLoadError: "System findings could not be loaded.",
    path: computed(() => modelAvailable.value ? `${sessionPath.value}/findings` : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "findings")),
    requestRecoveryLabel: "System findings"
  });
  const entityResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "System entity details could not be loaded.",
    path: computed(() => selectedEntityKey.value
      ? `${sessionPath.value}/entities/${encodeSegment(selectedEntityKey.value)}`
      : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "entity", selectedEntityKey.value)),
    requestRecoveryLabel: "System entity"
  });
  const evidenceResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "System evidence could not be loaded.",
    path: computed(() => selectedEntityKey.value
      ? `${sessionPath.value}/entities/${encodeSegment(selectedEntityKey.value)}/evidence`
      : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "evidence", selectedEntityKey.value)),
    requestRecoveryLabel: "System evidence"
  });
  const constellationResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "File constellation could not be loaded.",
    path: computed(() => selectedFileKey.value
      ? `${sessionPath.value}/files/${encodeSegment(selectedFileKey.value)}/constellation`
      : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "constellation", selectedFileKey.value)),
    requestRecoveryLabel: "File constellation"
  });
  const updateResource = useEndpointResource({
    enabled: false,
    fallbackSaveError: "System update could not be started.",
    path: computed(() => enabled.value ? `${sessionPath.value}/updates` : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "update")),
    requestRecoveryLabel: "Update System",
    writeMethod: "POST"
  });
  const acceptanceResource = useEndpointResource({
    enabled: false,
    fallbackSaveError: "Finding acceptance could not be saved.",
    path: "",
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "finding-acceptance")),
    requestRecoveryLabel: "Finding acceptance",
    writeMethod: "POST"
  });

  const overview = computed(() => overviewResource.data.value?.overview || null);
  const findings = computed(() => findingsResource.data.value?.findings || []);
  const selectedEntity = computed(() => entityResource.data.value?.details || null);
  const selectedEvidence = computed(() => evidenceResource.data.value?.evidence || null);
  const fileConstellation = computed(() => constellationResource.data.value?.constellation || null);
  const updating = computed(() => Boolean(
    updateResource.isSaving.value ||
    systemStatus.value.status === "updating" ||
    (updateId.value && !updateEvents.value.some((event) => (
      event.type === "system-update.completed" || event.type.endsWith("failed")
    )))
  ));
  const error = computed(() => (
    updateStreamError.value ||
    updateResource.saveError.value ||
    statusResource.loadError.value ||
    overviewResource.loadError.value ||
    findingsResource.loadError.value ||
    entityResource.loadError.value ||
    constellationResource.loadError.value ||
    ""
  ));

  function closeUpdateStream() {
    updateEventSource?.close?.();
    updateEventSource = null;
  }

  async function reloadCurrentModel() {
    await statusResource.reload();
    if (modelAvailable.value) {
      await Promise.all([
        overviewResource.reload(),
        findingsResource.reload()
      ]);
    }
  }

  function recordUpdateEvent(event) {
    let payload = {};
    try {
      payload = JSON.parse(String(event.data || "{}"));
    } catch {
      payload = {
        type: event.type || "system-update.stream-failed",
        error: {
          message: "System update returned an invalid progress event."
        }
      };
    }
    updateEvents.value = [...updateEvents.value, payload].slice(-100);
    if (payload.type === "system-update.completed") {
      closeUpdateStream();
      void reloadCurrentModel();
    } else if (payload.type?.endsWith("failed")) {
      updateStreamError.value = payload.error?.message || "System update failed.";
      closeUpdateStream();
      void statusResource.reload();
    }
  }

  function openUpdateStream(nextUpdateId) {
    closeUpdateStream();
    if (typeof EventSource !== "function") {
      updateStreamError.value = "Live update progress is unavailable in this browser.";
      return;
    }
    const streamPath = `${sessionPath.value}/updates/${encodeSegment(nextUpdateId)}/stream`;
    updateEventSource = new EventSource(resolveRequestUrl(streamPath));
    for (const eventType of UPDATE_EVENT_TYPES) {
      updateEventSource.addEventListener(eventType, recordUpdateEvent);
    }
    updateEventSource.onerror = () => {
      if (!updateEvents.value.some((event) => event.type === "system-update.completed")) {
        updateStreamError.value = "The System update progress stream disconnected.";
      }
      closeUpdateStream();
      void statusResource.reload();
    };
  }

  async function startUpdate() {
    updateEvents.value = [];
    updateStreamError.value = "";
    const response = await updateResource.save({}, {
      method: "POST"
    });
    const nextUpdateId = String(response?.update?.updateId || "");
    updateId.value = nextUpdateId;
    if (nextUpdateId) {
      openUpdateStream(nextUpdateId);
    }
    await statusResource.reload();
    return response;
  }

  async function selectEntity(entityKey = "", { includeEvidence = false } = {}) {
    selectedEntityKey.value = String(entityKey || "").trim();
    if (!selectedEntityKey.value) {
      return null;
    }
    await nextTick();
    const detailResult = await entityResource.reload();
    if (includeEvidence) {
      await evidenceResource.reload();
    }
    return detailResult?.data || entityResource.data.value || null;
  }

  async function loadEntityEvidence() {
    if (!selectedEntityKey.value) {
      return null;
    }
    const result = await evidenceResource.reload();
    return result?.data || evidenceResource.data.value || null;
  }

  async function selectFile(fileKey = "") {
    selectedFileKey.value = String(fileKey || "").trim();
    if (!selectedFileKey.value) {
      return null;
    }
    await nextTick();
    const result = await constellationResource.reload();
    return result?.data || constellationResource.data.value || null;
  }

  async function acceptFinding(findingId = "", reason = "") {
    const normalizedFindingId = String(findingId || "").trim();
    if (!normalizedFindingId) {
      return null;
    }
    const response = await acceptanceResource.save({ reason }, {
      method: "POST",
      path: `${sessionPath.value}/findings/${encodeSegment(normalizedFindingId)}/accept`
    });
    await findingsResource.reload();
    return response;
  }

  watch(normalizedSessionId, () => {
    closeUpdateStream();
    selectedEntityKey.value = "";
    selectedFileKey.value = "";
    updateEvents.value = [];
    updateId.value = "";
    updateStreamError.value = "";
  });

  onBeforeUnmount(closeUpdateStream);

  return {
    acceptFinding,
    error,
    fileConstellation,
    findings,
    loadEntityEvidence,
    loading: computed(() => statusResource.isLoading.value || overviewResource.isLoading.value),
    overview,
    reload: reloadCurrentModel,
    selectEntity,
    selectedEntity,
    selectedEntityKey,
    selectedEvidence,
    selectFile,
    selectedFileKey,
    startUpdate,
    systemStatus,
    updateEvents,
    updating
  };
}

export {
  SYSTEM_GRAPH_API_SUFFIX,
  systemSessionPath,
  useVibe64SystemGraph
};
