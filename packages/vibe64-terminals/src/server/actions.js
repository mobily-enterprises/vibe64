import {
  codexAttachmentActionInputValidator,
  commandTerminalActionInputValidator,
  launchTargetActionInputValidator,
  openLaunchTargetActionInputValidator,
  shellTerminalActionInputValidator
} from "./inputSchemas.js";

const ACTION_START_COMMAND_TERMINAL = "feature.vibe64-terminals.command-terminal.start";
const ACTION_START_LAUNCH_TARGET_TERMINAL = "feature.vibe64-terminals.launch-target-terminal.start";
const ACTION_START_SHELL_TERMINAL = "feature.vibe64-terminals.shell-terminal.start";
const ACTION_OPEN_LAUNCH_TARGET = "feature.vibe64-terminals.launch-target.open";
const ACTION_UPLOAD_CODEX_ATTACHMENT = "feature.vibe64-terminals.codex-attachment.upload";

const featureActions = Object.freeze([
  {
    id: ACTION_START_COMMAND_TERMINAL,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
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
        input: input.input
      });
    }
  },
  {
    id: ACTION_START_SHELL_TERMINAL,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
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
        target: input.target
      });
    }
  },
  {
    id: ACTION_START_LAUNCH_TARGET_TERMINAL,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
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
        launchTargetId: input.launchTargetId
      });
    }
  },
  {
    id: ACTION_OPEN_LAUNCH_TARGET,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
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
    surfaces: ["home"],
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
  ACTION_START_COMMAND_TERMINAL,
  ACTION_START_LAUNCH_TARGET_TERMINAL,
  ACTION_START_SHELL_TERMINAL,
  ACTION_UPLOAD_CODEX_ATTACHMENT,
  featureActions
};
