export {
  SYSTEM_GRAPH_API_SUFFIX,
  useVibe64SystemGraph
} from "./composables/useVibe64SystemGraph.js";

export async function loadVibe64ArchitectureView() {
  return (await import("./components/Vibe64UiStoryboardView.vue")).default;
}
