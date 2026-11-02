import { computed, nextTick, ref } from "vue";
import { writeClipboardText } from "@/lib/clipboard.js";
import { vibe64FileTransferMessage } from "@/lib/vibe64FileAreas.js";
import { fileAreaRequest } from "@/lib/vibe64FileAreaRequest.js";

function validName(name) {
  const trimmed = name.trim();
  return Boolean(trimmed) && !/[/\\]/u.test(trimmed) && ![".", ".."].includes(trimmed);
}

/**
 * The changes a Files area makes, one at a time while `busy`: saving the open
 * file, a new text file, a new folder, renaming or deleting an item, and
 * copying the AI path. It also reports a finished move or copy.
 * @param {object} options
 * @param {ReturnType<typeof import("@/composables/useVibe64FileAreaBrowser.js").useVibe64FileAreaBrowser>} options.browser
 * @param {import("vue").Ref<boolean>} options.busy Whether a file operation runs.
 * @param {(event: "transferred", payload: object) => void} options.emit The area's emit.
 * @param {{ error: (error: unknown, fallback?: string) => void, success: (message: string) => void }} options.feedback
 * @param {import("vue").Ref<HTMLElement | null>} options.fileHeading The open file's name.
 * @param {ReturnType<typeof import("@/composables/useVibe64FileAreaFocus.js").useVibe64FileAreaFocus>} options.focus
 * @param {{ area: string, base: string }} options.props The area's props.
 */
function useVibe64FileAreaCommands({
  browser,
  busy,
  emit,
  feedback,
  fileHeading,
  focus,
  props
}) {
  const { directory, file, draft, loadDirectory } = browser;
  const dialogOpen = ref(false);
  const dialogOperation = ref("");
  const dialogEntry = ref(null);
  const dialogName = ref("");
  const nameError = ref("");
  const newFileOpen = ref(false);
  const newFileName = ref("");
  const newFileText = ref("");
  const transferItem = ref(null);
  const dialogTitle = computed(() => ({
    delete: `Delete “${dialogEntry.value?.name}”?`, rename: `Rename “${dialogEntry.value?.name}”`, mkdir: "New folder"
  })[dialogOperation.value] || "");

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
      const result = await fileAreaRequest(`${props.base}/file`, { method: "PUT", body: { path: file.value.path, baseHash: file.value.hash, text: draft.value } });
      file.value = result.file;
      draft.value = result.file.text;
    });
  }

  function saveShortcut() {
    if (browser.dirty.value && !busy.value) void save();
  }

  function openNewFile() {
    focus.rememberFocus();
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
      const result = await fileAreaRequest(`${props.base}/file`, {
        method: "POST", body: { path: [directory.value, newFileName.value.trim()].filter(Boolean).join("/"), text: newFileText.value }
      });
      newFileOpen.value = false;
      await loadDirectory(directory.value, false, { quiet: true });
      file.value = result.file;
      draft.value = result.file.text;
      focus.forgetFocus();
      await nextTick();
      fileHeading.value?.focus();
    }, "The file could not be created.");
  }

  function openDialog(operation, entry = null) {
    focus.rememberFocus(entry?.path);
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
      await fileAreaRequest(`${props.base}/${suffix}`, {
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
    focus.rememberFocus(entry.path);
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
      await writeClipboardText(browser.location.value);
      feedback.success("AI path copied.");
    });
  }

  return {
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
  };
}

export { useVibe64FileAreaCommands };
