import { computed, ref, toRaw, toValue } from "vue";
import { useAssistantAttachments } from "@jskit-ai/assistant-core/client/conversation-attachments";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { VIBE64_UPLOAD_MAX_BYTES, VIBE64_UPLOAD_MAX_LABEL } from "@local/vibe64-core/shared";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { uploadFileRequest } from "@/lib/vibe64FileUpload.js";

const FILE_UPLOAD_MAX_ITEMS = 200;
const ACTIVE_PHASES = ["preparing", "queued", "uploading", "delivering"];

// Files uploads reuse the chat attachment queue (progress, cancel, retry, one
// upload at a time) with the shared upload transport. Each file goes straight
// into the folder that was open when it was added; a finished upload is simply
// there, with no further step. `endpoint` is the area's API base; `onAsk`
// runs just before the name-conflict question opens.
function useVibe64FileUploads({ endpoint, onUploaded = () => {}, onAsk = () => {} } = {}) {
  // Where each queued File goes: its folder path and conflict choice.
  const targets = new WeakMap();
  const queue = useAssistantAttachments({
    // A stable key: if the area changes, its pending uploads are abandoned.
    sessionId: computed(() => String(toValue(endpoint) || "")),
    maxItems: FILE_UPLOAD_MAX_ITEMS,
    uploadConcurrency: 1,
    // Size is checked below so the failure uses Files' own wording.
    maxBytes: Number.MAX_SAFE_INTEGER,
    async onUploaded(uploaded = []) {
      for (const receipt of uploaded) onUploaded(receipt);
      return { accepted: false };
    },
    async uploadAttachment(_key, file, { onProgress, signal } = {}) {
      const target = targets.get(toRaw(file));
      if (!target) throw new Error("Choose the file again.");
      if (file.size > VIBE64_UPLOAD_MAX_BYTES) throw new Error(`Larger than the ${VIBE64_UPLOAD_MAX_LABEL} upload limit.`);
      const query = new URLSearchParams({ path: target.path, ...(target.conflict ? { conflict: target.conflict } : {}) });
      const result = await uploadFileRequest({ file, onProgress, signal, path: `${target.endpoint}/upload?${query}` });
      if (result?.ok === false) throw new Error(vibe64ApiResponseError(result, "File could not be uploaded."));
      return { ...result, attachmentId: result.path, fileName: file.name };
    }
  });
  const items = queue.queueItems;
  const active = computed(() => items.value.some((item) => ACTIVE_PHASES.includes(item.phase)));

  function clearFinished() {
    for (const item of [...items.value]) {
      if (["ready", "cancelled"].includes(item.phase)) queue.removeAttachment(item);
    }
  }

  // `conflicts` names the files that exist already; `conflict` is the one
  // choice (replace or keep-both) for all of them. Skipped files are not passed.
  function uploadFiles(files = [], { folder = "", conflicts = [], conflict = "" } = {}) {
    if (!items.value.some((item) => item.phase === "failed" || ACTIVE_PHASES.includes(item.phase))) clearFinished();
    for (const file of files) {
      targets.set(toRaw(file), {
        endpoint: String(toValue(endpoint) || ""),
        path: [folder, file.name].filter(Boolean).join("/"),
        conflict: conflicts.includes(file.name) ? conflict : ""
      });
    }
    return queue.uploadFiles(files);
  }

  // Names already in the folder are asked about once for the whole batch:
  // `conflicts` holds the open question until resolveConflict answers it.
  const conflicts = ref({ names: [], files: [], folder: "" });

  async function start(files = [], folder = "") {
    if (!files.length) return;
    if (files.length > FILE_UPLOAD_MAX_ITEMS) throw new Error(`Upload up to ${FILE_UPLOAD_MAX_ITEMS} files at a time.`);
    const result = await getHttpWebClient().request(`${toValue(endpoint)}/conflicts`, {
      method: "POST", body: { path: folder, names: [...new Set(files.map((file) => file.name))] }
    });
    if (result?.ok === false) throw new Error(vibe64ApiResponseError(result, "Upload failed."));
    if (result.existing?.length) {
      onAsk();
      conflicts.value = { names: result.existing, files, folder };
      return;
    }
    void uploadFiles(files, { folder });
  }

  // "replace", "keep-both", "skip", or "" when the person cancelled.
  function resolveConflict(choice = "") {
    const { names, files, folder } = conflicts.value;
    conflicts.value = { names: [], files: [], folder: "" };
    if (!choice) return;
    const chosen = choice === "skip" ? files.filter((file) => !names.includes(file.name)) : files;
    if (chosen.length) void uploadFiles(chosen, { folder, conflicts: names, conflict: choice === "skip" ? "" : choice });
  }

  function cancelAll() {
    for (const item of [...items.value]) {
      if (ACTIVE_PHASES.includes(item.phase)) queue.cancelAttachment(item);
    }
  }

  function clear() {
    for (const item of [...items.value]) {
      if (!ACTIVE_PHASES.includes(item.phase)) queue.removeAttachment(item);
    }
  }

  return {
    active,
    cancel: queue.cancelAttachment,
    cancelAll,
    clear,
    conflicts,
    items,
    remove: queue.removeAttachment,
    resolveConflict,
    retry: queue.retryAttachment,
    start,
    uploadFiles
  };
}

export { useVibe64FileUploads };
