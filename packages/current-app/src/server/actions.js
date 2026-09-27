import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import {
  currentAppQueryInputValidator
} from "./inputSchemas.js";

const ACTION_READ_CURRENT_APP = "vibe64.current-app.read";

function createActions({ currentApp } = {}) {
  if (!currentApp || typeof currentApp.inspectCurrentApp !== "function") {
    throw new TypeError("createActions requires the current-app API.");
  }
  return Object.freeze([withVibe64ActionContext({
    id: ACTION_READ_CURRENT_APP,
    version: 1,
    kind: "query",
    input: currentAppQueryInputValidator,
    output: null,
    extensions: { assistant: { exclude: true } },
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_CURRENT_APP
    },
    observability: {},
    execute(input) {
      return currentApp.inspectCurrentApp(input);
    }
  })]);
}

export {
  ACTION_READ_CURRENT_APP,
  createActions
};
