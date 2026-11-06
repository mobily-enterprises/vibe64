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
      <v-icon icon="$download" size="40" aria-hidden="true" />
      <span>Drop to upload to {{ folderLabel }}</span>
    </div>

    <!-- An open file replaces the folder toolbar with its own bar. -->
    <Vibe64FileAreaToolbar
      v-if="!file"
      :archive-available="archived && area === 'session'"
      :archive-downloading="downloading.includes(archiveName)"
      :breadcrumbs="breadcrumbs"
      :busy="busy"
      :can-write="canWrite"
      :directory="directory"
      :loading="loading"
      :location="location"
      :mobile="mobile"
      @copy-location="copyLocation"
      @download-archive="download(archiveName, 'archive')"
      @new-file="openNewFile"
      @new-folder="openDialog('mkdir')"
      @open-folder="loadDirectory($event, false, { focus: true })"
      @refresh="refresh"
      @upload="chooseFiles"
    />
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
        <span class="vibe64-file-area__folder" :title="dirty ? 'Save or discard your changes first' : undefined">
          <v-btn variant="text" :disabled="dirty || busy" @click="closeFile">{{ folderName }}</v-btn>
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
              <v-btn icon="$chevronLeft" aria-label="Previous image" title="Previous image (←)" variant="text" @click="stepImage(-1)" />
              <v-btn icon="$chevronRight" aria-label="Next image" title="Next image (→)" variant="text" @click="stepImage(1)" />
            </template>
            <v-btn v-bind="barAction('$download', 'Download')" aria-label="Download file" :loading="downloading.includes(file.path)" @click="download(file.path)" />
            <v-btn v-if="destinations.length" v-bind="barAction('$driveFileMove', readOnly ? 'Copy to…' : 'Move or copy…')" :disabled="busy" @click="openTransfer(fileEntry)" />
            <v-btn v-if="canWrite" icon="$delete" aria-label="Delete file" title="Delete" variant="text" :disabled="busy" @click="openDialog('delete', fileEntry)" />
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
        <v-icon icon="$draft" size="40" aria-hidden="true" />
        <p>{{ file.message }}</p>
        <v-btn prepend-icon="$download" variant="tonal" :loading="downloading.includes(file.path)" @click="download(file.path)">Download</v-btn>
      </div>
    </template>

    <template v-else>
      <Vibe64FileAreaListing
        v-if="entries.length"
        :busy="busy"
        :can-transfer="destinations.length > 0"
        :can-write="canWrite"
        :downloading="downloading"
        :entries="entries"
        :has-more="hasMore"
        :mobile="mobile"
        :read-only="readOnly"
        @delete="openDialog('delete', $event)"
        @download="download"
        @open="openEntry"
        @rename="openDialog('rename', $event)"
        @show-more="loadDirectory(directory, true)"
        @transfer="openTransfer"
      />
      <div v-else class="vibe64-file-area__body vibe64-file-area__empty">
        <v-icon :icon="areaInfo.icon" size="48" aria-hidden="true" />
        <h3 tabindex="-1">{{ expired ? "This Session Dropzone has expired" : directory ? "This folder is empty" : `${areaInfo.label} is empty` }}</h3>
        <p v-if="canWrite">Drop files here, upload them, or create a text file.<template v-if="location"> The AI can use this folder too.</template></p>
        <div v-if="canWrite" class="vibe64-file-area__empty-actions">
          <v-btn prepend-icon="$uploadArrow" color="primary" variant="flat" @click="chooseFiles">Upload</v-btn>
          <v-btn prepend-icon="$noteAdd" variant="tonal" @click="openNewFile">New file</v-btn>
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
          <v-btn icon="$close" aria-label="Close" :disabled="busy" @click="newFileOpen = false" />
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

    <Vibe64FileConflictDialog :folder-label="folderLabel" :names="uploads.conflicts.value.names" @choose="uploads.resolveConflict" @closed="restoreFocus" />
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
import { computed, ref, useId } from "vue";
import { useDisplay } from "vuetify";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { useVibe64FileAreaBrowser } from "@/composables/useVibe64FileAreaBrowser.js";
import { useVibe64FileAreaCommands } from "@/composables/useVibe64FileAreaCommands.js";
import { useVibe64FileAreaFocus } from "@/composables/useVibe64FileAreaFocus.js";
import { useVibe64FileAreaUploads } from "@/composables/useVibe64FileAreaUploads.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { downloadAttachment } from "@/lib/vibe64AttachmentDownload.js";
import { vibe64FileArea } from "@/lib/vibe64FileAreas.js";
import { fileAreaUrl } from "@/lib/vibe64FileAreaRequest.js";
import Vibe64FileAreaListing from "./Vibe64FileAreaListing.vue";
import Vibe64FileAreaToolbar from "./Vibe64FileAreaToolbar.vue";
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
const uploadInput = ref(null);
const busy = ref(false);
// Downloads run beside other work; each shows progress on its own button.
const downloading = ref([]);
const archiveName = computed(() => `${props.sessionId}.tar.gz`);
const dialogTitleId = `vibe64-file-dialog-${useId()}`;
const newFileTitleId = `vibe64-new-file-dialog-${useId()}`;

