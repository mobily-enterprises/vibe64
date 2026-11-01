import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";

import { currentAppQueryInputValidator } from "./inputSchemas.js";

/** @typedef {import("./types.js").CurrentAppService} CurrentAppService */

const ACTION_READ_CURRENT_APP = "vibe64.current-app.read";

/**
 * @param {object} dependencies
 * @param {CurrentAppService} dependencies.currentApp
 */
function createCurrentAppActions({ currentApp }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_CURRENT_APP,
      input: currentAppQueryInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => currentApp.inspectCurrentApp(input)
    })
  ]);
}

export {
  ACTION_READ_CURRENT_APP,
  createCurrentAppActions
};
