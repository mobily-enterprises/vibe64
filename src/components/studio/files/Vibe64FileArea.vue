<template>
  <section
    ref="root"
    class="vibe64-file-area v64-focus-rings"
    :class="{ 'vibe64-file-area--mobile': mobile }"
    :aria-label="readOnly ? `${areaInfo.label} files, read only` : areaInfo.label"
    @dragenter.prevent="dragEnter"
    @dragover.prevent="dragOver"
    @dragleave.prevent="dragLeave"
    @drop.prevent="dropFiles"
    @keydown="previewKey"
  >
    <div v-if="dragDepth > 0 && canWrite" class="vibe64-file-area__drop-target" role="status">
      <v-icon :icon="mdiTrayArrowDown" size="40" aria-hidden="true" />
      <span>Drop to upload to {{ folderLabel }}</span>
    </div>

    <!-- An open file replaces the folder toolbar with its own bar. -->
    <!-- The tab names the area, so the path shows only inside a folder. -->
    <div v-if="!file" class="vibe64-file-area__toolbar">
      <nav v-if="directory" class="vibe64-file-area__crumbs" aria-label="Folder">
        <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
          <v-icon v-if="index" :icon="mdiChevronRight" size="18" aria-hidden="true" />
          <span v-if="index === breadcrumbs.length - 1" class="vibe64-file-area__crumb-current" aria-current="location">{{ crumb.title }}</span>
          <v-btn v-else :disabled="loading || busy" variant="text" @click="loadDirectory(crumb.path, false, { focus: true })">{{ crumb.title }}</v-btn>
        </template>
      </nav>
      <div v-if="!mobile" class="vibe64-file-area__actions">
        <v-btn v-if="archived && area === 'session'" :prepend-icon="mdiDownload" variant="text" :loading="downloading.includes(archiveName)" @click="download(archiveName, 'archive')">Download archive</v-btn>
        <v-btn v-if="location" :prepend-icon="mdiContentCopy" variant="text" @click="copyLocation">Copy AI path</v-btn>
        <v-btn :icon="mdiRefresh" aria-label="Refresh files" title="Refresh files" variant="text" :disabled="loading || busy" @click="refresh" />
        <template v-if="canWrite">
          <v-btn :prepend-icon="mdiFolderPlusOutline" variant="text" :disabled="busy" @click="openDialog('mkdir')">New folder</v-btn>
          <v-btn :prepend-icon="mdiFilePlusOutline" variant="text" :disabled="busy" @click="openNewFile">New file</v-btn>
          <v-btn :prepend-icon="mdiUpload" color="primary" variant="flat" @click="chooseFiles">Upload</v-btn>
        </template>
      </div>
      <div v-else class="vibe64-file-area__actions">
        <v-btn v-if="canWrite" :icon="mdiUpload" aria-label="Upload files" color="primary" variant="tonal" @click="chooseFiles" />
        <v-menu>
          <template #activator="{ props: menuProps }">
            <v-btn v-bind="menuProps" :icon="mdiDotsVertical" aria-label="More folder actions" variant="text" />
          </template>
          <v-list class="v64-focus-rings">
            <v-list-item v-if="canWrite" :prepend-icon="mdiFilePlusOutline" title="New file" :disabled="busy" @click="openNewFile" />
            <v-list-item v-if="canWrite" :prepend-icon="mdiFolderPlusOutline" title="New folder" :disabled="busy" @click="openDialog('mkdir')" />
            <v-list-item v-if="location" :prepend-icon="mdiContentCopy" title="Copy AI path" @click="copyLocation" />
            <v-list-item v-if="archived && area === 'session'" :prepend-icon="mdiDownload" title="Download archive" :disabled="downloading.includes(archiveName)" @click="download(archiveName, 'archive')" />
            <v-list-item :prepend-icon="mdiRefresh" title="Refresh" :disabled="loading || busy" @click="refresh" />
          </v-list>
        </v-menu>
      </div>
    </div>
    <input ref="uploadInput" type="file" multiple class="d-none" aria-label="Choose files to upload" @change="pickFiles">
    <p v-if="!file && areaInfo.description" class="vibe64-file-area__description">{{ areaInfo.description }}</p>

    <v-skeleton-loader v-if="loading" type="list-item-two-line@5" class="vibe64-file-area__body" />
    <div v-else-if="loadError" class="vibe64-file-area__body pa-4">
      <v-alert type="error" variant="tonal">{{ loadError }}</v-alert>
      <v-btn class="mt-3" variant="tonal" @click="refresh">Try again</v-btn>
    </div>

    <template v-else-if="file">
      <div class="vibe64-file-area__file-bar">
        <!-- A disabled button shows no tooltip, so its wrapper explains why. -->
        <span :title="dirty ? 'Save or discard your changes first' : 'Back to folder'">
          <v-btn :icon="mdiArrowLeft" aria-label="Back to folder" variant="text" :disabled="dirty || busy" @click="closeFile" />
        </span>
        <div class="vibe64-file-area__file-heading">
          <h3 ref="fileHeading" class="vibe64-file-area__file-name" :title="file.path" tabindex="-1">{{ fileName }}</h3>
          <p class="vibe64-file-area__file-folder">{{ folderLabel }}</p>
        </div>
        <div class="vibe64-file-area__file-actions">
          <template v-if="dirty">
            <v-btn variant="text" :disabled="busy" @click="draft = file.text">Discard</v-btn>
            <v-btn color="primary" variant="flat" :loading="busy" @click="save">Save</v-btn>
          </template>
          <template v-else>
            <template v-if="imageSiblings.length > 1">
              <v-btn :icon="mdiChevronLeft" aria-label="Previous image" title="Previous image (←)" variant="text" @click="stepImage(-1)" />
              <v-btn :icon="mdiChevronRight" aria-label="Next image" title="Next image (→)" variant="text" @click="stepImage(1)" />
            </template>
            <v-btn v-bind="barAction(mdiDownload, 'Download')" aria-label="Download file" :loading="downloading.includes(file.path)" @click="download(file.path)" />
            <v-btn v-if="destinations.length" v-bind="barAction(mdiFileMoveOutline, readOnly ? 'Copy to…' : 'Move or copy…')" :disabled="busy" @click="openTransfer(fileEntry)" />
            <v-btn v-if="canWrite" :icon="mdiDeleteOutline" aria-label="Delete file" title="Delete" variant="text" :disabled="busy" @click="openDialog('delete', fileEntry)" />
          </template>
        </div>
      </div>
      <Vibe64ImagePreview v-if="file.image" :key="file.src" class="vibe64-file-area__body" :name="fileName" :size="file.size" :src="file.src" />
      <v-textarea
        v-else-if="canWrite && typeof file.text === 'string'"
        v-model="draft"
        :aria-label="`Contents of ${fileName}`"
        class="vibe64-file-area__text"
        hide-details
        :readonly="busy"
        rows="18"
        variant="outlined"
        @keydown.ctrl.s.prevent="saveShortcut"
        @keydown.meta.s.prevent="saveShortcut"
      />
      <pre v-else-if="typeof file.text === 'string'" class="vibe64-file-area__preview" tabindex="0" :aria-label="`Contents of ${fileName}`">{{ file.text }}</pre>
      <div v-else class="vibe64-file-area__empty">
        <v-icon :icon="mdiFileOutline" size="40" aria-hidden="true" />
        <p>{{ file.message }}</p>
        <v-btn :prepend-icon="mdiDownload" variant="tonal" :loading="downloading.includes(file.path)" @click="download(file.path)">Download</v-btn>
      </div>
    </template>

    <template v-else>
      <v-list v-if="entries.length" class="vibe64-file-area__body vibe64-file-area__listing" aria-label="Files and folders">
        <v-list-item
          v-for="entry in entries"
          :key="entry.path"
          :disabled="busy"
          :prepend-icon="entryIcon(entry)"
          :data-path="entry.path"
          :subtitle="entrySubtitle(entry)"
          tabindex="0"
          :title="entry.name"
          @click="openEntry(entry)"
        >
          <template #append>
            <v-btn
              v-if="entry.type === 'file' && !mobile"
              :icon="mdiDownload"
              :aria-label="`Download ${entry.name}`"
              :loading="downloading.includes(entry.path)"
              title="Download"
              variant="text"
              @click.stop="download(entry.path)"
            />
            <v-menu v-if="canWrite || destinations.length || mobile">
              <template #activator="{ props: menuProps }">
                <v-btn v-bind="menuProps" :icon="mdiDotsVertical" :aria-label="`Actions for ${entry.name}`" variant="text" @click.stop />
              </template>
              <v-list class="v64-focus-rings">
                <v-list-item v-if="entry.type === 'file' && mobile" :prepend-icon="mdiDownload" title="Download" @click="download(entry.path)" />
                <v-list-item v-if="destinations.length" :prepend-icon="mdiFileMoveOutline" :title="readOnly ? 'Copy to…' : 'Move or copy…'" @click="openTransfer(entry)" />
                <v-list-item v-if="canWrite" :prepend-icon="mdiPencilOutline" title="Rename" @click="openDialog('rename', entry)" />
                <v-list-item v-if="canWrite" :prepend-icon="mdiDeleteOutline" title="Delete" @click="openDialog('delete', entry)" />
              </v-list>
            </v-menu>
          </template>
        </v-list-item>
        <v-btn v-if="hasMore" class="ma-3" variant="text" :disabled="busy" @click="loadDirectory(directory, true)">Show more</v-btn>
      </v-list>
      <div v-else class="vibe64-file-area__body vibe64-file-area__empty">
        <v-icon :icon="areaInfo.icon" size="48" aria-hidden="true" />
        <h3 tabindex="-1">{{ expired ? "This Session Dropzone has expired" : directory ? "This folder is empty" : `${areaInfo.label} is empty` }}</h3>
        <p v-if="canWrite">Drop files here, upload them, or create a text file.<template v-if="location"> The AI can use this folder too.</template></p>
        <div v-if="canWrite" class="vibe64-file-area__empty-actions">
          <v-btn :prepend-icon="mdiUpload" color="primary" variant="flat" @click="chooseFiles">Upload</v-btn>
          <v-btn :prepend-icon="mdiFilePlusOutline" variant="tonal" @click="openNewFile">New file</v-btn>
        </div>
      </div>
    </template>

    <Vibe64FileUploadQueue
      :active="uploads.active.value"
      :items="uploads.items.value"
      @cancel="uploads.cancel"
      @cancel-all="uploads.cancelAll"
      @clear="uploads.clear"
      @remove="uploads.remove"
      @retry="uploads.retry"
    />

    <v-dialog
      v-model="dialogOpen"
      :aria-labelledby="dialogTitleId"
      :content-class="mobile ? 'vibe64-file-area__dialog--top' : undefined"
      max-width="460"
      :persistent="busy"
      @after-leave="restoreFocus"
    >
      <v-card class="vibe64-file-area__dialog v64-focus-rings">
        <v-card-item>
          <v-card-title :id="dialogTitleId" class="vibe64-file-area__dialog-title">{{ dialogTitle }}</v-card-title>
        </v-card-item>
        <v-card-text>
          <p v-if="dialogOperation === 'delete'" class="vibe64-file-area__dialog-text">
            {{ dialogEntry?.type === 'directory' ? `It and everything inside it will be deleted from ${areaInfo.label}.` : `It will be deleted from ${areaInfo.label}.` }}
            This can’t be undone.
          </p>
          <v-text-field
            v-else
            v-model="dialogName"
            autofocus
            :error-messages="nameError"
            label="Name"
            :readonly="busy"
            variant="outlined"
            @keydown.enter.prevent="confirmDialog"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="busy" @click="dialogOpen = false">Cancel</v-btn>
          <v-btn :color="dialogOperation === 'delete' ? 'error' : 'primary'" variant="flat" :loading="busy" @click="confirmDialog">
            {{ dialogOperation === 'delete' ? 'Delete' : dialogOperation === 'rename' ? 'Rename' : 'Create' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="newFileOpen"
      :aria-labelledby="newFileTitleId"
      :fullscreen="mobile"
      max-width="640"
      :persistent="busy || Boolean(newFileText)"
      scrollable
      @after-leave="restoreFocus"
    >
      <v-card class="vibe64-file-area__new-file v64-focus-rings">
        <!-- A full-screen dialog on a phone keeps Create at the top, clear of the keyboard. -->
        <v-toolbar v-if="mobile" color="surface">
          <v-btn :icon="mdiClose" aria-label="Close" :disabled="busy" @click="newFileOpen = false" />
          <v-toolbar-title :id="newFileTitleId" class="vibe64-file-area__bar-title">New text file</v-toolbar-title>
          <v-btn class="vibe64-file-area__bar-action me-2" color="primary" variant="text" :loading="busy" @click="createFile">Create</v-btn>
        </v-toolbar>
        <v-card-item>
          <v-card-title v-if="!mobile" :id="newFileTitleId" class="vibe64-file-area__dialog-title">New text file</v-card-title>
          <v-card-subtitle>In {{ folderLabel }}</v-card-subtitle>
        </v-card-item>
        <v-card-text class="vibe64-file-area__new-file-body">
          <v-text-field
            v-model="newFileName"
            autofocus
            :error-messages="nameError"
            label="File name"
            placeholder="notes.md"
            :readonly="busy"
            variant="outlined"
            @keydown.enter.prevent="createFile"
          />
          <v-textarea v-model="newFileText" class="vibe64-file-area__text" label="Contents" :readonly="busy" rows="12" variant="outlined" />
        </v-card-text>
        <v-card-actions v-if="!mobile">
          <v-spacer />
          <v-btn variant="text" :disabled="busy" @click="newFileOpen = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :loading="busy" @click="createFile">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <Vibe64FileConflictDialog :folder-label="folderLabel" :names="uploadConflicts.names" @choose="resolveUploadConflict" @closed="restoreFocus" />
    <Vibe64FileTransferDialog
      :destinations="destinations"
      :item="transferItem"
      :read-only="readOnly"
      :source-area="area"
      :source-base="base"
      :source-label="areaInfo.label"
      @close="transferItem = null"
      @closed="restoreFocus"
      @done="transferred"
    />
  </section>
</template>

<script setup>
import { computed, nextTick, onScopeDispose, ref, useId, watch } from "vue";
import { useDisplay } from "vuetify";
import {
  mdiArrowLeft,
  mdiChevronLeft,
  mdiChevronRight,
  mdiClose,
  mdiContentCopy,
  mdiDeleteOutline,
  mdiDotsVertical,
  mdiDownload,
  mdiFileImageOutline,
  mdiFileMoveOutline,
  mdiFileOutline,
  mdiFilePlusOutline,
  mdiFolderOutline,
  mdiFolderPlusOutline,
  mdiPencilOutline,
  mdiRefresh,
  mdiTrayArrowDown,
  mdiUpload
} from "@mdi/js";
import { filePreviewImageType } from "@local/vibe64-source-editor/shared/fileTypes";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { useVibe64FileUploads } from "@/composables/useVibe64FileUploads.js";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { downloadAttachment } from "@/lib/vibe64AttachmentDownload.js";
import { writeClipboardText } from "@/lib/clipboard.js";
import { vibe64FileArea, vibe64FileTransferMessage } from "@/lib/vibe64FileAreas.js";
import { formatFileSize } from "@/lib/vibe64FileSize.js";
import Vibe64FileConflictDialog from "./Vibe64FileConflictDialog.vue";
import Vibe64FileTransferDialog from "./Vibe64FileTransferDialog.vue";
import Vibe64FileUploadQueue from "./Vibe64FileUploadQueue.vue";
import Vibe64ImagePreview from "./Vibe64ImagePreview.vue";

// One Files area other than Repo (a Dropzone, Project Backups or the
// read-only Session files): browse, upload, create and edit text files,
// preview images, and move or copy items to the `destinations`.
const props = defineProps({
  active: { type: Boolean, default: true },
  agentActive: { type: Boolean, default: false },
  archived: { type: Boolean, default: false },
  area: { type: String, required: true },
  // The area's API address, such as `<sessions>/<id>/files/drop-zone`.
  base: { type: String, required: true },
  destinations: { type: Array, default: () => [] },
  projectSlug: { type: String, default: "" },
  refreshKey: { type: Number, default: 0 },
  sessionId: { type: String, default: "" }
});
const emit = defineEmits(["transferred"]);
const { smAndDown: mobile } = useDisplay();
const feedback = useUiFeedback({ source: "vibe64.files" });
const areaInfo = computed(() => vibe64FileArea(props.area));
const readOnly = computed(() => areaInfo.value.readOnly === true);
const root = ref(null);
const fileHeading = ref(null);
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
const dirty = computed(() => typeof file.value?.text === "string" && draft.value !== file.value.text);
const canWrite = computed(() => !readOnly.value && !expired.value);
const fileName = computed(() => file.value?.path.split("/").at(-1) || "");
const fileEntry = computed(() => file.value && { name: fileName.value, path: file.value.path, type: "file" });
const uploadInput = ref(null);
const dragDepth = ref(0);
const dialogOpen = ref(false);
const dialogOperation = ref("");
const dialogEntry = ref(null);
const dialogName = ref("");
const nameError = ref("");
const newFileOpen = ref(false);
const newFileName = ref("");
const newFileText = ref("");
const transferItem = ref(null);
const uploadConflicts = ref({ names: [], files: [], folder: "" });
// Downloads run beside other work; each shows progress on its own button.
const downloading = ref([]);
const archiveName = computed(() => `${props.sessionId}.tar.gz`);
const dialogTitleId = `vibe64-file-dialog-${useId()}`;
const newFileTitleId = `vibe64-new-file-dialog-${useId()}`;
let generation = 0;
let pendingRefresh = false;
// Where focus goes back to when a dialog closes: the control that opened it,
// or the row it was about when that control lived in a closed menu.
let returnFocus = null;
let uploadRefreshTimer = null;

const uploads = useVibe64FileUploads({
  endpoint: computed(() => props.base),
  onUploaded: () => {
    // A burst of small uploads refreshes the listing once.
    clearTimeout(uploadRefreshTimer);
    uploadRefreshTimer = setTimeout(() => {
      if (file.value) pendingRefresh = true;
      else void loadDirectory(directory.value, false, { quiet: true });
    }, 250);
  }
});

const breadcrumbs = computed(() => [
  { title: areaInfo.value.label, path: "" },
  ...directory.value.split("/").filter(Boolean).map((name, index, parts) => ({ title: name, path: parts.slice(0, index + 1).join("/") }))
]);
const folderLabel = computed(() => breadcrumbs.value.map((crumb) => crumb.title).join(" › "));
const dialogTitle = computed(() => ({
  delete: `Delete “${dialogEntry.value?.name}”?`, rename: `Rename “${dialogEntry.value?.name}”`, mkdir: "New folder"
})[dialogOperation.value] || "");
const imageSiblings = computed(() => file.value?.image ? entries.value.filter((entry) => entry.type === "file" && filePreviewImageType(entry.name)) : []);

function url(operation, filePath, query = {}) {
  return `${props.base}/${operation}?${new URLSearchParams({ path: filePath, ...query })}`;
}

async function request(endpoint, options) {
  const result = await getHttpWebClient().request(endpoint, options);
  if (result?.ok === false) throw new Error(vibe64ApiResponseError(result, "File operation failed."));
  return result;
}

function rowElement(path) {
  return path ? root.value?.querySelector(`[data-path="${path.replace(/["\\]/gu, "\\$&")}"]`) : null;
}

// After moving to another folder, focus its first item, or its empty state.
function focusFolder() {
  root.value?.querySelector("[data-path], .vibe64-file-area__empty h3")?.focus();
}

function rememberFocus(path = "") {
  const active = globalThis.document?.activeElement;
  returnFocus = active && !active.closest?.(".v-overlay") ? active : path;
}

async function restoreFocus() {
  const target = returnFocus;
  returnFocus = null;
  await nextTick();
  const element = typeof target === "string" ? rowElement(target) : target;
  if (element?.isConnected) element.focus();
  else if (target !== null) focusFolder();
}

// A quiet reload refreshes the listing without leaving an open file.
async function loadDirectory(target = "", append = false, { quiet = false, focus = false } = {}) {
  const current = ++generation;
  if (!quiet) loading.value = true;
  loadError.value = "";
  try {
    const result = await request(url("tree", target, { offset: append ? nextOffset.value : 0 }));
    if (current !== generation) return;
    if (!quiet) file.value = null;
    directory.value = target;
    entries.value = append ? [...entries.value, ...result.tree.children] : result.tree.children;
    hasMore.value = result.tree.hasMore === true;
    nextOffset.value = result.tree.nextOffset;
    location.value = result.location || "";
    expired.value = result.expired === true;
    if (focus) {
      loading.value = false;
      await nextTick();
      focusFolder();
    }
  } catch (error) {
    if (current === generation) loadError.value = error.message;
  } finally {
    if (current === generation) loading.value = false;
  }
}

// Opening moves focus into the item; a refresh of the open file does not.
async function openEntry(entry, { focus = true } = {}) {
  if (entry.type === "directory") return loadDirectory(entry.path, false, { focus: true });
  if (filePreviewImageType(entry.name)) {
    generation += 1;
    loading.value = false;
    file.value = {
      image: true, path: entry.path, size: entry.size,
      src: scopedDevelopmentApiUrl(url("download", entry.path, { inline: "1" }), props.projectSlug)
    };
    await nextTick();
    root.value?.querySelector(".vibe64-image-preview__stage")?.focus();
    return;
  }
  const current = ++generation;
  loading.value = true;
  try {
    const result = await request(url("file", entry.path));
    if (current !== generation) return;
    file.value = result.file;
    draft.value = result.file.text;
  } catch (error) {
    if (current !== generation) return;
    // Binary and large files remain downloadable when they cannot be shown.
    file.value = { path: entry.path, message: error.message };
  } finally {
    if (current === generation) loading.value = false;
  }
  if (focus && current === generation) {
    await nextTick();
    fileHeading.value?.focus();
  }
}

// Back to the folder, with focus on the file that was open.
async function closeFile() {
  const path = file.value?.path || "";
  file.value = null;
  if (pendingRefresh) await refresh();
  await nextTick();
  rowElement(path)?.focus();
}

function stepImage(step) {
  const images = imageSiblings.value;
  const index = images.findIndex((entry) => entry.path === file.value.path);
  if (images.length > 1) void openEntry(images[(index + step + images.length) % images.length]);
}

// Esc returns to the folder and the arrow keys walk its images.
function previewKey(event) {
  if (!file.value?.image || event.defaultPrevented || event.target.closest?.("input, textarea, [role='dialog'], .v-overlay")) return;
  // At actual size the arrow keys scroll the image instead.
  if (event.key !== "Escape" && event.target.closest?.(".vibe64-image-preview__stage--actual")) return;
  if (event.key === "Escape") void closeFile();
  else if (event.key === "ArrowLeft") stepImage(-1);
  else if (event.key === "ArrowRight") stepImage(1);
  else return;
  event.preventDefault();
}

async function command(run, fallback = "File operation failed.") {
  if (busy.value) return;
  busy.value = true;
  try {
    await run();
  } catch (error) {
    feedback.error(error, fallback);
  } finally {
    busy.value = false;
  }
}

function save() {
  return command(async () => {
    const result = await request(`${props.base}/file`, { method: "PUT", body: { path: file.value.path, baseHash: file.value.hash, text: draft.value } });
    file.value = result.file;
    draft.value = result.file.text;
  });
}

function saveShortcut() {
  if (dirty.value && !busy.value) void save();
}

function validName(name) {
  const trimmed = name.trim();
  return Boolean(trimmed) && !/[/\\]/u.test(trimmed) && ![".", ".."].includes(trimmed);
}

function openNewFile() {
  rememberFocus();
  newFileName.value = "";
  newFileText.value = "";
  nameError.value = "";
  newFileOpen.value = true;
}

function createFile() {
  if (!validName(newFileName.value)) {
    nameError.value = "Enter a file name without slashes.";
    return;
  }
  nameError.value = "";
  return command(async () => {
    const result = await request(`${props.base}/file`, {
      method: "POST", body: { path: [directory.value, newFileName.value.trim()].filter(Boolean).join("/"), text: newFileText.value }
    });
    newFileOpen.value = false;
    await loadDirectory(directory.value, false, { quiet: true });
    file.value = result.file;
    draft.value = result.file.text;
    returnFocus = null;
    await nextTick();
    fileHeading.value?.focus();
  }, "The file could not be created.");
}

function dragEnter(event) {
  if (canWrite.value && event.dataTransfer?.types.includes("Files")) dragDepth.value += 1;
}

function dragOver(event) {
  if (event.dataTransfer) event.dataTransfer.dropEffect = canWrite.value ? "copy" : "none";
}

function dragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}

function dropFiles(event) {
  dragDepth.value = 0;
  if (!canWrite.value) return;
  const items = [...(event.dataTransfer?.items || [])];
  if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
    feedback.error(new Error("Drop files rather than folders, or upload a zip of the folder."));
    return;
  }
  return startUploads([...(event.dataTransfer?.files || [])]);
}

