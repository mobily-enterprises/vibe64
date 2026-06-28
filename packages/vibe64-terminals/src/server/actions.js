import {
  codexAttachmentActionInputValidator,
  commandTerminalActionInputValidator,
  launchTargetActionInputValidator,
  openLaunchTargetActionInputValidator,
  projectToolFixActionInputValidator,
  projectToolRunActionInputValidator,
  sessionTerminalFixActionInputValidator,
  shellTerminalActionInputValidator
} from "./inputSchemas.js";

const ACTION_START_PROJECT_TOOL_FIX = "feature.vibe64-terminals.project-tool.fix.start";
const ACTION_START_SESSION_TERMINAL_FIX = "feature.vibe64-terminals.session-terminal.fix.start";
const ACTION_RUN_PROJECT_TOOL = "feature.vibe64-terminals.project-tool.run";
const ACTION_START_COMMAND_TERMINAL = "feature.vibe64-terminals.command-terminal.start";
const ACTION_START_LAUNCH_TARGET_TERMINAL = "feature.vibe64-terminals.launch-target-terminal.start";
const ACTION_START_SHELL_TERMINAL = "feature.vibe64-terminals.shell-terminal.start";
const ACTION_OPEN_LAUNCH_TARGET = "feature.vibe64-terminals.launch-target.open";
const ACTION_UPLOAD_CODEX_ATTACHMENT = "feature.vibe64-terminals.codex-attachment.upload";

const featureActions = Object.freeze([
  {
    id: ACTION_START_PROJECT_TOOL_FIX,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: projectToolFixActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_START_PROJECT_TOOL_FIX
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.startProjectToolFixJob(input.toolId, input);
    }
  },
  {
    id: ACTION_START_SESSION_TERMINAL_FIX,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: sessionTerminalFixActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_START_SESSION_TERMINAL_FIX
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.startSessionTerminalFixJob(input.sessionId, input);
    }
  },
  {
    id: ACTION_RUN_PROJECT_TOOL,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: projectToolRunActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_RUN_PROJECT_TOOL
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.runProjectTool(input.toolId, {
        parameters: input.parameters || {},
        sessionId: input.sessionId || "",
        sourcePath: input.sourcePath || "",
        vibe64User: input.vibe64User || null
      });
    }
  },
  {
    id: ACTION_START_COMMAND_TERMINAL,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: commandTerminalActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_START_COMMAND_TERMINAL
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.startCommandTerminal(input.sessionId, {
        advanceOnSuccess: input.advanceOnSuccess === true,
        actionId: input.actionId,
        input: input.input,
        vibe64User: input.vibe64User || null
      });
    }
  },
  {
    id: ACTION_START_SHELL_TERMINAL,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: shellTerminalActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_START_SHELL_TERMINAL
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.startShellTerminal(input.sessionId, {
        reuseRunning: input.reuseRunning,
        ...(input.vibe64User ? { vibe64User: input.vibe64User } : {})
      });
    }
  },
  {
    id: ACTION_START_LAUNCH_TARGET_TERMINAL,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: launchTargetActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_START_LAUNCH_TARGET_TERMINAL
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.startLaunchTargetTerminal(input.sessionId, {
        forceRestart: input.forceRestart === true,
        launchInput: input.launchInput || {},
        launchTargetId: input.launchTargetId,
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      });
    }
  },
  {
    id: ACTION_OPEN_LAUNCH_TARGET,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: openLaunchTargetActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_OPEN_LAUNCH_TARGET
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.openLaunchTarget(input.sessionId);
    }
  },
  {
    id: ACTION_UPLOAD_CODEX_ATTACHMENT,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: codexAttachmentActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_UPLOAD_CODEX_ATTACHMENT
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.uploadCodexAttachment(input.sessionId, input);
    }
  }
]);

export {
  ACTION_OPEN_LAUNCH_TARGET,
  ACTION_RUN_PROJECT_TOOL,
  ACTION_START_PROJECT_TOOL_FIX,
  ACTION_START_SESSION_TERMINAL_FIX,
  ACTION_START_COMMAND_TERMINAL,
  ACTION_START_LAUNCH_TARGET_TERMINAL,
  ACTION_START_SHELL_TERMINAL,
  ACTION_UPLOAD_CODEX_ATTACHMENT,
  featureActions
};
