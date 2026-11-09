import { computed, ref, toValue, watch } from "vue";
import {
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_PICK_START_MESSAGE_TYPE,
  PREVIEW_RECORDING_MESSAGE_TYPE
} from "@local/vibe64-terminals/shared/launchPreviewProtocol";
import { USAGE_INTERACTION_ID_PATTERN, USAGE_RECORDING_LIMITS } from "@local/vibe64-usage-recording/shared/contract";
import {
  PREVIEW_PICK_NOT_SCANNED_TEXT,
  PREVIEW_PICK_NO_COMPONENT_TEXT,
  previewComponentSourcePath,
  previewPickColors,
  previewUsageEntryForFile
} from "@/lib/vibe64PreviewPick.js";

/**
 * What connects Click in Preview to the usage map: `readUsageEntries(query)`
 * reads usage entries, `openUsage({ entryId, mode })` opens one, and while
 * `recording` (a ref or getter) is a recording of this Preview,
 * `recordInteraction(interaction)` saves each interaction the bridge reports.
 * @typedef {object} PreviewUsage
 * @property {(request: { entryId?: string, mode: string }) => void} openUsage
 * @property {(query: { file: string, limit: number }) => Promise<{ entries?: object[] }>} readUsageEntries
 * @property {(interaction: object) => Promise<{ ok?: boolean, nextInteraction?: number }>} recordInteraction
 * @property {import("vue").MaybeRefOrGetter<object | null>} recording
 */

/**
 * Click in Preview and usage recording in the embedded Preview. A picked
 * element opens Usage at its component's entry, or explains why it cannot.
 * While this Preview is recorded, the bridge's interaction reports are saved
 * in order, and the bridge is told which interaction number comes next.
 * @param {{
 *   frame: import("@/types.js").Vibe64PreviewFrame,
 *   props: { session?: object | null },
 *   usage: PreviewUsage
 * }} options
 */
