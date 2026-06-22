import { describe, expect, it } from "vitest";

import {
  currentStepWorkflowControls,
  githubBrokerConfirmationWorkflowControl,
  workflowControlButtonPresentation,
  workflowControlSourceAction
} from "../../src/lib/vibe64WorkflowControlModel.js";

describe("vibe64WorkflowControlModel", () => {
  it("uses server presentation controls before action fallbacks", () => {
    const controls = currentStepWorkflowControls({
      actions: [
        {
          enabled: true,
          id: "raw_action",
          label: "Raw action"
        }
      ],
      session: {
        intents: [
          {
            enabled: true,
            id: "server_intent",
            label: "Server intent"
          }
        ]
      }
    });

    expect(controls.map((control) => control.id)).toEqual(["server_intent"]);
    expect(workflowControlSourceAction(controls[0])).toBeNull();
  });

  it("links server presentation controls to matching current actions", () => {
    const action = {
      dispatchRoute: "command-terminal",
      enabled: true,
      id: "create_issue_on_gh",
      label: "Create issue on GH",
      type: "command"
    };
    const controls = currentStepWorkflowControls({
      actions: [action],
      session: {
        intents: [
          {
            actionId: "create_issue_on_gh",
            enabled: true,
            id: "continue_step",
            label: "Create GitHub issue",
            saveCurrentStepInputBeforeRun: true
          }
        ]
      }
    });

    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({
      actionId: "create_issue_on_gh",
      enabled: true,
      id: "continue_step",
      label: "Create GitHub issue"
    });
    expect(workflowControlSourceAction(controls[0])).toBe(action);
  });

  it("disables action-backed presentation controls when the source action is disabled", () => {
    const controls = currentStepWorkflowControls({
      actions: [
        {
          disabledReason: "Resolve the command failure first.",
          enabled: false,
          id: "create_issue_on_gh",
          label: "Create issue on GH"
        }
      ],
      session: {
        intents: [
          {
            actionId: "create_issue_on_gh",
            enabled: true,
            id: "continue_step",
            label: "Create GitHub issue"
          }
        ]
      }
    });

    expect(controls[0]).toMatchObject({
      disabledReason: "Resolve the command failure first.",
      enabled: false
    });
  });

  it("falls back to current actions when no presentation controls exist", () => {
    const action = {
      enabled: true,
      icon: "codex",
      id: "ask_codex",
      inputFields: [
        {
          kind: "textarea",
          label: "Question",
          name: "conversationRequest"
        }
      ],
      label: "Ask Codex"
    };
    const controls = currentStepWorkflowControls({
      actions: [action],
      session: {}
    });

    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({
      actionId: "ask_codex",
      enabled: true,
      id: "ask_codex",
      inputFields: action.inputFields,
      label: "Ask Codex",
      autoOpen: false,
      style: "primary"
    });
    expect(workflowControlSourceAction(controls[0])).toBe(action);
  });

  it("does not turn no-input actions into workflow controls", () => {
    const controls = currentStepWorkflowControls({
      actions: [
        {
          enabled: true,
          id: "create_worktree",
          label: "Create worktree"
        }
      ],
      session: {}
    });

    expect(controls).toEqual([]);
  });

  it("gives workflow choices the shared primary and outlined button style", () => {
    expect(workflowControlButtonPresentation({
      style: "primary"
    })).toEqual({
      buttonColor: "primary",
      buttonVariant: "flat"
    });
    expect(workflowControlButtonPresentation({
      style: "secondary"
    })).toEqual({
      buttonColor: "primary",
      buttonVariant: "outlined"
    });
  });

  it("keeps GitHub confirmation available through the current conversation action", () => {
    const sourceAction = {
      enabled: true,
      id: "agent_conversation",
      label: "Send to Codex"
    };
    const control = githubBrokerConfirmationWorkflowControl({
      codexSteerAvailable: false,
      confirmation: {
        prompt: "I confirm: push the current branch using the Vibe64 GitHub broker operation push_branch now.",
        required: true
      },
      sourceControl: {
        enabled: true,
        id: "talk_to_codex",
        sourceAction
      }
    });

    expect(control).toMatchObject({
      actionId: "agent_conversation",
      enabled: true,
      githubBrokerConfirmation: true,
      id: "vibe64.github-broker.confirm",
      label: "Confirm GitHub operation",
      sourceAction
    });
  });

  it("does not require active Codex steering for GitHub confirmation visibility", () => {
    expect(githubBrokerConfirmationWorkflowControl({
      codexSteerAvailable: false,
      confirmation: {
        prompt: "I confirm: push the current branch using the Vibe64 GitHub broker operation push_branch now.",
        required: true
      }
    })).toMatchObject({
      disabledReason: "Ask Codex again before confirming this GitHub operation.",
      enabled: false,
      githubBrokerConfirmation: true
    });
  });
});
