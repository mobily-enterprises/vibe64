import {
  codexAttachmentActionInputValidator,
  codexPromptHandoffActionInputValidator,
  codexThreadActionInputValidator,
  launchTargetActionInputValidator,
  openLaunchTargetActionInputValidator
} from "./inputSchemas.js";

const ACTION_START_LAUNCH_TARGET_TERMINAL = "feature.ai-studio-terminals.launch-target-terminal.start";
const ACTION_OPEN_LAUNCH_TARGET = "feature.ai-studio-terminals.launch-target.open";
const ACTION_UPLOAD_CODEX_ATTACHMENT = "feature.ai-studio-terminals.codex-attachment.upload";
const ACTION_SAVE_CODEX_THREAD = "feature.ai-studio-terminals.codex-thread.save";
const ACTION_SAVE_CODEX_PROMPT_HANDOFF = "feature.ai-studio-terminals.codex-prompt-handoff.save";

const featureActions = Object.freeze([
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
  },
  {
    id: ACTION_SAVE_CODEX_THREAD,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: codexThreadActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SAVE_CODEX_THREAD
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.saveCodexThread(input.sessionId, input);
    }
  },
  {
    id: ACTION_SAVE_CODEX_PROMPT_HANDOFF,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: codexPromptHandoffActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SAVE_CODEX_PROMPT_HANDOFF
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.saveCodexPromptHandoff(input.sessionId, input);
    }
  }
]);

export {
  ACTION_OPEN_LAUNCH_TARGET,
  ACTION_SAVE_CODEX_PROMPT_HANDOFF,
  ACTION_SAVE_CODEX_THREAD,
  ACTION_START_LAUNCH_TARGET_TERMINAL,
  ACTION_UPLOAD_CODEX_ATTACHMENT,
  featureActions
};
