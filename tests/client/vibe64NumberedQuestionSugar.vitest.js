import { describe, expect, it } from "vitest";

import {
  canRenderNumberedQuestionSugar,
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSugarForMessageInput,
  numberedQuestionSugarForInput,
  parseNumberedQuestionPrompt,
  UI_QUESTION_FIELD_PREFIX
} from "../../src/lib/vibe64NumberedQuestionSugar.js";

const plainResponseField = {
  kind: "textarea",
  label: "Response",
  name: "response",
  required: true
};
const conversationRequestField = {
  kind: "textarea",
  label: "Message",
  name: "conversationRequest",
  required: true
};

function sugarForPrompt(prompt, fields = [plainResponseField]) {
  return numberedQuestionSugarForInput({
    prompt
  }, fields);
}

describe("vibe64NumberedQuestionSugar", () => {
  it("turns a clean numbered prompt into private UI-only fields", () => {
    const sugar = sugarForPrompt([
      "Codex needs these details:",
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n"));

    expect(sugar.intro).toBe("Codex needs these details:");
    expect(sugar.questions.map((question) => question.name)).toEqual([
      `${UI_QUESTION_FIELD_PREFIX}1`,
      `${UI_QUESTION_FIELD_PREFIX}2`
    ]);
    expect(numberedQuestionInputFields(sugar.questions)).toMatchObject([
      {
        kind: "text",
        name: "__ui_question_1"
      },
      {
        kind: "text",
        name: "__ui_question_2"
      }
    ]);
  });

  it("submits generated answers as one response field", () => {
    const sugar = sugarForPrompt([
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n"));

    expect(numberedQuestionSubmissionFields(sugar.questions, {
      __ui_question_1: "app.js",
      __ui_question_2: "use the existing helper"
    })).toEqual({
      response: "[1] app.js\n[2] use the existing helper"
    });
  });

  it("can submit generated answers into a single conversation message field", () => {
    const sugar = sugarForPrompt([
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n"));

    expect(numberedQuestionSubmissionFields(sugar.questions, {
      __ui_question_1: "app.js",
      __ui_question_2: "use the existing helper"
    }, "conversationRequest")).toEqual({
      conversationRequest: "[1] app.js\n[2] use the existing helper"
    });
  });

  it("uses one activation rule for direct response and conversation message inputs", () => {
    expect(canRenderNumberedQuestionSugar({
      fields: [plainResponseField],
      fieldName: "response"
    })).toBe(true);
    expect(canRenderNumberedQuestionSugar({
      fields: [conversationRequestField],
      fieldName: "conversationRequest",
      intentId: "talk_to_codex",
      requiredIntentId: "talk_to_codex",
      requiredStepStatus: "waiting_for_input",
      stepStatus: "waiting_for_input"
    })).toBe(true);
  });

  it("renders Autopilot conversation questions only for the expected one-message input", () => {
    const message = [
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n");

    expect(numberedQuestionSugarForMessageInput({
      fields: [conversationRequestField],
      fieldName: "conversationRequest",
      intentId: "talk_to_codex",
      message,
      requiredIntentId: "talk_to_codex",
      requiredStepStatus: "waiting_for_input",
      stepStatus: "waiting_for_input"
    }).questions.map((question) => question.name)).toEqual([
      "__ui_question_1",
      "__ui_question_2"
    ]);
  });

  it("does not render conversation questions for the wrong intent, status, or field shape", () => {
    const message = [
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n");
    const expectedContext = {
      fieldName: "conversationRequest",
      intentId: "talk_to_codex",
      message,
      requiredIntentId: "talk_to_codex",
      requiredStepStatus: "waiting_for_input",
      stepStatus: "waiting_for_input"
    };

    expect(numberedQuestionSugarForMessageInput({
      ...expectedContext,
      intentId: "review_diff",
      fields: [conversationRequestField]
    }).questions).toEqual([]);
    expect(numberedQuestionSugarForMessageInput({
      ...expectedContext,
      fields: [conversationRequestField],
      stepStatus: "ready"
    }).questions).toEqual([]);
    expect(numberedQuestionSugarForMessageInput({
      ...expectedContext,
      fields: [
        {
          kind: "text",
          label: "Title",
          name: "title"
        },
        conversationRequestField
      ]
    }).questions).toEqual([]);
  });

  it("parses Codex inline numbered question messages", () => {
    expect(parseNumberedQuestionPrompt([
      "[1] What outcome do you want from this session next?",
      "[2] Are you testing the conversation flow, or do you want project work?",
      "[3] Should I keep replies minimal, or include files changed and checks when relevant?"
    ].join(" "))).toMatchObject({
      intro: "",
      questions: [
        {
          label: "What outcome do you want from this session next?",
          number: 1
        },
        {
          label: "Are you testing the conversation flow, or do you want project work?",
          number: 2
        },
        {
          label: "Should I keep replies minimal, or include files changed and checks when relevant?",
          number: 3
        }
      ]
    });
  });

  it("parses Q-prefixed question markers from Codex helper prompts", () => {
    expect(parseNumberedQuestionPrompt([
      "Answer these before continuing.",
      "[Q1] Which file should change?",
      "[Q2] What should it contain?"
    ].join("\n"))).toMatchObject({
      intro: "Answer these before continuing.",
      questions: [
        {
          label: "Which file should change?",
          number: 1
        },
        {
          label: "What should it contain?",
          number: 2
        }
      ]
    });
  });

  it("does not reinterpret already structured server input", () => {
    const sugar = sugarForPrompt([
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n"), [
      {
        kind: "text",
        label: "Title",
        name: "title"
      },
      plainResponseField
    ]);

    expect(sugar.questions).toEqual([]);
  });

  it("rejects ambiguous numbered prompts", () => {
    expect(sugarForPrompt([
      "[1] Which file should change?",
      "[3] What should it contain?"
    ].join("\n")).questions).toEqual([]);
    expect(sugarForPrompt([
      "[01] Which file should change?",
      "[2] What should it contain?"
    ].join("\n")).questions).toEqual([]);
    expect(sugarForPrompt([
      "[1] Which file should change?",
      "Then explain why.",
      "[2] What should it contain?"
    ].join("\n")).questions).toEqual([]);
  });
});
