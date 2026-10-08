import { inject, onBeforeUnmount, toValue, watchEffect } from "vue";
import { VIBE64_COLLEAGUE_PREVIEW_KEY } from "/src/lib/vibe64AssistantHost.js";

// The original selected Preview handle is shared by App-backed and source-less
// lessons. It is display coordination, never authorization or a receipt writer.
function useTrainingPreviewRegistration(displayedPreview, enabled) {
  const colleaguePreview = inject(VIBE64_COLLEAGUE_PREVIEW_KEY, null);
  watchEffect(() => {
    if (!colleaguePreview) return;
    if (toValue(enabled)) colleaguePreview.value = displayedPreview;
    else if (colleaguePreview.value === displayedPreview) colleaguePreview.value = null;
  });
  onBeforeUnmount(() => {
    if (colleaguePreview?.value === displayedPreview) colleaguePreview.value = null;
  });
}

export { useTrainingPreviewRegistration };
