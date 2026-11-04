import { ref } from "vue";
import { useVibe64PreviewCapture } from "@/composables/useVibe64PreviewCapture.js";
import { previewDiagnosticsFile } from "@/lib/vibe64PreviewDiagnostics.js";

/**
 * What the embedded Preview attaches to the current message: a screenshot of
 * the visible Preview (its eye) and the page's diagnostics, each handed to the
 * host's `prepareFile` while it is made.
 * @param {{
 *   prepareFile: import("@/composables/useVibe64PreviewCapture.js").PreviewFilePreparer,
 *   previewDiagnosticsAvailable: import("vue").Ref<boolean>,
 *   previewDisplayed: () => boolean,
 *   previewFrame: import("vue").Ref<HTMLElement | null>,
 *   previewLoaded: import("vue").Ref<boolean>,
 *   requestPreviewDiagnostics: (options: { signal: AbortSignal }) => Promise<object>,
 *   scopeKey: () => string
 * }} options
 */
function useVibe64PreviewAttachments({
  prepareFile,
  previewDiagnosticsAvailable,
  previewDisplayed,
  previewFrame,
  previewLoaded,
  requestPreviewDiagnostics,
  scopeKey
}) {
  const capture = useVibe64PreviewCapture({
    prepareFile,
    previewDisplayed,
    previewFrame,
    previewLoaded,
    scopeKey
  });
  const diagnosticsBusy = ref(false);
  let diagnosticsSequence = 0;

  async function attachDiagnostics() {
    if (!previewDiagnosticsAvailable.value) {
      return false;
    }
    return capture.deliverPreviewFile({
      busy: diagnosticsBusy,
      failureMessage: "Preview diagnostics could not be attached.",
      fileName: "Preview diagnostics",
      produce: async ({ signal }) => previewDiagnosticsFile(await requestPreviewDiagnostics({ signal }), {
        sequence: ++diagnosticsSequence
      })
    });
  }

  return {
    attachDiagnostics,
    capture,
    diagnosticsBusy
  };
}

export {
  useVibe64PreviewAttachments
};