function chooseFiles() {
  uploadInput.value?.click();
}

function pickFiles(event) {
  const files = [...(event.target.files || [])];
  event.target.value = "";
  return startUploads(files);
}

// Names already in the folder are asked about once for the whole batch.
async function startUploads(files) {
  if (!files.length) return;
  if (files.length > 200) {
    feedback.error(new Error("Upload up to 200 files at a time."));
    return;
  }
  const folder = directory.value;
  try {
    const result = await request(`${props.base}/conflicts`, {
      method: "POST", body: { path: folder, names: [...new Set(files.map((selected) => selected.name))] }
    });
    if (result.existing?.length) {
      rememberFocus();
      uploadConflicts.value = { names: result.existing, files, folder };
      return;
    }
  } catch (error) {
    feedback.error(error, "Upload failed.");
    return;
  }
  void uploads.uploadFiles(files, { folder });
}

function resolveUploadConflict(choice) {
  const { names, files, folder } = uploadConflicts.value;
  uploadConflicts.value = { names: [], files: [], folder: "" };
  if (!choice) return;
  const chosen = choice === "skip" ? files.filter((selected) => !names.includes(selected.name)) : files;
  if (chosen.length) void uploads.uploadFiles(chosen, { folder, conflicts: names, conflict: choice === "skip" ? "" : choice });
}

