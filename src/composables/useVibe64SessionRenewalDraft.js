import { computed, onScopeDispose, ref } from "vue";
import {
  SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS,
  sessionRenewalDraftCharacterCount,
  sessionRenewalText
} from "@/lib/vibe64SessionRenewalViewModel.js";

const SESSION_RENEWAL_DRAFT_STORAGE_PREFIX = "vibe64:session-renewal-draft";

function renewalDraftStorageKey(
  projectSlug = "",
  sessionId = "",
  viewerScope = "",
  renewalId = ""
) {
  const project = String(projectSlug || "").trim();
  const session = String(sessionId || "").trim();
  const viewer = String(viewerScope || "").trim();
  const renewal = String(renewalId || "").trim();
  return project && session && viewer && renewal
    ? `${SESSION_RENEWAL_DRAFT_STORAGE_PREFIX}:${encodeURIComponent(viewer)}:${encodeURIComponent(project)}:${encodeURIComponent(session)}:${encodeURIComponent(renewal)}`
    : "";
}

/**
 * The handover draft under review: the text being edited, the server draft it started from, a newer
 * server draft that conflicts with unsaved edits, and the copy of those edits this browser tab keeps
 * until they are saved.
 * @param {{
 *   currentOperationKey: () => string,
 *   draftStorage: Storage | null,
 *   phase: import("vue").ComputedRef<string>,
 *   projectSlug: import("vue").Ref<string>,
 *   renewal: import("vue").ComputedRef<Record<string, any> | null>,
 *   sessionId: import("vue").ComputedRef<string>
 * }} options
 */
