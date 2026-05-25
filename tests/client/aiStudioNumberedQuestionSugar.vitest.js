import { describe, expect, it } from "vitest";

import {
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSugarForInput,
  parseNumberedQuestionPrompt,
  UI_QUESTION_FIELD_PREFIX
} from "../../src/lib/aiStudioNumberedQuestionSugar.js";

const plainResponseField = {
  kind: "textarea",
  label: "Response",
  name: "response",
  required: true
};

function sugarForPrompt(prompt, fields = [plainResponseField]) {
  return numberedQuestionSugarForInput({
    prompt
  }, fields);
}

describe("aiStudioNumberedQuestionSugar", () => {
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
