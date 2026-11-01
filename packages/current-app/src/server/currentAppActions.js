import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import {
  currentAppQueryInputValidator
} from "./inputSchemas.js";

/** @typedef {import("./types.js").CurrentAppService} CurrentAppService */

const ACTION_READ_CURRENT_APP = "vibe64.current-app.read";

/**
 * @param {object} dependencies
 * @param {CurrentAppService} dependencies.currentApp
 */
function createCurrentAppActions({ currentApp }) {
  return Object.freeze([Object.freeze({
    id: ACTION_READ_CURRENT_APP,
    version: 1,
    kind: "query",
    input: currentAppQueryInputValidator,
    output: null,
    extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
    idempotency: "none",
    execute: (input) => currentApp.inspectCurrentApp(input)
  })]);
}

export {
  ACTION_READ_CURRENT_APP,
  createCurrentAppActions
};
