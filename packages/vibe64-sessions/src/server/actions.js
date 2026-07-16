import {
  currentSessionInputValidator,
  sessionActionInputValidator,
  sessionAdvanceInputValidator,
  sessionConversationLogInputValidator,
  sessionCreateInputValidator,
  sessionDiffInputValidator,
  sessionIdInputValidator,
  sessionInspectInputValidator,
  sessionIntentInputValidator,
  sessionListInputValidator,
  sessionRecoveryInputValidator,
  sessionRewindInputValidator,
  sessionTerminalFailureFixInputValidator
} from "./inputSchemas.js";

const ACTION_LIST_SESSIONS = "feature.vibe64-sessions.list";
const ACTION_CREATE_SESSION = "feature.vibe64-sessions.create";
const ACTION_UPDATE_CURRENT_SESSION = "feature.vibe64-sessions.current.update";
const ACTION_INSPECT_SESSION = "feature.vibe64-sessions.inspect";
const ACTION_INSPECT_SESSION_DIFF = "feature.vibe64-sessions.diff.inspect";
const ACTION_READ_SESSION_CONVERSATION_LOG = "feature.vibe64-sessions.conversation-log.read";
const ACTION_BUILD_TERMINAL_FAILURE_FIX_REQUEST = "feature.vibe64-sessions.terminal-failure-fix-request.build";
const ACTION_RUN_SESSION_ACTION = "feature.vibe64-sessions.action.run";
const ACTION_RUN_SESSION_INTENT = "feature.vibe64-sessions.intent.run";
const ACTION_ADVANCE_SESSION = "feature.vibe64-sessions.advance";
const ACTION_ABANDON_SESSION = "feature.vibe64-sessions.abandon";
const ACTION_RECOVER_STUCK_SESSION_STEP = "feature.vibe64-sessions.step.stuck.recover";
const ACTION_RESOLVE_SESSION_RECOVERY = "feature.vibe64-sessions.recovery.resolve";
const ACTION_RETURN_AGENT_CONTROL = "feature.vibe64-sessions.agent-control.return";
const ACTION_REWIND_SESSION = "feature.vibe64-sessions.rewind";

const featureActions = Object.freeze([
  {
    id: ACTION_LIST_SESSIONS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
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
    surfaces: ["app"],
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
    id: ACTION_UPDATE_CURRENT_SESSION,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: currentSessionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_UPDATE_CURRENT_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.updateCurrentSession(input?.sessionId || "");
    }
  },
  {
    id: ACTION_INSPECT_SESSION,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: sessionInspectInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_INSPECT_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      const options = {
        includeComposerMenu: input.includeComposerMenu,
        projectSlug: input.projectSlug,
        vibe64User: input.vibe64User || null
      };
      if (input.includeRuntimeEnrichment !== undefined) {
        options.includeRuntimeEnrichment = input.includeRuntimeEnrichment;
      }
      return deps.featureService.inspectSession(input.sessionId, options);
    }
  },
  {
    id: ACTION_INSPECT_SESSION_DIFF,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: sessionDiffInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_INSPECT_SESSION_DIFF
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.inspectSessionDiff(input.sessionId, {
        full: input.full,
        lineLimit: input.lineLimit
      });
    }
  },
  {
    id: ACTION_READ_SESSION_CONVERSATION_LOG,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: sessionConversationLogInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_SESSION_CONVERSATION_LOG
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readSessionConversationLog(input.sessionId, {
        beforeTurnId: input.beforeTurnId,
        limit: input.limit
      });
    }
  },
  {
    id: ACTION_BUILD_TERMINAL_FAILURE_FIX_REQUEST,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
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
    surfaces: ["app"],
    input: sessionActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_RUN_SESSION_ACTION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      const agentSettings = input.agentSettings || input.input?.agentSettings;
      const options = {
        ...(input.input || {}),
        composerSubmissionId: input.composerSubmissionId || input.input?.composerSubmissionId || "",
        displayInput: input.displayInput || input.input?.displayInput || null,
        originId: input.originId || input.input?.originId || "",
        vibe64User: input.vibe64User || null
      };
      if (agentSettings && typeof agentSettings === "object" && !Array.isArray(agentSettings)) {
        options.agentSettings = agentSettings;
      }
      return deps.featureService.runSessionAction(
        input.sessionId,
        input.actionId,
        options
      );
    }
  },
  {
    id: ACTION_RUN_SESSION_INTENT,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: sessionIntentInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_RUN_SESSION_INTENT
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      const agentSettings = input.agentSettings || input.input?.agentSettings;
      const options = {
        composerSubmissionId: input.composerSubmissionId || input.input?.composerSubmissionId || "",
        fields: input.fields || input.input || {},
        displayFields: input.displayFields || input.input?.displayFields || {},
        originId: input.originId || input.input?.originId || "",
        stepId: input.stepId || "",
        stepStatus: input.stepStatus || "",
        vibe64User: input.vibe64User || null
      };
      if (agentSettings && typeof agentSettings === "object" && !Array.isArray(agentSettings)) {
        options.agentSettings = agentSettings;
      }
      return deps.featureService.runSessionIntent(
        input.sessionId,
        input.intentId,
        options
      );
    }
  },
  {
    id: ACTION_ADVANCE_SESSION,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: sessionAdvanceInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_ADVANCE_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.advanceSession(input.sessionId, {
        stepId: input.stepId || "",
        stepStatus: input.stepStatus || "",
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      });
    }
  },
  {
    id: ACTION_REWIND_SESSION,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: sessionRewindInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_REWIND_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.rewindSession(input.sessionId, input.stepId, {
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      });
    }
  },
  {
    id: ACTION_RECOVER_STUCK_SESSION_STEP,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: sessionIdInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_RECOVER_STUCK_SESSION_STEP
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.recoverStuckSessionStep(input.sessionId, {
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      });
    }
  },
  {
    id: ACTION_RESOLVE_SESSION_RECOVERY,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: sessionRecoveryInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_RESOLVE_SESSION_RECOVERY
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.resolveSessionRecovery(input.sessionId, {
        issueId: input.issueId,
        optionId: input.optionId,
        originId: input.originId || "",
        signature: input.signature,
        vibe64User: input.vibe64User || null
      });
    }
  },
  {
    id: ACTION_RETURN_AGENT_CONTROL,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: sessionIdInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_RETURN_AGENT_CONTROL
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.returnAgentControl(input.sessionId, {
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      });
    }
  },
  {
    id: ACTION_ABANDON_SESSION,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: sessionIdInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_ABANDON_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.abandonSession(input.sessionId, {
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      });
    }
  }
]);

export {
  ACTION_ABANDON_SESSION,
  ACTION_ADVANCE_SESSION,
  ACTION_BUILD_TERMINAL_FAILURE_FIX_REQUEST,
  ACTION_CREATE_SESSION,
  ACTION_UPDATE_CURRENT_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_DIFF,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RECOVER_STUCK_SESSION_STEP,
  ACTION_RESOLVE_SESSION_RECOVERY,
  ACTION_RETURN_AGENT_CONTROL,
  ACTION_REWIND_SESSION,
  ACTION_RUN_SESSION_ACTION,
  ACTION_RUN_SESSION_INTENT,
  featureActions
};
