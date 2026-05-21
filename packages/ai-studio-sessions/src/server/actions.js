import {
  sessionActionInputValidator,
  sessionCreateInputValidator,
  sessionIdInputValidator,
  sessionListInputValidator,
  sessionRewindInputValidator
} from "./inputSchemas.js";

const ACTION_LIST_SESSIONS = "feature.ai-studio-sessions.list";
const ACTION_CREATE_SESSION = "feature.ai-studio-sessions.create";
const ACTION_INSPECT_SESSION = "feature.ai-studio-sessions.inspect";
const ACTION_INSPECT_SESSION_DIFF = "feature.ai-studio-sessions.diff.inspect";
const ACTION_RUN_SESSION_ACTION = "feature.ai-studio-sessions.action.run";
const ACTION_ADVANCE_SESSION = "feature.ai-studio-sessions.advance";
const ACTION_ABANDON_SESSION = "feature.ai-studio-sessions.abandon";
const ACTION_REWIND_SESSION = "feature.ai-studio-sessions.rewind";

const featureActions = Object.freeze([
  {
    id: ACTION_LIST_SESSIONS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionListInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_LIST_SESSIONS
    },
    observability: {},
    async execute(input, context, deps) {
      void input;
      void context;
      return deps.featureService.listSessions();
    }
  },
  {
    id: ACTION_CREATE_SESSION,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionCreateInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_CREATE_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.createSession(input || {});
    }
  },
  {
    id: ACTION_INSPECT_SESSION,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionIdInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_INSPECT_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.inspectSession(input.sessionId);
    }
  },
  {
    id: ACTION_INSPECT_SESSION_DIFF,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionIdInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_INSPECT_SESSION_DIFF
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.inspectSessionDiff(input.sessionId);
    }
  },
  {
    id: ACTION_RUN_SESSION_ACTION,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_RUN_SESSION_ACTION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.runSessionAction(
        input.sessionId,
        input.actionId,
        input.input || {}
      );
    }
  },
  {
    id: ACTION_ADVANCE_SESSION,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionIdInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_ADVANCE_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.advanceSession(input.sessionId);
    }
  },
  {
    id: ACTION_REWIND_SESSION,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionRewindInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_REWIND_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.rewindSession(input.sessionId, input.stepId);
    }
  },
  {
    id: ACTION_ABANDON_SESSION,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionIdInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_ABANDON_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.abandonSession(input.sessionId);
    }
  }
]);

export {
  ACTION_ABANDON_SESSION,
  ACTION_ADVANCE_SESSION,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_DIFF,
  ACTION_LIST_SESSIONS,
  ACTION_REWIND_SESSION,
  ACTION_RUN_SESSION_ACTION,
  featureActions
};