async function download(target, operation = "download") {
  if (downloading.value.includes(target)) return;
  downloading.value = [...downloading.value, target];
  try {
    await downloadAttachment(scopedDevelopmentApiUrl(url(operation, target), props.projectSlug), target.split("/").at(-1), "Download failed.");
  } catch (error) {
    feedback.error(error, "Download failed.");
  } finally {
    downloading.value = downloading.value.filter((candidate) => candidate !== target);
  }
}

function openDialog(operation, entry = null) {
  rememberFocus(entry?.path);
  dialogOperation.value = operation;
  dialogEntry.value = entry;
  dialogName.value = entry?.name || "";
  nameError.value = "";
  dialogOpen.value = true;
}

function confirmDialog() {
  const operation = dialogOperation.value;
  if (operation !== "delete" && !validName(dialogName.value)) {
    nameError.value = "Enter a name without slashes.";
    return;
  }
  return command(async () => {
    const suffix = operation === "mkdir" ? "directory" : operation === "delete" ? "file" : "rename";
    const parent = operation === "mkdir" ? directory.value : dialogEntry.value.path.split("/").slice(0, -1).join("/");
    const destination = [parent, dialogName.value.trim()].filter(Boolean).join("/");
    await request(`${props.base}/${suffix}`, {
      method: operation === "delete" ? "DELETE" : "POST",
      body: {
        path: operation === "mkdir" ? destination : dialogEntry.value.path,
        ...(operation === "rename" ? { destination } : {})
      }
    });
    dialogOpen.value = false;
    if (file.value && dialogEntry.value?.path === file.value.path) file.value = null;
    await loadDirectory(directory.value);
  });
}