function useVibe64SessionRenewalDraft({
  currentOperationKey,
  draftStorage,
  phase,
  projectSlug,
  renewal,
  sessionId
}) {
  const draftText = ref("");
  const hydratedDraftIdentity = ref("");
  const hydratedDraftText = ref("");
  const hydratedDraftGuard = ref(null);
  const draftConflictState = ref(null);
  const draftStorageIdentity = ref("");
  const draftStorageHydrated = ref(false);
  const draftValidationError = ref("");
  const viewerScope = ref("");

  const draftCharacterCount = computed(() => sessionRenewalDraftCharacterCount(draftText.value));
  const draftTooLong = computed(() => (
    draftCharacterCount.value > SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS
  ));
  const draftDirty = computed(() => Boolean(
    hydratedDraftIdentity.value &&
    sessionRenewalText(draftText.value) !== sessionRenewalText(hydratedDraftText.value)
  ));
  const manualDraftIncomplete = computed(() => Boolean(
    renewal.value?.manualRequired === true &&
    String(renewal.value?.draft?.hash || "").trim() &&
    String(renewal.value?.draft?.hash || "").trim() ===
      String(renewal.value?.manualTemplateHash || "").trim() &&
    !draftDirty.value
  ));
  const draftError = computed(() => {
    if (draftTooLong.value) {
      return `Handover must be ${SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS.toLocaleString()} characters or fewer.`;
    }
    if (draftValidationError.value) {
      return draftValidationError.value;
    }
    return manualDraftIncomplete.value
      ? "Complete every handover section before creating the fresh session."
      : "";
  });
  const draftConflict = computed(() => draftConflictState.value);

  function renewalDraftState(candidate = null) {
    const draft = candidate?.draft;
    const identity = draft ? `${Number(draft.revision || 0)}:${String(draft.hash || "")}` : "";
    return {
      guard: {
        expectedHash: String(draft?.hash || ""),
        expectedRevision: Number(draft?.revision || 0),
        operationKey: String(candidate?.operationKey || currentOperationKey())
      },
      identity,
      text: identity ? sessionRenewalText(draft?.text) : ""
    };
  }

  function activeDraftStorageKey() {
    return draftStorageIdentity.value;
  }

  function removeStoredDraft() {
    const key = activeDraftStorageKey();
    if (!key || !draftStorage) {
      return;
    }
    try {
      draftStorage.removeItem(key);
    } catch {
      // Per-tab preservation is a convenience; blocked storage must not break renewal.
    }
  }

  function persistStoredDraft() {
    const key = activeDraftStorageKey();
    if (!key || !draftStorage || !draftStorageHydrated.value) {
      return;
    }
    if (
      phase.value !== "review" ||
      !draftDirty.value ||
      !hydratedDraftIdentity.value ||
      !renewal.value?.renewalId
    ) {
      removeStoredDraft();
      return;
    }
    try {
      draftStorage.setItem(key, JSON.stringify({
        baseGuard: hydratedDraftGuard.value,
        baseIdentity: hydratedDraftIdentity.value,
        baseText: hydratedDraftText.value,
        renewalId: String(renewal.value.renewalId),
        text: sessionRenewalText(draftText.value)
      }));
    } catch {
      // The durable server draft still exists when per-tab storage is unavailable or full.
    }
  }

  function restoreStoredDraft(candidate = null) {
    if (draftStorageHydrated.value) {
      return;
    }
    draftStorageHydrated.value = true;
    const key = activeDraftStorageKey();
    if (!key || !draftStorage || String(candidate?.status || "") !== "review") {
      return;
    }
    try {
      const stored = JSON.parse(String(draftStorage.getItem(key) || "null"));
      if (
        !stored ||
        typeof stored !== "object" ||
        Array.isArray(stored) ||
        String(stored.renewalId || "") !== String(candidate?.renewalId || "") ||
        !String(stored.baseIdentity || "") ||
        typeof stored.baseText !== "string" ||
        typeof stored.text !== "string" ||
        !stored.baseGuard ||
        typeof stored.baseGuard !== "object" ||
        Array.isArray(stored.baseGuard)
      ) {
        removeStoredDraft();
        return;
      }
      hydratedDraftIdentity.value = String(stored.baseIdentity);
      hydratedDraftText.value = sessionRenewalText(stored.baseText);
      hydratedDraftGuard.value = {
        expectedHash: String(stored.baseGuard.expectedHash || ""),
        expectedRevision: Number(stored.baseGuard.expectedRevision || 0),
        operationKey: String(stored.baseGuard.operationKey || "")
      };
      draftText.value = sessionRenewalText(stored.text);
    } catch {
      removeStoredDraft();
    }
  }

  function resetDraftHydration() {
    hydratedDraftIdentity.value = "";
    hydratedDraftText.value = "";
    hydratedDraftGuard.value = null;
    draftConflictState.value = null;
    draftStorageHydrated.value = false;
    draftValidationError.value = "";
    draftText.value = "";
  }

  /** Moves the draft to one viewer's copy of a renewal; false when it is already there. */
  function enterDraftContext(candidate, nextViewerScope) {
    const nextStorageIdentity = candidate
      ? renewalDraftStorageKey(
        projectSlug.value,
        sessionId.value,
        nextViewerScope,
        candidate.renewalId
      )
      : "";
    if (
      viewerScope.value === nextViewerScope &&
      draftStorageIdentity.value === nextStorageIdentity
    ) {
      return false;
    }
    persistStoredDraft();
    viewerScope.value = nextViewerScope;
    draftStorageIdentity.value = nextStorageIdentity;
    resetDraftHydration();
    return true;
  }

  /** Keeps unsaved edits in this tab, then forgets the viewer and renewal the draft belonged to. */
  function leaveDraftContext() {
    persistStoredDraft();
    viewerScope.value = "";
    draftStorageIdentity.value = "";
    resetDraftHydration();
  }

  function hydrateDraft(candidate = null, { preserveLocal = false } = {}) {
    const next = renewalDraftState(candidate);
    hydratedDraftIdentity.value = next.identity;
    hydratedDraftText.value = next.text;
    hydratedDraftGuard.value = next.guard;
    if (!preserveLocal) {
      draftText.value = next.text;
    }
    draftConflictState.value = null;
    draftValidationError.value = "";
  }

  function reconcileDraft(candidate = null) {
    const next = renewalDraftState(candidate);
    if (next.identity === hydratedDraftIdentity.value) {
      return;
    }
    const reviewStillEditable = String(candidate?.status || "") === "review";
    if (
      !reviewStillEditable ||
      !hydratedDraftIdentity.value ||
      !draftDirty.value ||
      next.text === sessionRenewalText(draftText.value)
    ) {
      hydrateDraft(candidate);
      return;
    }
    draftConflictState.value = next;
  }

  function draftGuard() {
    const guard = hydratedDraftGuard.value || renewalDraftState(renewal.value).guard;
    return {
      expectedHash: String(guard?.expectedHash || ""),
      expectedRevision: Number(guard?.expectedRevision || 0),
      operationKey: String(guard?.operationKey || currentOperationKey())
    };
  }

  function updateDraftText(value = "") {
    draftText.value = sessionRenewalText(value);
    draftValidationError.value = "";
    persistStoredDraft();
  }

  function acceptLatestDraft() {
    const conflict = draftConflictState.value;
    if (!conflict) {
      return;
    }
    hydratedDraftIdentity.value = conflict.identity;
    hydratedDraftText.value = conflict.text;
    hydratedDraftGuard.value = conflict.guard;
    draftText.value = conflict.text;
    draftConflictState.value = null;
    draftValidationError.value = "";
    persistStoredDraft();
  }

  function keepLocalDraft() {
    const conflict = draftConflictState.value;
    if (!conflict) {
      return;
    }
    hydratedDraftIdentity.value = conflict.identity;
    hydratedDraftText.value = conflict.text;
    hydratedDraftGuard.value = conflict.guard;
    draftConflictState.value = null;
    persistStoredDraft();
  }

  onScopeDispose(persistStoredDraft);

  return {
    acceptLatestDraft,
    draftCharacterCount,
    draftConflict,
    draftDirty,
    draftError,
    draftGuard,
    draftText,
    draftTooLong,
    draftValidationError,
    enterDraftContext,
    keepLocalDraft,
    leaveDraftContext,
    manualDraftIncomplete,
    persistStoredDraft,
    reconcileDraft,
    restoreStoredDraft,
    updateDraftText
  };
}

export {
  useVibe64SessionRenewalDraft
};
