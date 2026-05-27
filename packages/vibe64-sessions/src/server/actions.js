import {
  sessionActionInputValidator,
  sessionCreateInputValidator,
  sessionIdInputValidator,
  sessionIntentInputValidator,
  sessionListInputValidator,
  sessionRewindInputValidator,
  sessionTerminalFailureFixInputValidator
} from "./inputSchemas.js";

const ACTION_LIST_SESSIONS = "feature.vibe64-sessions.list";
const ACTION_CREATE_SESSION = "feature.vibe64-sessions.create";
const ACTION_INSPECT_SESSION = "feature.vibe64-sessions.inspect";
const ACTION_INSPECT_SESSION_DIFF = "feature.vibe64-sessions.diff.inspect";
const ACTION_READ_SESSION_CONVERSATION_LOG = "feature.vibe64-sessions.conversation-log.read";
const ACTION_BUILD_TERMINAL_FAILURE_FIX_REQUEST = "feature.vibe64-sessions.terminal-failure-fix-request.build";
const ACTION_RUN_SESSION_ACTION = "feature.vibe64-sessions.action.run";
const ACTION_RUN_SESSION_INTENT = "feature.vibe64-sessions.intent.run";
const ACTION_ADVANCE_SESSION = "feature.vibe64-sessions.advance";
const ACTION_ABANDON_SESSION = "feature.vibe64-sessions.abandon";
const ACTION_RECOVER_STUCK_SESSION_STEP = "feature.vibe64-sessions.step.stuck.recover";
const ACTION_REWIND_SESSION = "feature.vibe64-sessions.rewind";

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
      void context;
      return deps.featureService.listSessions(input || {});
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
    id: ACTION_READ_SESSION_CONVERSATION_LOG,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionIdInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_SESSION_CONVERSATION_LOG
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readSessionConversationLog(input.sessionId);
    }
  },
  {
    id: ACTION_BUILD_TERMINAL_FAILURE_FIX_REQUEST,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionTerminalFailureFixInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_BUILD_TERMINAL_FAILURE_FIX_REQUEST
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.buildTerminalFailureFixRequest(
        input.sessionId,
        input
      );
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
    id: ACTION_RUN_SESSION_INTENT,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionIntentInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_RUN_SESSION_INTENT
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.runSessionIntent(
        input.sessionId,
        input.intentId,
        {
          fields: input.fields || input.input || {},
          stepId: input.stepId || "",
          stepStatus: input.stepStatus || ""
        }
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
    id: ACTION_RECOVER_STUCK_SESSION_STEP,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionIdInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_RECOVER_STUCK_SESSION_STEP
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.recoverStuckSessionStep(input.sessionId);
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
  ACTION_BUILD_TERMINAL_FAILURE_FIX_REQUEST,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_DIFF,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RECOVER_STUCK_SESSION_STEP,
  ACTION_REWIND_SESSION,
  ACTION_RUN_SESSION_ACTION,
  ACTION_RUN_SESSION_INTENT,
  featureActions
};