function openTransfer(entry) {
  rememberFocus(entry.path);
  transferItem.value = entry;
}

function transferred(event) {
  transferItem.value = null;
  if (event.skipped) return;
  feedback.success(vibe64FileTransferMessage(event));
  if (event.mode === "move" && file.value?.path === event.item.path) file.value = null;
  if (event.mode === "move" || event.destination.area === props.area) void loadDirectory(directory.value, false, { quiet: true });
  emit("transferred", event);
}

function copyLocation() {
  return command(async () => {
    await writeClipboardText(location.value);
    feedback.success("AI path copied.");
  });
}

function refresh() {
  if (dirty.value || busy.value) {
    pendingRefresh = true;
    return;
  }
  pendingRefresh = false;
  if (file.value && !file.value.image) return openEntry({ type: "file", path: file.value.path, name: fileName.value }, { focus: false });
  return loadDirectory(directory.value, false, { quiet: Boolean(file.value) });
}

// File actions show their words on wider screens and only icons on a phone.
function barAction(icon, label) {
  return mobile.value
    ? { icon, "aria-label": label.replace("…", ""), title: label, variant: "text" }
    : { "prepend-icon": icon, text: label, variant: "text" };
}

function entryIcon(entry) {
  if (entry.type === "directory") return mdiFolderOutline;
  return filePreviewImageType(entry.name) ? mdiFileImageOutline : mdiFileOutline;
}