function useVibe64PreviewPick({
  frame,
  props,
  usage: {
    openUsage,
    readUsageEntries,
    recordInteraction,
    recording
  }
}) {
  const {
    postToPreviewBridge,
    previewBridgeVersion,
    previewFrame,
    previewFrameLoaded,
    previewPaneDisplayed,
    previewPicking,
    previewSuspended,
    switchPreviewPicking,
    stopPreviewPick
  } = frame;
  const previewPickBusy = ref(false);
  const previewPickNoticeText = ref("");
  const previewPickNoticeVisible = ref(false);
  // A notice about a missing scan offers Usage, where the scan is refreshed.
  const previewPickNoticeOpensUsage = ref(false);
  // The highest interaction number this recording is known to hold, from the
  // bridge's reports and the server; a page that loads later continues after it.
  // Only a higher number is forwarded, and no more than the recording takes.
  const previewInteractions = { forwarded: 0, highest: 0, recordingId: "" };
  const previewPickAvailable = computed(() => Boolean(
    previewFrameLoaded.value &&
    previewPaneDisplayed.value &&
    !previewSuspended.value &&
    previewBridgeVersion.value >= PREVIEW_BRIDGE_VERSION
  ));
  const previewRecordingId = computed(() => {
    const current = toValue(recording);
    return current?.state === "recording" && current?.target?.kind === "web" ? String(current.id || "") : "";
  });
  // What the server had recorded when this editor read the recording: after a
  // reload, or in a second tab, numbering continues from there.
  const previewRecordedInteractions = computed(() =>
    previewRecordingId.value ? Math.max(0, Number(toValue(recording)?.highestInteraction) || 0) : 0);

  function showPreviewPickNotice(text, { opensUsage = false } = {}) {
    previewPickNoticeText.value = text;
    previewPickNoticeOpensUsage.value = opensUsage;
    previewPickNoticeVisible.value = true;
  }

  function openUsageFromPickNotice() {
    previewPickNoticeVisible.value = false;
    openUsage({ mode: "calls" });
  }

  function togglePreviewPick() {
    if (previewPicking.value) {
      stopPreviewPick();
      return false;
    }
    if (!previewPickAvailable.value || previewPickBusy.value) {
      return false;
    }
    switchPreviewPicking(postToPreviewBridge({ type: PREVIEW_PICK_START_MESSAGE_TYPE, ...previewPickColors(previewFrame.value) }));
    return previewPicking.value;
  }

  // A picked component opens Usage at its entry. A pick that arrives after the
  // person cancelled is ignored.
  async function finishPreviewPick(result = {}) {
    if (!previewPicking.value) {
      return null;
    }
    switchPreviewPicking(false);
    if (result.cancelled === true) {
      return null;
    }
    const file = previewComponentSourcePath(result.componentFile, props.session?.sourcePath);
    if (!file) {
      showPreviewPickNotice(PREVIEW_PICK_NO_COMPONENT_TEXT);
      return null;
    }
    previewPickBusy.value = true;
    try {
      const answer = await readUsageEntries({ file, limit: 50 });
      const entry = previewUsageEntryForFile(answer?.entries, file);
      if (!entry) {
        showPreviewPickNotice(`${file.split("/").pop()} has no usage entry yet. Refresh the architecture scan, then pick again.`, { opensUsage: true });
        return null;
      }
      openUsage({ entryId: entry.id, mode: "calls" });
      return entry;
    } catch (error) {
      if (error?.code === "vibe64_genesis_city_missing") {
        showPreviewPickNotice(PREVIEW_PICK_NOT_SCANNED_TEXT, { opensUsage: true });
      } else {
        showPreviewPickNotice(String(error?.message || "").trim() || "Usage could not be read. Pick again.");
      }
      return null;
    } finally {
      previewPickBusy.value = false;
    }
  }

  // Tells the bridge whether this Preview is being recorded and which
  // interaction number comes next.
  function publishPreviewRecording() {
    const recordingId = previewRecordingId.value;
    if (previewInteractions.recordingId !== recordingId) {
      Object.assign(previewInteractions, { forwarded: 0, highest: 0, recordingId });
    }
    previewInteractions.highest = Math.max(previewInteractions.highest, previewRecordedInteractions.value);
    postToPreviewBridge({
      active: Boolean(recordingId),
      nextInteraction: previewInteractions.highest + 1,
      recordingId: recordingId || null,
      type: PREVIEW_RECORDING_MESSAGE_TYPE
    });
  }

  async function forwardPreviewInteraction(data = {}) {
    const id = String(data.id || "");
    const recordingId = previewRecordingId.value;
    if (
      !recordingId ||
      recordingId !== previewInteractions.recordingId ||
      !USAGE_INTERACTION_ID_PATTERN.test(id) ||
      Number(id.slice(2)) <= previewInteractions.highest ||
      previewInteractions.forwarded >= USAGE_RECORDING_LIMITS.interactions
    ) {
      return;
    }
    previewInteractions.highest = Number(id.slice(2));
    previewInteractions.forwarded += 1;
    const at = Date.parse(String(data.at || ""));
    const result = await recordInteraction({
      at: new Date(Number.isFinite(at) ? at : Date.now()).toISOString(),
      componentFile: previewComponentSourcePath(data.componentFile, props.session?.sourcePath) || null,
      id,
      kind: ["enter", "submit"].includes(data.kind) ? data.kind : "click",
      label: String(data.elementLabel || "").trim().slice(0, 80) || "element"
    });
    // Another page of this recording already used the number: the bridge
    // continues from the next free one the server named.
    const next = Number(result?.nextInteraction);
    if (result?.ok === false && Number.isSafeInteger(next) && previewInteractions.recordingId === recordingId) {
      previewInteractions.highest = Math.max(previewInteractions.highest, next - 1);
      publishPreviewRecording();
    }
  }

  watch([previewRecordingId, previewRecordedInteractions], publishPreviewRecording);

  watch(previewPickAvailable, (available) => {
    if (!available) {
      stopPreviewPick();
    }
  }, { flush: "sync" });

  return {
    finishPreviewPick,
    forwardPreviewInteraction,
    openUsageFromPickNotice,
    previewPickAvailable,
    previewPickBusy,
    previewPickNoticeOpensUsage,
    previewPickNoticeText,
    previewPickNoticeVisible,
    publishPreviewRecording,
    togglePreviewPick
  };
}

export {
  useVibe64PreviewPick
};
