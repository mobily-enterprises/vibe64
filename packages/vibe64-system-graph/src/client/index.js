export {
  useVibe64SystemGraph
} from "./composables/useVibe64SystemGraph.js";

async function loadVibe64SystemWorldView() {
  const module = await import("./components/Vibe64SystemWorldView.vue");
  return module.default;
}

export {
  loadVibe64SystemWorldView
};

export async function loadVibe64SubsystemsView() {
  return (await import("./components/Vibe64SubsystemsView.vue")).default;
}