function entrySubtitle(entry) {
  if (entry.type !== "file") return "Folder";
  const expiry = entry.expiresAt ? ` · Deleted after ${new Date(entry.expiresAt).toLocaleDateString()}` : "";
  return `${formatFileSize(entry.size)}${expiry}`;
}

watch(() => props.base, () => {
  directory.value = "";
  void loadDirectory();
}, { immediate: true });
watch(() => props.refreshKey, () => {
  if (props.active) void refresh(); else pendingRefresh = true;
});
watch(() => props.agentActive, (working, wasWorking) => {
  if (!wasWorking || working) return;
  if (props.active) void refresh(); else pendingRefresh = true;
});
watch([() => props.active, dirty], ([active, changed]) => {
  if (active && !changed && pendingRefresh) void refresh();
});
onScopeDispose(() => {
  generation += 1;
  clearTimeout(uploadRefreshTimer);
});
</script>

<style scoped>
.vibe64-file-area {
  display: flex;
  flex-direction: column;
  min-block-size: 0;
  min-inline-size: 0;
  overflow: auto;
  position: relative;
}

.vibe64-file-area__drop-target {
  align-items: center;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, rgb(var(--v-theme-surface)));
  border: 2px dashed rgb(var(--v-theme-primary));
  border-radius: var(--v64-shape-md);
  color: rgb(var(--v-theme-primary));
  display: flex;
  flex-direction: column;
  font: var(--v64-type-title-md);
  gap: var(--v64-space-3);
  inset: var(--v64-space-2);
  justify-content: center;
  pointer-events: none;
  position: absolute;
  z-index: 3;
}

