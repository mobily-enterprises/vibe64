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
        label: "Which file should change?",
        name: "__ui_question_1"
      },
      {
        kind: "text",
        label: "What should it contain?",
        name: "__ui_question_2"
      }
    ]);
    expect(numberedQuestionInputFields(sugar.questions, {
      autocomplete: "off",
      density: "compact"
    })).toMatchObject([
      {
        autocomplete: "off",
        density: "compact",
        kind: "text",
        label: "Which file should change?",
        name: "__ui_question_1"
      },
      {
        autocomplete: "off",
        density: "compact",
        kind: "text",
        label: "What should it contain?",
        name: "__ui_question_2"
      }
    ]);
  });

  it("renders one explicitly numbered free-text question", () => {
    const sugar = sugarForPrompt([
      "Your message arrived as: “Is this code o,” so it seems incomplete.",
      "",
      "[1] Did you mean “Is this code okay?” or “Is this cool?”"
    ].join("\n"));

    expect(sugar).toEqual({
      intro: "Your message arrived as: “Is this code o,” so it seems incomplete.",
      outro: "",
      questions: [
        {
          choices: [],
          label: "Did you mean “Is this code okay?” or “Is this cool?”",
          name: "__ui_question_1",
          number: 1
        }
      ]
    });
    expect(parseNumberedQuestionPrompt("[1] Should I continue?").questions).toMatchObject([
      {
        label: "Should I continue?",
        number: 1
      }
    ]);
  });

  it.each(["\n\n", " "])("keeps explanatory sentences after question marks with separator %j", (separator) => {
    const labels = [
      "Should VIP status be checked **at checkout**, so an existing unpaid, uninvoiced booking receives the discount even if the owner became VIP after booking? Manual final-price overrides would still take precedence.",
      "During the **one-hour crate-drying gap**, should both washer and groomer be free to work on other dogs?",
      "What should happen if someone assigns a dog marked **“not suitable for trainees”** to a junior groomer or washer?"
    ];
    const sugar = parseNumberedQuestionPrompt([
      "Picking up the three unanswered questions:",
      ...labels.map((label, index) => `[${index + 1}] ${label}`)
    ].join(separator));

    expect(sugar.questions.map((question) => question.label)).toEqual(labels);
    expect(numberedQuestionInputFields(sugar.questions)).toHaveLength(3);
  });

  it("accepts a trailing possible-answers hint after numbered questions", () => {
    const sugar = sugarForPrompt([
      "I need confirmations before I start.",
      "",
      "[1] Should I apply the converted schema to the managed database?",
      "",
      "[2] What tracking filename do you want?",
      "",
      "[3] Do you want server-side scaffolding only, or generated CRUD UI pages too?",
      "",
      "Possible answers:",
      "- Use defaults: yes, use the managed DB; write dumps/schema-rename-map.txt; generate server-side repositories/API only.",
      "- Custom: provide your preferred database handling, tracking filename, and generator scope."
    ].join("\n"));

    expect(sugar.intro).toBe("I need confirmations before I start.");
    expect(sugar.questions.map((question) => question.label)).toEqual([
      "Should I apply the converted schema to the managed database?",
      "What tracking filename do you want?",
      "Do you want server-side scaffolding only, or generated CRUD UI pages too?"
    ]);
  });

  it("keeps the suggested answers attached to each numbered question", () => {
    const sugar = sugarForPrompt([
      "[1] Should lifecycle callbacks be included?",
      "Possible answers:",
      "- Yes, complete lifecycle (Recommended)",
      "- Sending adapters first",
      "[2] Are there existing files to migrate?",
      "Possible answers:",
      "- No existing files (Recommended)",
      "- Yes, migration required",
      "[3] Which communications should the first cut cover?",
      "Possible answers:",
      "- Transactional first (Recommended)",
      "- Transactional and marketing"
    ].join("\n"));

    expect(sugar.questions).toMatchObject([
      {
        choices: [
          { label: "Yes, complete lifecycle", recommended: true, value: "Yes, complete lifecycle" },
          { label: "Sending adapters first", recommended: false, value: "Sending adapters first" }
        ],
        label: "Should lifecycle callbacks be included?"
      },
      {
        choices: [
          { label: "No existing files", recommended: true, value: "No existing files" },
          { label: "Yes, migration required", recommended: false, value: "Yes, migration required" }
        ],
        label: "Are there existing files to migrate?"
      },
      {
        choices: [
          { label: "Transactional first", recommended: true, value: "Transactional first" },
          { label: "Transactional and marketing", recommended: false, value: "Transactional and marketing" }
        ],
        label: "Which communications should the first cut cover?"
      }
    ]);
  });

  it("renders choices for one explicitly numbered question", () => {
    const sugar = sugarForPrompt([
      "[1] Should I implement that complete template-management system?",
      "",
      "Possible answers:",
      "- Full editable templates (Recommended)",
      "- Central code templates only",
      "- Discuss the design first"
    ].join("\n"));

    expect(sugar.questions).toMatchObject([
      {
        choices: [
          {
            label: "Full editable templates",
            recommended: true,
            value: "Full editable templates"
          },
          {
            label: "Central code templates only",
            recommended: false,
            value: "Central code templates only"
          },
          {
            label: "Discuss the design first",
            recommended: false,
            value: "Discuss the design first"
          }
        ],
        label: "Should I implement that complete template-management system?",
        number: 1
      }
    ]);
  });

  it("preserves trailing prose after a complete structured question", () => {
    const sugar = sugarForPrompt([
      "The product direction is now captured.",
      "",
      "[1] Which database should hold the shared tasks?",
      "",
      "Possible answers:",
      "- PostgreSQL — recommended for connected team data",
      "- MySQL — use it if preferred",
      "",
      "The project setup command remains unavailable."
    ].join("\n"));

    expect(sugar).toMatchObject({
      intro: "The product direction is now captured.",
      outro: "The project setup command remains unavailable.",
      questions: [
        {
          choices: [
            {
              label: "PostgreSQL — recommended for connected team data",
              selectLabel: "PostgreSQL",
              value: "PostgreSQL — recommended for connected team data"
            },
            {
              label: "MySQL — use it if preferred",
              selectLabel: "MySQL",
              value: "MySQL — use it if preferred"
            }
          ],
          label: "Which database should hold the shared tasks?",
          number: 1
        }
      ]
    });
    expect(numberedQuestionSubmissionFields(sugar.questions, {
      __ui_question_1: sugar.questions[0].choices[0].value
    })).toEqual({
      response: "[1] PostgreSQL — recommended for connected team data"
    });
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
    expect(sugarForPrompt("See [1] the linked reference.").questions).toEqual([]);
    expect(sugarForPrompt("[1] Read https://example.com/docs?page=1").questions).toEqual([]);
  });

  it("keeps numbered recommendations with later answer choices out of question fields", () => {
    const sugar = sugarForPrompt([
      "Here are the strongest fits:",
      "[1] **JSKIT + Vue** — a modern interactive web stack.",
      "[2] **Laravel** — a full-featured PHP framework.",
      "[3] **Plain Node.js** — a minimal Node backend.",
      "[4] **Go** — a fast single-binary web server.",
      "A database can be added later.",
      "Possible answers:",
      "- `jskit` (Vue + Node, recommended)",
      "- `laravel` (PHP full-framework route)",
      "- `nodejs` (minimal, hands-on)",
      "- `go` (fast single-binary)",
      "Which one should I set up?"
    ].join("\n"));

    expect(sugar.questions).toEqual([]);
  });
});
