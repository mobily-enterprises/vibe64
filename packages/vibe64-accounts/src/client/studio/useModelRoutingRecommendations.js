import { computed, ref } from "vue";
import { rolesFor, sameValue } from "./modelRoutingDraft.js";

/**
 * Review recommendations in the Models form: the shown setup's roles whose recommendation differs from the draft,
 * reviewed in a dialog and applied to the form (not saved).
 * @param {{
 *   setup: import("vue").ComputedRef<string>,
 *   draft: import("vue").Ref<Record<string, Record<string, object | null>>>,
 *   roleState: (setupId: string, role: string) => { recommendation?: object } | undefined,
 *   selectionLabel: (setupId: string, role: string, value: object | null) => string,
 *   update: (setupId: string, role: string, value: object | null) => void,
 *   canEdit: import("vue").ComputedRef<boolean>,
 *   saving: import("vue").Ref<boolean>,
 *   stale: import("vue").ComputedRef<boolean>
 * }} options
 */
function useModelRoutingRecommendations({ setup, draft, roleState, selectionLabel, update, canEdit, saving, stale }) {
  const recommendationReview = ref(null);
  const recommendedChanges = computed(() => rolesFor(setup.value).flatMap(({ id, label }) => {
    const proposed = roleState(setup.value, id)?.recommendation;
    if (!proposed || sameValue(draft.value[setup.value][id], proposed)) return [];
    return [{ setup: setup.value, role: id, label, proposed, description: selectionLabel(setup.value, id, proposed) }];
  }));

  function reviewRecommendations() {
    if (!canEdit.value || saving.value || stale.value || !recommendedChanges.value.length) return;
    recommendationReview.value = { changes: recommendedChanges.value };
  }

  function useRecommendations() {
    if (!recommendationReview.value || !canEdit.value || saving.value || stale.value) return;
    for (const { setup: setupId, role, proposed } of recommendationReview.value.changes) update(setupId, role, proposed);
    recommendationReview.value = null;
  }

  return { recommendationReview, recommendedChanges, reviewRecommendations, useRecommendations };
}

export { useModelRoutingRecommendations };