.vibe64-file-area__toolbar {
  align-items: center;
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: var(--v64-space-1);
  padding: var(--v64-space-2) var(--v64-space-2) 0 var(--v64-space-2);
}

.vibe64-file-area__crumbs {
  align-items: center;
  display: flex;
  flex: 1 1 12rem;
  flex-wrap: wrap;
  min-inline-size: 0;
}

.vibe64-file-area__crumbs .v-btn {
  font: var(--v64-type-title-md);
  min-inline-size: 0;
  padding-inline: var(--v64-space-2);
  text-transform: none;
}

.vibe64-file-area__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-inline-start: auto;
}

.vibe64-file-area__crumb-current {
  color: rgb(var(--v-theme-on-surface));
  font: var(--v64-type-title-md);
  overflow-wrap: anywhere;
  padding-inline: var(--v64-space-2);
}

.vibe64-file-area--mobile .vibe64-file-area__crumbs .v-btn {
  min-block-size: 48px;
}

.vibe64-file-area__description {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
  padding: 0 var(--v64-space-4) var(--v64-space-2);
}

.vibe64-file-area__body {
  flex: 1;
  min-block-size: 0;
}

.vibe64-file-area__listing {
  background: transparent;
}

/* Secondary text at full on-surface-variant contrast. */
.vibe64-file-area :deep(.v-list-item-subtitle),
.vibe64-file-area__dialog :deep(.v-card-subtitle),
.vibe64-file-area__new-file :deep(.v-card-subtitle) {
  color: var(--v64-on-surface-variant);
  opacity: 1;
}

