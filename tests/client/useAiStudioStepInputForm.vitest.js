import { ref } from "vue";
import { describe, expect, it } from "vitest";

import {
  useAiStudioStepInputForm
} from "../../src/composables/useAiStudioStepInputForm.js";

function promptResponseSession(prompt) {
  return {
    currentStep: "plan_executed",
    currentStepDefinition: {
      interaction: {
        fields: [
          {
            kind: "textarea",
            label: "Response",
            name: "response",
            required: true
          }
        ],
        prompt,
        submitKind: "user_response"
      }
    },
    sessionId: "session-1",
    stepMachine: {
      status: "need_input"
    }
  };
}

describe("useAiStudioStepInputForm", () => {
  it("renders numbered prompt questions as separate inputs and submits one text response", async () => {
    let submittedInput = null;
    const session = ref(promptResponseSession([
      "[1] What filename should I create?",
      "[2] What contents should it have?"
    ].join("\n")));
    const form = useAiStudioStepInputForm({
      session,
      submitCurrentStepInput: async (_sessionId, input) => {
        submittedInput = input;
        return {
          ok: true
        };
      }
    });

    expect(form.prompt.value).toBe("");
    expect(form.fields.value.map((field) => field.name)).toEqual(["question_1", "question_2"]);
    expect(form.fields.value.map((field) => field.label)).toEqual([
      "What filename should I create?",
      "What contents should it have?"
    ]);

    form.updateValue("question_1", "p.txt");
    form.updateValue("question_2", "hello");

    expect(await form.submit()).toBe(true);
    expect(submittedInput).toMatchObject({
      fields: {
        response: "[1] p.txt\n[2] hello"
      },
      kind: "user_response",
      source: "ui",
      stepId: "plan_executed",
      stepStatus: "need_input"
    });
  });

  it("keeps the normal response textarea when the prompt is not a clean question list", () => {
    const session = ref(promptResponseSession("What should happen next?"));
    const form = useAiStudioStepInputForm({
      session
    });

    expect(form.prompt.value).toBe("What should happen next?");
    expect(form.fields.value).toHaveLength(1);
    expect(form.fields.value[0].name).toBe("response");
  });

  it("keeps introductory text above numbered question fields", () => {
    const session = ref(promptResponseSession([
      "Codex needs these details:",
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n")));
    const form = useAiStudioStepInputForm({
      session
    });

    expect(form.prompt.value).toBe("Codex needs these details:");
    expect(form.fields.value.map((field) => field.label)).toEqual([
      "Which file should change?",
      "What should it contain?"
    ]);
  });
});
