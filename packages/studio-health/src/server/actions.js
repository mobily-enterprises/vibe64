import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { studioHealthQueryInputValidator } from "./inputSchemas.js";

const ACTION_READ_STUDIO_HEALTH = "vibe64.studio-health.read";

function createActions({ studioHealth } = {}) {
  if (!studioHealth || typeof studioHealth.inspect !== "function") {
    throw new TypeError("createActions requires the Studio Health API.");
  }
  return Object.freeze([withVibe64ActionContext({
    id: ACTION_READ_STUDIO_HEALTH,
    version: 1,
    kind: "query",
    input: studioHealthQueryInputValidator,
    output: null,
    extensions: { assistant: { exclude: true } },
    idempotency: "none",
    audit: { actionName: ACTION_READ_STUDIO_HEALTH },
    observability: {},
    execute(input) {
      return studioHealth.inspect(input);
    }
  }, { projectScoped: false })]);
}

export {
  ACTION_READ_STUDIO_HEALTH,
  createActions
};
