import { readFileSync } from "node:fs";

// The Autopilot view and the parts it is laid out from, in page order: the
// header, session activity and chat above the project panel and dialogs.
export const AUTOPILOT_VIEW_FILES = Object.freeze([
  "src/components/studio/vibe64-session/Vibe64AutopilotView.vue",
  "src/components/studio/vibe64-session/Vibe64AutopilotSessionHeader.vue",
  "src/components/studio/vibe64-session/Vibe64AutopilotActivity.vue",
  "src/components/studio/vibe64-session/Vibe64AutopilotChat.vue",
  "src/components/studio/vibe64-session/Vibe64AutopilotProjectPanel.vue",
  "src/components/studio/vibe64-session/Vibe64AutopilotDialogs.vue"
]);

// The view's whole source: its files joined in page order.
export function readAutopilotViewSource() {
  return AUTOPILOT_VIEW_FILES
    .map((file) => readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8"))
    .join("\n");
}