const focus = useVibe64FileAreaFocus({ root });
const { restoreFocus } = focus;
const browser = useVibe64FileAreaBrowser({ areaInfo, busy, fileHeading, focus, props, root });
const {
  breadcrumbs,
  closeFile,
  directory,
  dirty,
  draft,
  entries,
  expired,
  file,
  fileEntry,
  fileName,
  folderLabel,
  folderName,
  hasMore,
  imageSiblings,
  loadDirectory,
  loadError,
  loading,
  location,
  openEntry,
  refresh,
  stepImage
} = browser;
const canWrite = computed(() => !readOnly.value && !expired.value);
const {
  dragDepth,
  dragEnter,
  dragLeave,
  dragOver,
  dropFiles,
  startUploads,
  uploads
} = useVibe64FileAreaUploads({ browser, canWrite, feedback, focus, props });
const {
  confirmDialog,
  copyLocation,
  createFile,
  dialogEntry,
  dialogName,
  dialogOpen,
  dialogOperation,
  dialogTitle,
  nameError,
  newFileName,
  newFileOpen,
  newFileText,
  openDialog,
  openNewFile,
  openTransfer,
  save,
  saveShortcut,
  transferItem,
  transferred
} = useVibe64FileAreaCommands({ browser, busy, emit, feedback, fileHeading, focus, props });

function chooseFiles() {
  uploadInput.value?.click();
}

function pickFiles(event) {
  const files = [...(event.target.files || [])];
  event.target.value = "";
  return startUploads(files);
}

// Esc returns to the folder and the arrow keys walk its images.
function previewKey(event) {
  if (!file.value?.image || event.defaultPrevented || event.target.closest("input, textarea, [role='dialog'], .v-overlay")) return;
  // At actual size the arrow keys scroll the image instead.
  if (event.key !== "Escape" && event.target.closest(".vibe64-image-preview__stage--actual")) return;
  if (event.key === "Escape") void closeFile();
  else if (event.key === "ArrowLeft") stepImage(-1);
  else if (event.key === "ArrowRight") stepImage(1);
  else return;
  event.preventDefault();
}

async function download(target, operation = "download") {
  if (downloading.value.includes(target)) return;
  downloading.value = [...downloading.value, target];
  try {
    await downloadAttachment(scopedDevelopmentApiUrl(fileAreaUrl(props.base, operation, target), props.projectSlug), target.split("/").at(-1), "Download failed.");
  } catch (error) {
    feedback.error(error, "Download failed.");
  } finally {
    downloading.value = downloading.value.filter((candidate) => candidate !== target);
  }
}

// File actions show their words on wider screens and only icons on a phone.
function barAction(icon, label) {
  return mobile.value
    ? { icon, "aria-label": label.replace("…", ""), title: label, variant: "text" }
    : { "prepend-icon": icon, text: label, variant: "text" };
}
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

.vibe64-file-area__description {
  color: rgb(var(--v-theme-on-surface-variant));
  font: var(--v64-type-body-md);
  margin: 0;
  padding: 0 var(--v64-space-4) var(--v64-space-2);
}

.vibe64-file-area__body {
  flex: 1;
  min-block-size: 0;
}

/* Secondary text at full on-surface-variant contrast. */
.vibe64-file-area__dialog :deep(.v-card-subtitle),
.vibe64-file-area__new-file :deep(.v-card-subtitle) {
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 1;
}

.vibe64-file-area__file-bar {
  align-items: center;
  border-block-end: 1px solid rgb(var(--v-theme-outline-variant));
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 0 var(--v64-space-1);
  min-block-size: 56px;
  padding-inline: var(--v64-space-1);
}

/* The folder's name, which shows the folder again, stays short beside the file's own name. */
.vibe64-file-area__folder { flex: none; max-inline-size: 40%; }
.vibe64-file-area__folder .v-btn { max-inline-size: 100%; }
.vibe64-file-area__folder :deep(.v-btn__content) { display: block; overflow: hidden; text-overflow: ellipsis; }

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
  color: rgb(var(--v-theme-on-surface-variant));
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
  color: rgb(var(--v-theme-on-surface-variant));
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
