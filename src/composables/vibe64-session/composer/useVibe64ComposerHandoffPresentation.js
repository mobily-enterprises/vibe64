import { computed } from "vue";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const COMPOSER_HANDOFF_PRESENTATION = Object.freeze({
  accepted: Object.freeze({ label: "Sending to assistant...", pending: true }),
  active: Object.freeze({ label: "", pending: false }),
  connecting: Object.freeze({ label: "Connecting to assistant...", pending: true }),
  delivered: Object.freeze({ label: "Starting assistant...", pending: true }),
  failed: Object.freeze({ label: "", pending: false })
});

function composerHandoffPresentation(handoff = null) {
  const source = handoff && typeof handoff === "object" && !Array.isArray(handoff) ? handoff : {};
  const state = String(source.state || "").trim();
  const presentation = COMPOSER_HANDOFF_PRESENTATION[state] || {
    label: "",
    pending: false
  };
  return {
    error: state === "failed" ? String(source.error || "Assistant prompt delivery failed.") : "",
    id: String(source.id || ""),
    label: presentation.label,
    pending: presentation.pending,
    state,
    submissionId: String(source.submissionId || "")
  };
}

function useVibe64ComposerHandoffPresentation(handoff = null) {
  return computed(() => composerHandoffPresentation(readRefOrGetterValue(handoff)));
}

export {
  composerHandoffPresentation,
  useVibe64ComposerHandoffPresentation
};
