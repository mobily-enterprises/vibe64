import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";

import {
  useVibe64StepInputForm
} from "../../src/composables/useVibe64StepInputForm.js";

function promptResponseSession(prompt) {
  return {
    currentStep: "plan_and_execute",
    presentation: {
      screen: {
        input: {
          fields: [
            {
              kind: "textarea",
              label: "Response",
              name: "response",
              required: true
            }
          ],
          prompt,
          submitKind: "user_response",
          submitTarget: "current-step-input"
        }
      }
    },
    sessionId: "session-1",
    stepMachine: {
      status: "waiting_for_input"
    }
  };
}

function stepInputForm(options = {}) {
  return useVibe64StepInputForm({
    submitCurrentStepInput: async () => ({
      ok: true
    }),
    ...options
  });
}

describe("useVibe64StepInputForm", () => {
  it("does not treat server-owned Codex conversation input as a direct step input form", () => {
    const session = ref({
      presentation: {
        screen: {
          input: {
            fields: [
              {
                kind: "textarea",
                label: "Response",
                name: "conversationRequest",
                required: true
              }
            ],
            intentId: "talk_to_codex",
            kind: "conversation",
            prompt: "What should Codex know?",
            submitTarget: "intent"
          }
        }
      },
      sessionId: "session-1",
      stepMachine: {
        status: "waiting_for_input"
      }
    });
    const form = stepInputForm({
      session
    });

    expect(form.visible.value).toBe(false);
  });

  it("keeps numbered prompt questions in one response textarea", async () => {
    let submittedInput = null;
    const session = ref(promptResponseSession([
      "[1] What filename should I create?",
      "[2] What contents should it have?"
    ].join("\n")));
    const form = stepInputForm({
      session,
      submitCurrentStepInput: async (_sessionId, input) => {
        submittedInput = input;
        return {
          ok: true
        };
      }
    });

    expect(form.prompt.value).toBe([
      "[1] What filename should I create?",
      "[2] What contents should it have?"
    ].join("\n"));
    expect(form.fields.value.map((field) => field.name)).toEqual(["response"]);

    form.updateValue("response", "[1] p.txt\n[2] hello");

    expect(await form.submit()).toBe(true);
    expect(Object.keys(submittedInput.fields)).toEqual(["response"]);
    expect(submittedInput).toMatchObject({
      fields: {
        response: "[1] p.txt\n[2] hello"
      },
      kind: "user_response",
      source: "ui",
      stepId: "plan_and_execute",
      stepStatus: "waiting_for_input"
    });
  });

  it("keeps the normal response textarea when the prompt is not a clean question list", () => {
    const session = ref(promptResponseSession("What should happen next?"));
    const form = stepInputForm({
      session
    });

    expect(form.prompt.value).toBe("What should happen next?");
    expect(form.fields.value).toHaveLength(1);
    expect(form.fields.value[0].name).toBe("response");
  });

  it("keeps normal fields when a prompt contains numbered questions", () => {
    const session = ref({
      currentStep: "plan_and_execute",
      presentation: {
        screen: {
          input: {
            fields: [
              {
                kind: "text",
                label: "Title",
                name: "title",
                required: true
              },
              {
                kind: "textarea",
                label: "Response",
                name: "response",
                required: true
              }
            ],
            prompt: [
              "[1] What filename should I create?",
              "[2] What contents should it have?"
            ].join("\n"),
            submitKind: "user_response",
            submitTarget: "current-step-input"
          }
        }
      },
      sessionId: "session-1",
      stepMachine: {
        status: "waiting_for_input"
      }
    });
    const form = stepInputForm({
      session
    });

    expect(form.prompt.value).toBe([
      "[1] What filename should I create?",
      "[2] What contents should it have?"
    ].join("\n"));
    expect(form.fields.value.map((field) => field.name)).toEqual(["title", "response"]);
  });

  it("keeps the normal response textarea when numbered questions are ambiguous", () => {
    const session = ref(promptResponseSession([
      "[1] What filename should I create?",
      "[3] What contents should it have?"
    ].join("\n")));
    const form = stepInputForm({
      session
    });

    expect(form.prompt.value).toBe([
      "[1] What filename should I create?",
      "[3] What contents should it have?"
    ].join("\n"));
    expect(form.fields.value.map((field) => field.name)).toEqual(["response"]);
  });

  it("keeps introductory numbered question text in the prompt above one textarea", () => {
    const session = ref(promptResponseSession([
      "Codex needs these details:",
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n")));
    const form = stepInputForm({
      session
    });

    expect(form.prompt.value).toBe([
      "Codex needs these details:",
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n"));
    expect(form.fields.value.map((field) => field.name)).toEqual(["response"]);
  });

  it("keeps display-only review fields out of editable fields but submits their values", async () => {
    let submittedInput = null;
    const session = ref({
      currentStep: "seed_application_defined",
      presentation: {
        screen: {
          input: {
            fields: [
              {
                displayOnly: true,
                kind: "text",
                label: "Seed title",
                name: "title",
                required: true,
                value: "Root Notes"
              },
              {
                displayOnly: true,
                kind: "text",
                label: "Session label",
                name: "word",
                required: true,
                value: "rootnotes"
              },
              {
                displayOnly: true,
                kind: "textarea",
                label: "Seed description",
                name: "body",
                required: true,
                value: "Simple plan.\n\n<details>\n<summary>Technical details</summary>\nUse localStorage.\n</details>"
              }
            ],
            prompt: "Review the seed details, then continue.",
            submitKind: "confirm_files",
            submitTarget: "current-step-input"
          }
        }
      },
      sessionId: "seed-session",
      stepMachine: {
        status: "confirm_files"
      }
    });
    const form = stepInputForm({
      session,
      submitCurrentStepInput: async (_sessionId, input) => {
        submittedInput = input;
        return {
          ok: true
        };
      }
    });

    expect(form.visible.value).toBe(true);
    expect(form.fields.value).toEqual([]);
    expect(form.displayFields.value.map((field) => field.name)).toEqual(["title", "word", "body"]);
    expect(form.canSubmit.value).toBe(true);

    expect(await form.submit()).toBe(true);
    expect(submittedInput).toMatchObject({
      fields: {
        body: "Simple plan.\n\n<details>\n<summary>Technical details</summary>\nUse localStorage.\n</details>",
        title: "Root Notes",
        word: "rootnotes"
      },
      kind: "confirm_files",
      source: "ui",
      stepId: "seed_application_defined",
      stepStatus: "confirm_files"
    });
  });

  it("refreshes without surfacing a save error when current-step input is stale", async () => {
    const onSaved = vi.fn(async () => null);
    const session = ref(promptResponseSession("Continue?"));
    const form = stepInputForm({
      onSaved,
      session,
      submitCurrentStepInput: async () => ({
        code: "vibe64_step_input_state_changed",
        error: "Reload state.",
        ok: false,
        operationOutcome: "stale_operation",
        refreshRecommended: true,
        status: 409
      })
    });

    form.updateValue("response", "Yes");

    expect(await form.submit()).toBe(false);
    expect(form.error.value).toBe("");
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      code: "vibe64_step_input_state_changed",
      ok: false,
      stale: true
    }));
  });
});
