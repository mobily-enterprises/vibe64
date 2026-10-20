import { computed, shallowRef } from "vue";

// AI onboarding reads and changes Colleague's model through the Colleague
// mounted in this browser view, without importing it. The newest mount wins;
// each mount removes only its own registration. Results:
//   current() -> { selection, engineLabel, modelLabel } | null
//   selectForWorkflow({ engineId, modelProviderId })
//     -> { ok: true, selection, engineLabel, modelLabel } | { ok: false, error }
// selectForWorkflow uses the workflow's routed Senior, and fails when that
// Senior uses a provider other than modelProviderId (when given).
const registrations = shallowRef([]);
const available = computed(() => registrations.value.length > 0);
const NOT_OPEN = "Colleague is not open in this browser view.";

function registerVibe64ColleagueModel(entry) {
  registrations.value = [...registrations.value, entry];
  return () => { registrations.value = registrations.value.filter(item => item !== entry); };
}

function useVibe64ColleagueModel() {
  const latest = () => registrations.value.at(-1) || null;
  return {
    // A computed ref: true while a Colleague is mounted.
    available,
    current: async () => (await latest()?.current()) || null,
    selectForWorkflow: async target => (await latest()?.selectForWorkflow(target)) || { ok: false, error: NOT_OPEN }
  };
}

// Display labels for a selection from Colleague's model catalogue, falling
// back to its ids when the catalogue does not list it.
function selectionLabels(catalog, selection) {
  const engine = (catalog?.engines || []).find(item => item?.engineId === selection.engineId);
  const model = (engine?.modelProviders || []).find(provider => provider.id === selection.modelProviderId)
    ?.models?.find(item => item.id === selection.modelId);
  return { engineLabel: engine?.label || selection.engineId, modelLabel: model?.label || selection.modelId };
}

export { registerVibe64ColleagueModel, selectionLabels, useVibe64ColleagueModel };
