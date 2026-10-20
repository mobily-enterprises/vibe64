import { computed, shallowRef } from "vue";

// AI onboarding reads and changes Colleague's model through the Colleague
// mounted in this browser view, without importing it. The newest mount wins;
// each mount removes only its own registration.
const registrations = shallowRef([]);
const available = computed(() => registrations.value.length > 0);

function registerVibe64ColleagueModel(entry) {
  registrations.value = [...registrations.value, entry];
  return () => { registrations.value = registrations.value.filter(item => item !== entry); };
}

function useVibe64ColleagueModel() {
  const latest = () => registrations.value.at(-1) || null;
  return {
    // A computed ref: true while a Colleague is mounted.
    available,
    // Colleague's saved selection, or null before its first model choice.
    current: () => latest()?.current() || null,
    selectForWorkflow: engineId => latest()?.selectForWorkflow(engineId) ||
      Promise.resolve({ ok: false, error: "Colleague is not open in this browser view." })
  };
}

// The choice Colleague's model menu preselects when switching to this workflow
// in its catalogue: the workflow's default model when connected and
// available, otherwise its first connected model, with a compatible agent.
function workflowModelSelection(catalog, engineId) {
  const engine = (catalog?.engines || []).find(item => item?.engineId === engineId);
  if (engine?.health?.status !== "ready") return null;
  const defaults = engine.defaults || {};
  const models = (engine.modelProviders || []).filter(provider => provider.connected).flatMap(provider =>
    (provider.models || []).filter(model => model.status === "available").map(model => ({ model, modelProviderId: provider.id })));
  const chosen = models.find(({ model, modelProviderId }) => modelProviderId === defaults.modelProviderId && model.id === defaults.modelId)
    || models[0];
  if (!chosen) return null;
  const agents = (engine.agents || []).filter(agent => ["all", "primary"].includes(agent.mode) &&
    (!agent.modelProviderId || agent.modelProviderId === chosen.modelProviderId) && (!agent.modelId || agent.modelId === chosen.model.id));
  const agent = agents.find(item => item.id === defaults.agentId) || agents[0];
  if (!agent) return null;
  const variantId = agent.variantId || defaults.variantId || "";
  return { engineId, modelProviderId: chosen.modelProviderId, modelId: chosen.model.id, agentId: agent.id,
    variantId: (chosen.model.variants || []).some(variant => variant.id === variantId) ? variantId : "",
    ...(engine.revision ? { catalogRevision: engine.revision } : {}) };
}

export { registerVibe64ColleagueModel, useVibe64ColleagueModel, workflowModelSelection };
