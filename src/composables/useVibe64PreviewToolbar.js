import { computed, ref, watch } from "vue";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import { launchPreviewToolbarStorageKey } from "@/lib/vibe64LaunchBrowserWindow.js";
import {
  nextLaunchPreviewToolbarPosition,
  normalizeLaunchPreviewToolbarPosition
} from "@/lib/vibe64LaunchPreviewToolbar.js";

/**
 * The embedded Preview's toolbar: whether it is expanded, and where it sits,
 * remembered for the project's Preview window.
 * @param {{
 *   projectSlug: import("vue").Ref<string>,
 *   props: { embeddedPreview?: boolean, session?: object | null }
 * }} options
 */
function useVibe64PreviewToolbar({ projectSlug, props }) {
  const previewToolbarExpanded = ref(false);
  const previewToolbarPosition = ref("center");
  const previewToolbarStorageKey = computed(() => props.embeddedPreview && props.session
    ? launchPreviewToolbarStorageKey(props.session, projectSlug.value)
    : "");

  function movePreviewToolbar(direction = 0) {
    previewToolbarPosition.value = nextLaunchPreviewToolbarPosition(
      previewToolbarPosition.value,
      direction
    );
    if (previewToolbarStorageKey.value) {
      writeLocalStorageJson(previewToolbarStorageKey.value, previewToolbarPosition.value);
    }
  }

  function collapsePreviewToolbar() {
    previewToolbarExpanded.value = false;
  }

  function expandPreviewToolbar() {
    previewToolbarExpanded.value = true;
  }

  watch(previewToolbarStorageKey, (storageKey) => {
    previewToolbarExpanded.value = false;
    previewToolbarPosition.value = normalizeLaunchPreviewToolbarPosition(
      readLocalStorageJson(storageKey, "center")
    );
  }, {
    immediate: true
  });

  return {
    collapsePreviewToolbar,
    expandPreviewToolbar,
    movePreviewToolbar,
    previewToolbarExpanded,
    previewToolbarPosition
  };
}

export {
  useVibe64PreviewToolbar
};
