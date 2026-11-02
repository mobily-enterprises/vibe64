<template>
  <v-dialog
    v-model="newFileDialogOpen"
    max-width="520"
  >
    <v-card>
      <v-card-title>New file</v-card-title>
      <v-card-text class="vibe64-source-editor__new-file-dialog">
        <p>
          {{ newFileDirectoryLabel }}
        </p>
        <v-alert
          v-if="newFileError"
          density="compact"
          type="warning"
          variant="tonal"
        >
          {{ newFileError }}
        </v-alert>
        <v-text-field
          v-model="newFileName"
          autofocus
          autocomplete="off"
          :disabled="editor.creatingFile.value"
          label="Path"
          placeholder="components/NewFile.vue"
          variant="outlined"
          @keydown.enter.prevent="submitNewFile"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          :disabled="editor.creatingFile.value"
          type="button"
          variant="text"
          @click="closeNewFileDialog"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="newFileCreateDisabled"
          :loading="editor.creatingFile.value"
          type="button"
          variant="flat"
          @click="submitNewFile"
        >
          Create
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, ref } from "vue";
import { normalizeSourceEditorPath } from "@/lib/vibe64SourceEditorLinks.js";

// New file: a nested path inside the folder it was asked for. The host opens
// it with open(directoryPath) and hears `created` with the new file's path.
const props = defineProps({
  // The source editor composable's state and operations.
  editor: { type: Object, required: true }
});
const emit = defineEmits(["created"]);

const newFileDialogOpen = ref(false);
const newFileDirectory = ref("");
const newFileError = ref("");
const newFileName = ref("");
const newFileDirectoryLabel = computed(() => (
  newFileDirectory.value
    ? `Create in ${newFileDirectory.value}`
    : "Create in source root"
));
const newFilePath = computed(() => {
  const name = normalizeNewFileEntryPath(newFileName.value);
  if (!name) {
    return "";
  }
  return newFileDirectory.value
    ? `${newFileDirectory.value}/${name}`
    : name;
});
const newFileCreateDisabled = computed(() => Boolean(
  props.editor.creatingFile.value ||
  !newFilePath.value
));

function normalizeNewFileEntryPath(value = "") {
  const raw = normalizeSourceEditorPath(value).replace(/\/+$/u, "");
  if (!raw || raw.startsWith("/")) {
    return "";
  }
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    return "";
  }
  return parts.join("/");
}

/**
 * Opens the dialog for a new file inside a folder.
 * @param {string} directoryPath The folder, or "" for the source root.
 */
function open(directoryPath = "") {
  newFileDirectory.value = normalizeSourceEditorPath(directoryPath);
  newFileName.value = "";
  newFileError.value = "";
  newFileDialogOpen.value = true;
}

function closeNewFileDialog() {
  if (props.editor.creatingFile.value) {
    return;
  }
  newFileDialogOpen.value = false;
  newFileError.value = "";
}

async function submitNewFile() {
  const filePath = newFilePath.value;
  if (!filePath || props.editor.creatingFile.value) {
    if (String(newFileName.value || "").trim()) {
      newFileError.value = "Enter a nested file path without absolute or parent-directory segments.";
    }
    return;
  }
  const created = await props.editor.createFile(filePath);
  if (!created) {
    newFileError.value = props.editor.createFileError.value || "Source file could not be created.";
    return;
  }
  emit("created", filePath);
  newFileDialogOpen.value = false;
  newFileError.value = "";
}

defineExpose({ open });
</script>

<style scoped>
.vibe64-source-editor__new-file-dialog {
  display: grid;
  gap: 0.76rem;
}

.vibe64-source-editor__new-file-dialog p {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
  line-height: 1.35;
  margin: 0;
}
</style>
