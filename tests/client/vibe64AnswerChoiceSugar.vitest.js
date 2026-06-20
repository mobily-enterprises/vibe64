import { describe, expect, it } from "vitest";

import {
  answerChoiceInputFields,
  answerChoiceSugarForMessageInput,
  parseAnswerChoicePrompt
} from "../../src/lib/vibe64AnswerChoiceSugar.js";

describe("vibe64AnswerChoiceSugar", () => {
  it("parses explicit possible-answer blocks with labels and submitted text", () => {
    const parsed = parseAnswerChoicePrompt([
      "Will people sign in with accounts?",
      "",
      "Possible answers:",
      "- Yes, users: I want people to sign in and have accounts.",
      "- No, no users: I do not want login for this app."
    ].join("\n"));

    expect(parsed.choices).toEqual([
      {
        label: "Yes, users",
        value: "I want people to sign in and have accounts."
      },
      {
        label: "No, no users",
        value: "I do not want login for this app."
      }
    ]);
  });

  it("parses parenthetical answer text without making random prose magical", () => {
    expect(parseAnswerChoicePrompt([
      "Choose one.",
      "Choices:",
      "- Yes, users (I want people to sign in and have accounts.)",
      "- No, no users (I do not want login for this app.)"
    ].join("\n")).choices).toEqual([
      {
        label: "Yes, users",
        value: "I want people to sign in and have accounts."
      },
      {
        label: "No, no users",
        value: "I do not want login for this app."
      }
    ]);

    expect(parseAnswerChoicePrompt("Yes or no?")).toEqual({
      choices: []
    });
    expect(parseAnswerChoicePrompt([
      "Possible answers:",
      "- Only one"
    ].join("\n"))).toEqual({
      choices: []
    });
    expect(parseAnswerChoicePrompt([
      "[1] Should people sign in?",
      "[2] Should this include AI?",
      "",
      "Possible answers:",
      "- Yes: Yes.",
      "- No: No."
    ].join("\n"))).toEqual({
      choices: []
    });
  });

  it("only activates for a single matching textarea message field", () => {
    const message = [
      "Choose.",
      "Possible answers:",
      "- A: Use A.",
      "- B: Use B."
    ].join("\n");

    expect(answerChoiceSugarForMessageInput({
      fieldName: "conversationRequest",
      fields: [
        {
          kind: "textarea",
          name: "conversationRequest"
        }
      ],
      message
    }).choices).toHaveLength(2);

    expect(answerChoiceSugarForMessageInput({
      fieldName: "conversationRequest",
      fields: [
        {
          kind: "text",
          name: "conversationRequest"
        }
      ],
      message
    })).toEqual({
      choices: []
    });
  });

  it("builds one pseudo field for the UI renderer", () => {
    expect(answerChoiceInputFields([
      {
        label: "A",
        value: "Use A."
      }
    ])).toEqual([
      {
        choices: [
          {
            label: "A",
            value: "Use A."
          }
        ],
        kind: "answer_choices",
        name: "__ui_answer_choice",
        required: false
      }
    ]);
  });
});
