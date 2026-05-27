import { ref } from "vue";
import { describe, expect, it } from "vitest";

import {
  useVibe64StepInputForm
} from "../../src/composables/useVibe64StepInputForm.js";

function promptResponseSession(prompt) {
  return {
    currentStep: "plan_executed",
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
    const form = useVibe64StepInputForm({
      session
    });

    expect(form.visible.value).toBe(false);
  });

  it("renders numbered prompt questions as separate inputs and submits one text response", async () => {
    let submittedInput = null;
    const session = ref(promptResponseSession([
      "[1] What filename should I create?",
      "[2] What contents should it have?"
    ].join("\n")));
    const form = useVibe64StepInputForm({
      session,
      submitCurrentStepInput: async (_sessionId, input) => {
        submittedInput = input;
        return {
          ok: true
        };
      }
    });

    expect(form.prompt.value).toBe("");
    expect(form.fields.value.map((field) => field.name)).toEqual(["__ui_question_1", "__ui_question_2"]);
    expect(form.fields.value.map((field) => field.label)).toEqual([
      "What filename should I create?",
      "What contents should it have?"
    ]);

    form.updateValue("__ui_question_1", "p.txt");
    form.updateValue("__ui_question_2", "hello");

    expect(await form.submit()).toBe(true);
    expect(Object.keys(submittedInput.fields)).toEqual(["response"]);
    expect(submittedInput.fields).not.toHaveProperty("__ui_question_1");
    expect(submittedInput.fields).not.toHaveProperty("__ui_question_2");
    expect(submittedInput).toMatchObject({
      fields: {
        response: "[1] p.txt\n[2] hello"
      },
      kind: "user_response",
      source: "ui",
      stepId: "plan_executed",
      stepStatus: "waiting_for_input"
    });
  });

  it("keeps the normal response textarea when the prompt is not a clean question list", () => {
    const session = ref(promptResponseSession("What should happen next?"));
    const form = useVibe64StepInputForm({
      session
    });

    expect(form.prompt.value).toBe("What should happen next?");
    expect(form.fields.value).toHaveLength(1);
    expect(form.fields.value[0].name).toBe("response");
  });

  it("only applies numbered question sugar to a single plain response field", () => {
    const session = ref({
      currentStep: "plan_executed",
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
    const form = useVibe64StepInputForm({
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
    const form = useVibe64StepInputForm({
      session
    });

    expect(form.prompt.value).toBe([
      "[1] What filename should I create?",
      "[3] What contents should it have?"
    ].join("\n"));
    expect(form.fields.value.map((field) => field.name)).toEqual(["response"]);
  });

  it("keeps introductory text above numbered question fields", () => {
    const session = ref(promptResponseSession([
      "Codex needs these details:",
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n")));
    const form = useVibe64StepInputForm({
      session
    });

    expect(form.prompt.value).toBe("Codex needs these details:");
    expect(form.fields.value.map((field) => field.label)).toEqual([
      "Which file should change?",
      "What should it contain?"
    ]);
  });
});
