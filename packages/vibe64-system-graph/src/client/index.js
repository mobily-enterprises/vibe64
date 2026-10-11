export {
  useVibe64SystemGraph
} from "./composables/useVibe64SystemGraph.js";

export async function loadVibe64SubsystemsView() {
  return (await import("./components/Vibe64UiStoryboardView.vue")).default;
}
