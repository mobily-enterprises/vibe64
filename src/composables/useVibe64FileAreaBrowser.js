import { computed, nextTick, onScopeDispose, ref, watch } from "vue";
import { filePreviewImageType } from "@local/vibe64-source-editor/shared/fileTypes";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { fileAreaRequest, fileAreaUrl } from "@/lib/vibe64FileAreaRequest.js";

/**
 * Browsing one Files area: the open folder's listing, the open file and its
 * draft, an image preview that walks the folder's images, and refreshes after
 * the agent's work or a host's request. A refresh waits while the file has
 * unsaved edits, an operation runs or the area is hidden.
 * @param {object} options
 * @param {import("vue").ComputedRef<{ label: string }>} options.areaInfo
 * @param {import("vue").Ref<boolean>} options.busy Whether a file operation runs.
 * @param {import("vue").Ref<HTMLElement | null>} options.fileHeading The open file's name.
 * @param {import("@/types.js").Vibe64FileAreaFocus} options.focus
 * @param {{ active: boolean, agentActive: boolean, base: string, projectSlug: string, refreshKey: number }} options.props
 *   The area's props.
 * @param {import("vue").Ref<HTMLElement | null>} options.root The area's element.
 */
function useVibe64FileAreaBrowser({
  areaInfo,
  busy,
  fileHeading,
  focus,
  props,
  root
}) {
  const directory = ref("");
  const entries = ref([]);
  const location = ref("");
  const expired = ref(false);
  const hasMore = ref(false);
  const nextOffset = ref(0);
  const loading = ref(false);
  const loadError = ref("");
  const file = ref(null);
  const draft = ref("");
  const dirty = computed(() => typeof file.value?.text === "string" && draft.value !== file.value.text);
  const fileName = computed(() => file.value?.path.split("/").at(-1) || "");
  const fileEntry = computed(() => file.value && { name: fileName.value, path: file.value.path, type: "file" });
  let generation = 0;
  let pendingRefresh = false;

  const breadcrumbs = computed(() => [
    { title: areaInfo.value.label, path: "" },
    ...directory.value.split("/").filter(Boolean).map((name, index, parts) => ({ title: name, path: parts.slice(0, index + 1).join("/") }))
  ]);
  const folderLabel = computed(() => breadcrumbs.value.map((crumb) => crumb.title).join(" › "));
  const imageSiblings = computed(() => file.value?.image ? entries.value.filter((entry) => entry.type === "file" && filePreviewImageType(entry.name)) : []);

  // A quiet reload refreshes the listing without leaving an open file.
  async function loadDirectory(target = "", append = false, { quiet = false, focus: focusFolder = false } = {}) {
    const current = ++generation;
    if (!quiet) loading.value = true;
    loadError.value = "";
    try {
      const result = await fileAreaRequest(fileAreaUrl(props.base, "tree", target, { offset: append ? nextOffset.value : 0 }));
      if (current !== generation) return;
      if (!quiet) file.value = null;
      directory.value = target;
      entries.value = append ? [...entries.value, ...result.tree.children] : result.tree.children;
      hasMore.value = result.tree.hasMore === true;
      nextOffset.value = result.tree.nextOffset;
      location.value = result.location || "";
      expired.value = result.expired === true;
      if (focusFolder) {
        loading.value = false;
        await nextTick();
        focus.focusFolder();
      }
    } catch (error) {
      if (current === generation) loadError.value = error.message;
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  // Opening moves focus into the item; a refresh of the open file does not.
  async function openEntry(entry, { focus: focusFile = true } = {}) {
    if (entry.type === "directory") return loadDirectory(entry.path, false, { focus: true });
    if (filePreviewImageType(entry.name)) {
      generation += 1;
      loading.value = false;
      file.value = {
        image: true, path: entry.path, size: entry.size,
        src: scopedDevelopmentApiUrl(fileAreaUrl(props.base, "download", entry.path, { inline: "1" }), props.projectSlug)
      };
      await nextTick();
      root.value?.querySelector(".vibe64-image-preview__stage")?.focus();
      return;
    }
    const current = ++generation;
    loading.value = true;
    try {
      const result = await fileAreaRequest(fileAreaUrl(props.base, "file", entry.path));
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
    if (focusFile && current === generation) {
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
    focus.rowElement(path)?.focus();
  }

  function stepImage(step) {
    const images = imageSiblings.value;
    const index = images.findIndex((entry) => entry.path === file.value.path);
    if (images.length > 1) void openEntry(images[(index + step + images.length) % images.length]);
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

  // Reloads the folder's listing now, or once the open file closes.
  function reloadListing() {
    if (file.value) pendingRefresh = true;
    else void loadDirectory(directory.value, false, { quiet: true });
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
  });

  return {
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
    hasMore,
    imageSiblings,
    loadDirectory,
    loadError,
    loading,
    location,
    openEntry,
    refresh,
    reloadListing,
    stepImage
  };
}

export { useVibe64FileAreaBrowser };
