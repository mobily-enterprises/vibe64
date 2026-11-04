import { ref } from "vue";

/**
 * What the session's preview offers the chat composer: a capture of the visible
 * preview and its console and network diagnostics, each with whether it is
 * available and busy. Launch controls report their actions while a preview is
 * mounted, and null for both once it unmounts.
 */
function useVibe64PreviewAttachmentState() {
  const previewAttachmentState = ref({
    attachDiagnostics: null,
    capture: null,
    captureAvailable: false,
    captureBusy: false,
    diagnosticsAvailable: false,
    diagnosticsBusy: false
  });

  function updatePreviewAttachmentState(state) {
    previewAttachmentState.value = {
      attachDiagnostics: state.attachDiagnostics,
      capture: state.capture,
      captureAvailable: state.captureAvailable === true,
      captureBusy: state.captureBusy === true,
      diagnosticsAvailable: state.diagnosticsAvailable === true,
      diagnosticsBusy: state.diagnosticsBusy === true
    };
  }

  function captureVisiblePreview() {
    const { capture } = previewAttachmentState.value;
    return capture === null ? false : capture();
  }

  function attachPreviewDiagnostics() {
    const { attachDiagnostics } = previewAttachmentState.value;
    return attachDiagnostics === null ? false : attachDiagnostics();
  }

  return {
    attachPreviewDiagnostics,
    captureVisiblePreview,
    previewAttachmentState,
    updatePreviewAttachmentState
  };
}

export {
  useVibe64PreviewAttachmentState
};