.vibe64-file-area__file-bar {
  align-items: center;
  border-block-end: 1px solid var(--v64-outline-variant);
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 0 var(--v64-space-1);
  min-block-size: 56px;
  padding-inline: var(--v64-space-1);
}

/* On a phone the page scrolls, so Save and the other file actions stay in view. */
.vibe64-file-area--mobile .vibe64-file-area__file-bar {
  background: rgb(var(--v-theme-surface));
  inset-block-start: 0;
  position: sticky;
  z-index: 2;
}

/* The name keeps room to be read; the actions move to a second line when the pane is narrow. */
.vibe64-file-area__file-heading {
  flex: 1 1 8rem;
  min-inline-size: 0;
  padding-block: var(--v64-space-1);
}

.vibe64-file-area__file-name,
.vibe64-file-area__file-folder {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-file-area__file-name {
  font: var(--v64-type-title-md);
}

.vibe64-file-area__file-folder {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
}

.vibe64-file-area__file-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  margin-inline-start: auto;
}

.vibe64-file-area__text {
  flex: 1;
  margin: var(--v64-space-3);
}

.vibe64-file-area__text :deep(textarea) {
  font-family: ui-monospace, monospace;
}

.vibe64-file-area__preview {
  flex: 1;
  font-family: ui-monospace, monospace;
  margin: 0;
  min-block-size: 0;
  overflow: auto;
  overflow-wrap: anywhere;
  padding: var(--v64-space-3) var(--v64-space-4);
  white-space: pre-wrap;
}

