import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { plannedRestart } from "./plannedRestart.js";

// The planned restart gate a host's own crucial operations use (Publish to staging, Deploy to production, a backup):
// the same refusal, in the same words, as the editor's own. It answers from the process's reader at the moment of
// the call (plannedRestart.js), which the editor's server configures from the host's notice path as it starts.
const PLANNED_RESTART_TOKEN = "vibe64.planned-restart";

const Vibe64PlannedRestartProvider = defineProvider({
  id: "vibe64.planned-restart",
  provides: { plannedRestart: PLANNED_RESTART_TOKEN },
  setup: () => ({
    plannedRestart: Object.freeze({
      /**
       * Null, or `{ code: "vibe64_planned_restart", message, restartAt }` while a notice is in force.
       * @param {{ operation: string, label?: string, typicalMs?: number }} input
       */
      refusal: input => plannedRestart().refusal(input),
      /** The notice in force and, for a while after a restart, what it stopped. */
      status: () => plannedRestart().status()
    })
  })
});

export { PLANNED_RESTART_TOKEN, Vibe64PlannedRestartProvider };
