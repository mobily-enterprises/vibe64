<template>
  <section
    class="session-file-area"
    :aria-label="area === 'session' ? 'Session files, read only' : 'Drop Zone files'"
    @dragenter.prevent="dragEnter"
    @dragover.prevent="dragOver"
    @dragleave.prevent="dragLeave"
    @drop.prevent="dropFiles"
  >
    <div v-if="dragDepth > 0 && writable && !expired && !busy" class="session-file-area__drop-target" role="status">
      <v-icon :icon="mdiUpload" size="40" />
      <span>Drop files here to upload</span>
    </div>
    <div class="d-flex align-center ga-2 flex-wrap px-3 pt-2">
      <span class="text-body-small flex-grow-1">
        {{ area === 'session' ? 'Session runtime files · Read only' : 'Temporary file exchange · Deleted when this session is archived' }}
      </span>
      <v-btn v-if="archived && area === 'session'" :prepend-icon="mdiDownload" size="small" variant="text" :disabled="busy" @click="download(`${sessionId}.tar.gz`, 'archive')">Download archive</v-btn>
      <v-btn v-if="location" :prepend-icon="mdiContentCopy" size="small" variant="text" @click="copyLocation">Copy AI path</v-btn>
      <v-btn :icon="mdiRefresh" aria-label="Refresh files" title="Refresh files" variant="text" :disabled="loading || busy" @click="refresh" />
    </div>
    <div class="d-flex align-center ga-2 flex-wrap px-3">
      <v-btn v-if="file" :prepend-icon="mdiArrowLeft" variant="text" :disabled="dirty || busy" @click="file = null">Back to folder</v-btn>
      <v-breadcrumbs v-else :items="breadcrumbs" density="compact" class="pa-0 flex-grow-1">
        <template #item="{ item }">
          <v-btn size="small" variant="text" :disabled="loading || busy" @click="loadDirectory(item.path)">{{ item.title }}</v-btn>
        </template>
      </v-breadcrumbs>
      <template v-if="writable && !expired && !file">
        <input ref="uploadInput" type="file" multiple class="d-none" aria-label="Choose a file to upload" @change="upload">
        <v-btn :prepend-icon="mdiFolderPlusOutline" variant="text" :disabled="busy" @click="openDialog('mkdir')">New folder</v-btn>
        <v-btn :prepend-icon="mdiUpload" variant="tonal" :disabled="busy" @click="uploadInput.click()">{{ busy ? 'Working…' : 'Upload' }}</v-btn>
      </template>
    </div>
    <v-skeleton-loader v-if="loading" type="list-item-two-line@5" class="flex-grow-1" />
    <div v-else-if="loadError" class="pa-4">
      <v-alert type="error" variant="tonal">{{ loadError }}</v-alert>
      <v-btn class="mt-3" variant="tonal" @click="refresh">Retry</v-btn>
    </div>
    <template v-else-if="file">
      <div class="d-flex align-center ga-2 flex-wrap px-3 py-2">
        <span class="text-body-medium session-file-area__filename">{{ file.path }}</span>
        <v-spacer />
        <template v-if="dirty">
          <v-btn variant="text" :disabled="busy" @click="draft = file.text">Discard edits</v-btn>
          <v-btn color="primary" variant="tonal" :disabled="busy" @click="save">{{ busy ? 'Saving…' : 'Save' }}</v-btn>
        </template>
        <v-btn :prepend-icon="mdiDownload" variant="text" :disabled="dirty || busy" @click="download(file.path)">Download</v-btn>
      </div>
      <v-textarea v-if="writable && typeof file.text === 'string'" v-model="draft" aria-label="File contents" class="mx-3 session-file-area__text" :disabled="busy" variant="outlined" rows="18" hide-details />
      <pre v-else-if="typeof file.text === 'string'" class="session-file-area__preview" tabindex="0">{{ file.text }}</pre>
      <p v-else class="pa-4">{{ file.message }}</p>
    </template>
    <template v-else>
      <v-list v-if="entries.length" class="session-file-area__listing" aria-label="Files and folders">
        <v-list-item v-for="entry in entries" :key="entry.path" :title="entry.name" :subtitle="entry.type === 'file' ? formatSize(entry.size) : 'Folder'" :prepend-icon="entry.type === 'directory' ? mdiFolderOutline : mdiFileOutline" :disabled="busy" @click="openEntry(entry)">
          <template #append>
            <v-btn v-if="entry.type === 'file'" :icon="mdiDownload" :aria-label="`Download ${entry.name}`" variant="text" @click.stop="download(entry.path)" />
            <v-menu v-if="writable" :close-on-content-click="true">
              <template #activator="{ props: menuProps }">
                <v-btn v-bind="menuProps" :icon="mdiDotsVertical" :aria-label="`Actions for ${entry.name}`" variant="text" @click.stop />
              </template>
              <v-list>
                <v-list-item :prepend-icon="mdiPencilOutline" title="Rename" @click="openDialog('rename', entry)" />
                <v-list-item :prepend-icon="mdiDeleteOutline" title="Delete" @click="openDialog('delete', entry)" />
              </v-list>
            </v-menu>
          </template>
        </v-list-item>
      </v-list>
      <p v-else class="pa-4 text-body-medium">{{ expired ? 'This session’s Drop Zone has expired.' : writable ? 'Nothing here yet. Drop files here, use Upload, or ask the AI to put files in this session’s Drop Zone.' : 'This folder is empty.' }}</p>
      <v-btn v-if="hasMore" class="ma-3 align-self-start" variant="text" :disabled="busy" @click="loadDirectory(directory, true)">Load more</v-btn>
    </template>
    <v-dialog v-model="dialogOpen" max-width="460" :persistent="busy">
      <v-card :title="dialogOperation === 'delete' ? 'Delete from Drop Zone?' : dialogOperation === 'rename' ? 'Rename item' : 'New folder'">
        <v-card-text>
          <p v-if="dialogOperation === 'delete'">{{ dialogEntry?.name }}{{ dialogEntry?.type === 'directory' ? ' and everything inside it will be deleted.' : ' will be deleted.' }}</p>
          <v-text-field v-else v-model="dialogName" label="Name" autofocus :disabled="busy" :error-messages="nameError" @keyup.enter="confirmDialog" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="busy" @click="dialogOpen = false">Cancel</v-btn>
          <v-btn :color="dialogOperation === 'delete' ? 'error' : 'primary'" :disabled="busy" @click="confirmDialog">{{ busy ? 'Working…' : dialogOperation === 'delete' ? 'Delete' : dialogOperation === 'rename' ? 'Rename' : 'Create' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, onScopeDispose, ref, watch } from "vue";
import { mdiArrowLeft, mdiContentCopy, mdiDeleteOutline, mdiDotsVertical, mdiDownload, mdiFileOutline, mdiFolderOutline, mdiFolderPlusOutline, mdiPencilOutline, mdiRefresh, mdiUpload } from "@mdi/js";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { writeClipboardText } from "@/lib/clipboard.js";

const props = defineProps({
  area: { type: String, required: true },
  archived: { type: Boolean, default: false },
  sessionId: { type: String, required: true },
  sessionsApiPath: { type: String, required: true },
  projectSlug: { type: String, default: "" },
  active: { type: Boolean, default: true },
  agentActive: { type: Boolean, default: false }
});
const writable = computed(() => props.area === "drop-zone");
const base = computed(() => `${props.sessionsApiPath}/${encodeURIComponent(props.sessionId)}/files/${encodeURIComponent(props.area)}`);
const directory = ref("");
const entries = ref([]);
const location = ref("");
const expired = ref(false);
const hasMore = ref(false);
const nextOffset = ref(0);
const loading = ref(false);
const loadError = ref("");
const busy = ref(false);
const file = ref(null);
const draft = ref("");
const dirty = computed(() => file.value && typeof file.value.text === "string" && draft.value !== file.value.text);
const uploadInput = ref(null);
const dragDepth = ref(0);
let disposed = false;
const dialogOpen = ref(false);
const dialogOperation = ref("");
const dialogEntry = ref(null);
const dialogName = ref("");
const nameError = ref("");
const feedback = useUiFeedback({ source: "vibe64.files" });
let generation = 0;
let pendingRefresh = false;
const breadcrumbs = computed(() => [
  { title: writable.value ? "Drop Zone" : "Session", path: "" },
  ...directory.value.split("/").filter(Boolean).map((name, i, parts) => ({ title: name, path: parts.slice(0, i + 1).join("/") }))
]);
function url(operation, filePath, offset = 0) {
  return `${base.value}/${operation}?${new URLSearchParams({ path: filePath, offset })}`;
}
async function request(endpoint, options) {
  const result = await getHttpWebClient().request(endpoint, options);
  if (result?.ok === false) throw new Error(vibe64ApiResponseError(result, "File operation failed."));
  return result;
}
async function loadDirectory(target = "", append = false) {
  const current = ++generation;
  loading.value = true;
  loadError.value = "";
  file.value = null;
  try {
    const result = await request(url("tree", target, append ? nextOffset.value : 0));
    if (current !== generation) return;
    directory.value = target;
    entries.value = append ? [...entries.value, ...result.tree.children] : result.tree.children;
    hasMore.value = result.tree.hasMore;
    nextOffset.value = result.tree.nextOffset;
    location.value = result.location || "";
    expired.value = result.expired === true;
  } catch (error) {
    if (current === generation) loadError.value = error.message;
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function openEntry(entry) {
  if (entry.type === "directory") return loadDirectory(entry.path);
  const current = ++generation;
  loading.value = true;
  try {
    const result = await request(url("file", entry.path));
    if (current !== generation) return;
    file.value = result.file;
    draft.value = result.file.text;
  } catch (error) {
    if (current !== generation) return;
    // Binary and large files remain downloadable even when preview is unavailable.
    file.value = { path: entry.path, message: error.message };
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function command(run) {
  if (busy.value) return;
  busy.value = true;
  try {
    await run();
  } catch (error) {
    feedback.error(error, "File operation failed.");
  } finally {
    busy.value = false;
  }
}
function save() {
  return command(async () => {
    const result = await request(`${base.value}/file`, { method: "PUT", body: { path: file.value.path, baseHash: file.value.hash, text: draft.value } });
    file.value = result.file;
    draft.value = result.file.text;
  });
}
function dragEnter(event) {
  if (writable.value && !expired.value && !busy.value && event.dataTransfer?.types.includes("Files")) {
    dragDepth.value += 1;
  }
}
function dragOver(event) {
  if (event.dataTransfer) {
    const canUpload = writable.value && !expired.value && !busy.value && !dirty.value;
    event.dataTransfer.dropEffect = canUpload ? "copy" : "none";
  }
}
function dragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}
function dropFiles(event) {
  dragDepth.value = 0;
  if (!writable.value || expired.value || busy.value) return;
  if (dirty.value) {
    feedback.error(new Error("Save or discard your edits before uploading files."));
    return;
  }
  const items = [...(event.dataTransfer?.items || [])];
  if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
    feedback.error(new Error("Drop files individually, or upload a zip for a whole folder."));
    return;
  }
  return uploadFiles([...(event.dataTransfer?.files || [])]);
}
function upload(event) {
  const files = [...(event.target.files || [])];
  event.target.value = "";
  return uploadFiles(files);
}
function uploadFiles(files) {
  if (!files.length) return;
  const endpoint = base.value;
  const folder = directory.value;
  return command(async () => {
    for (const selected of files) {
      if (disposed) break;
      try {
        if (selected.size > 100 * 1024 * 1024) throw new Error("Choose a file no larger than 100 MiB.");
        const data = new FormData();
        data.append("file", selected);
        const target = [folder, selected.name].filter(Boolean).join("/");
        await request(`${endpoint}/upload?${new URLSearchParams({ path: target })}`, { method: "POST", body: data });
      } catch (error) {
        feedback.error(new Error(`${selected.name}: ${error.message}`), "Upload failed.");
      }
    }
    if (!disposed) await loadDirectory(folder);
  });
}
function download(target, operation = "download") {
  return command(async () => {
    const response = await fetch(scopedDevelopmentApiUrl(url(operation, target), props.projectSlug), { credentials: "include" });
    if (!response.ok || !response.headers.get("content-disposition")?.startsWith("attachment;")) {
      throw new Error(vibe64ApiResponseError(await response.json().catch(() => ({})), "Download failed."));
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = target.split("/").at(-1);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  });
}
function openDialog(operation, entry = null) {
  dialogOperation.value = operation;
  dialogEntry.value = entry;
  dialogName.value = entry?.name || "";
  nameError.value = "";
  dialogOpen.value = true;
}
function confirmDialog() {
  const operation = dialogOperation.value;
  if (operation !== "delete" && (!dialogName.value.trim() || /[/\\]/u.test(dialogName.value) || [".", ".."].includes(dialogName.value.trim()))) {
    nameError.value = "Enter a name without directory separators.";
    return;
  }
  return command(async () => {
    const suffix = operation === "mkdir" ? "directory" : operation === "delete" ? "file" : "rename";
    const destination = [directory.value, dialogName.value.trim()].filter(Boolean).join("/");
    await request(`${base.value}/${suffix}`, {
      method: operation === "delete" ? "DELETE" : "POST",
      body: {
        path: operation === "mkdir" ? destination : dialogEntry.value.path,
        destination
      }
    });
    dialogOpen.value = false;
    await loadDirectory(directory.value);
  });
}
function copyLocation() {
  return command(() => writeClipboardText(location.value));
}
function refresh() {
  if (dirty.value || busy.value) {
    pendingRefresh = true;
    return;
  }
  pendingRefresh = false;
  return file.value ? openEntry({ type: "file", path: file.value.path }) : loadDirectory(directory.value);
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
watch(base, () => {
  directory.value = "";
  void loadDirectory();
}, { immediate: true });
watch(() => props.agentActive, (working, wasWorking) => {
  if (!wasWorking || working) return;
  if (props.active) void refresh(); else pendingRefresh = true;
});
watch([() => props.active, dirty], ([active, changed]) => {
  if (active && !changed && pendingRefresh) void refresh();
});
onScopeDispose(() => {
  disposed = true;
  generation += 1;
});
</script>

<style scoped>
.session-file-area { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: auto; }
.session-file-area__drop-target { position: absolute; inset: 8px; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; border: 2px dashed rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-surface), 0.96); color: rgb(var(--v-theme-primary)); pointer-events: none; }
.session-file-area__listing { flex: 1; overflow: auto; min-height: 0; }
.session-file-area__filename { overflow-wrap: anywhere; }
.session-file-area__preview { flex: 1; min-height: 0; overflow: auto; padding: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.session-file-area__text { font-family: monospace; }
</style>