.vibe64-file-area__empty {
  align-items: center;
  color: var(--v64-on-surface-variant);
  display: flex;
  flex-direction: column;
  font: var(--v64-type-body-md);
  gap: var(--v64-space-2);
  justify-content: center;
  padding: var(--v64-space-6) var(--v64-space-4);
  text-align: center;
}

.vibe64-file-area__empty h3 {
  color: rgb(var(--v-theme-on-surface));
  font: var(--v64-type-title-lg);
  margin: 0;
}

.vibe64-file-area__empty p {
  margin: 0;
  max-inline-size: 32rem;
}

.vibe64-file-area__empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-2);
  justify-content: center;
  margin-block-start: var(--v64-space-2);
}

.vibe64-file-area__dialog-title {
  font: var(--v64-type-headline-sm);
  overflow-wrap: anywhere;
  white-space: normal;
}

.vibe64-file-area__bar-title {
  font: var(--v64-type-title-lg);
}

.vibe64-file-area__bar-action {
  min-block-size: 48px;
}

/* On a phone a small dialog sits near the top, clear of the keyboard. */
:global(.vibe64-file-area__dialog--top) {
  align-self: flex-start;
  margin-block-start: var(--v64-space-6);
}

.vibe64-file-area__dialog-text {
  font: var(--v64-type-body-lg);
  margin: 0;
  overflow-wrap: anywhere;
}

.vibe64-file-area__new-file .vibe64-file-area__new-file-body {
  align-content: start;
  display: grid;
  gap: var(--v64-space-2);
  /* Room for the outlined field's floating label inside the scrolling body. */
  padding-block-start: var(--v64-space-3);
}

.vibe64-file-area__new-file-body .vibe64-file-area__text {
  margin: 0;
}
</style>
