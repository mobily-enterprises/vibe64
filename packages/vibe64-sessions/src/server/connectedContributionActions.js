import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";
import {
  ASSISTANT_TOOL_DESCRIPTIONS,
  incomingContributionTool,
  sessionTool
} from "./assistantContracts.js";
import {
  connectedReplacementInputValidator,
  connectedReplacementInspectionInputValidator,
  connectedSessionBindInputValidator,
  connectedSessionLinkInputValidator,
  connectedSessionsInputValidator,
  connectedSourceInputValidator,
  connectedWorkInputValidator,
  sessionCreateInputValidator,
  sessionIdInputValidator
} from "./inputSchemas.js";

/** @typedef {import("./types.js").SessionsService} SessionsService */

const ACTION_PREPARE_CONNECTED_SOURCES = "vibe64.sessions.connected.prepare";
const ACTION_INSPECT_CONTRIBUTION_SOURCE = "vibe64.sessions.connected.source";
const ACTION_INSPECT_CONNECTED_INPUTS = "vibe64.sessions.connected.inputs.inspect";
const ACTION_INSPECT_CONNECTED_REPLACEMENT = "vibe64.sessions.connected.replacement.inspect";
const ACTION_REPLACE_CONNECTED_SOURCE = "vibe64.sessions.connected.replace";
const ACTION_INSPECT_CONTRIBUTION_WORK = "vibe64.sessions.connected.work.inspect";
const ACTION_INSPECT_CONTRIBUTION_INPUTS = "vibe64.sessions.connected.work.inputs";
const ACTION_INSPECT_CONTRIBUTION_INCOMING = "vibe64.sessions.connected.work.incoming";
const ACTION_SAVE_CONTRIBUTION_WORK = "vibe64.sessions.connected.work.save";
const ACTION_UPDATE_CONTRIBUTION_WORK = "vibe64.sessions.connected.work.update";
const ACTION_CHECK_CONTRIBUTION_UPDATES = "vibe64.sessions.connected.work.check";
const ACTION_RESOLVE_CONNECTED_SOURCE = "vibe64.sessions.connected.resolve";
const ACTION_CREATE_CONNECTED_REPLACEMENT = "vibe64.sessions.connected.replacement.create";
const ACTION_INSPECT_CONNECTED_CHOICES = "vibe64.sessions.connected.choices";
const ACTION_LINK_CONNECTED_SESSION = "vibe64.sessions.connected.link";
const ACTION_INSPECT_CONNECTED_SESSIONS = "vibe64.sessions.connected.sessions";
const ACTION_BIND_CONNECTED_SESSION = "vibe64.sessions.connected.sessions.bind";

/**
 * A session's connected contributions. The originating session prepares,
 * links, inspects and replaces its connected sources; the internal actions are
 * those it runs in each receiving project, through that project's own policy.
 * @param {object} dependencies
 * @param {SessionsService} dependencies.sessions
 */
function createConnectedContributionActions({ sessions }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_PREPARE_CONNECTED_SOURCES,
      input: { ...sessionIdInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => sessions.prepareConnectedSources(input.sessionId, input, context)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_CONTRIBUTION_SOURCE,
      input: { ...sessionCreateInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.inspectConnectedContributionSource(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_CONNECTED_INPUTS,
      input: { ...sessionIdInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => sessions.inspectConnectedDevelopmentInputs(input.sessionId, input, context)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_CONNECTED_REPLACEMENT,
      input: { ...connectedReplacementInspectionInputValidator, mode: "create" },
      extensions: {
        assistant: incomingContributionTool(ASSISTANT_TOOL_DESCRIPTIONS.inspectConnectedReplacement),
        vibe64: PROJECT_OPERATION
      },
      execute: (input, context) => sessions.reviewConnectedReplacement(input.sessionId, input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_REPLACE_CONNECTED_SOURCE,
      input: { ...connectedReplacementInputValidator, mode: "create" },
      extensions: {
        assistant: sessionTool(ASSISTANT_TOOL_DESCRIPTIONS.replaceConnectedSource),
        vibe64: PROJECT_OPERATION
      },
      execute: (input, context) => sessions.replaceConnectedSource(input.sessionId, input, context)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_CONTRIBUTION_WORK,
      input: { ...connectedWorkInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.inspectContributionWork(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_CONTRIBUTION_INPUTS,
      input: { ...connectedWorkInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.inspectContributionInputs(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_CONTRIBUTION_INCOMING,
      input: { ...connectedWorkInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.inspectContributionIncoming(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_CONTRIBUTION_WORK,
      input: { ...connectedWorkInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => sessions.saveContributionWork(input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_UPDATE_CONTRIBUTION_WORK,
      input: { ...connectedWorkInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.updateContributionWork(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_CHECK_CONTRIBUTION_UPDATES,
      input: { ...connectedWorkInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.checkContributionUpdates(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_RESOLVE_CONNECTED_SOURCE,
      input: { ...connectedSourceInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.resolveConnectedSource(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CREATE_CONNECTED_REPLACEMENT,
      input: { ...connectedSourceInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.createConnectedReplacement(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_CONNECTED_CHOICES,
      input: { ...sessionIdInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => sessions.inspectConnectedChoices(input.sessionId, input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_LINK_CONNECTED_SESSION,
      input: { ...connectedSessionLinkInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => sessions.linkConnectedSession(input.sessionId, input, context)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_CONNECTED_SESSIONS,
      input: { ...connectedSessionsInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.inspectConnectedSessions(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_BIND_CONNECTED_SESSION,
      input: { ...connectedSessionBindInputValidator, mode: "create" },
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.bindConnectedSession(input)
    })
  ]);
}

export {
  ACTION_BIND_CONNECTED_SESSION,
  ACTION_CHECK_CONTRIBUTION_UPDATES,
  ACTION_CREATE_CONNECTED_REPLACEMENT,
  ACTION_INSPECT_CONNECTED_CHOICES,
  ACTION_INSPECT_CONNECTED_INPUTS,
  ACTION_INSPECT_CONNECTED_REPLACEMENT,
  ACTION_INSPECT_CONNECTED_SESSIONS,
  ACTION_INSPECT_CONTRIBUTION_INCOMING,
  ACTION_INSPECT_CONTRIBUTION_INPUTS,
  ACTION_INSPECT_CONTRIBUTION_SOURCE,
  ACTION_INSPECT_CONTRIBUTION_WORK,
  ACTION_LINK_CONNECTED_SESSION,
  ACTION_PREPARE_CONNECTED_SOURCES,
  ACTION_REPLACE_CONNECTED_SOURCE,
  ACTION_RESOLVE_CONNECTED_SOURCE,
  ACTION_SAVE_CONTRIBUTION_WORK,
  ACTION_UPDATE_CONTRIBUTION_WORK,
  createConnectedContributionActions
};
