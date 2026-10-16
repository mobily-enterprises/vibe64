import { describe, expect, it } from "vitest";
import emptyHeaderTable from "../fixtures/assistantEmptyHeaderTable.json";

import {
  parseLongTextInlineParts,
  parseLongTextReviewBlocks
} from "@jskit-ai/assistant-core/shared/conversation";

describe("Studio long text review blocks", () => {
  it("preserves paragraphs and wrapped bullet text from authored Markdown", () => {
    expect(parseLongTextReviewBlocks([
      "First paragraph.", "", "Second paragraph with **emphasis**.", "",
      "- Keep this responsibility", "  with its continued line.",
      "- Keep [the explanation](program/forms.md)", "with a lazy continuation.", "",
      "A separate paragraph.", "", "1. First step", "   continued here.", "2. Second step"
    ].join("\n"))).toEqual([
      { type: "paragraph", text: "First paragraph." },
      { type: "paragraph", text: "Second paragraph with **emphasis**." },
      { type: "ul", items: [
        { text: "Keep this responsibility with its continued line." },
        { text: "Keep [the explanation](program/forms.md) with a lazy continuation." }
      ] },
      { type: "paragraph", text: "A separate paragraph." },
      { type: "ol", items: [{ text: "First step continued here." }, { text: "Second step" }] }
    ]);
  });

  it("parses headings, paragraphs, lists, and code blocks", () => {
    expect(parseLongTextReviewBlocks([
      "# Title",
      "",
      "First paragraph line",
      "continues here.",
      "",
      "- One",
      "- Two",
      "",
      "1. First",
      "2. Second",
      "",
      "```",
      "const value = 1;",
      "```"
    ].join("\n"))).toEqual([
      {
        level: 1,
        text: "Title",
        type: "heading"
      },
      {
        text: "First paragraph line continues here.",
        type: "paragraph"
      },
      {
        items: [
          { text: "One" },
          { text: "Two" }
        ],
        type: "ul"
      },
      {
        items: [
          { text: "First" },
          { text: "Second" }
        ],
        type: "ol"
      },
      {
        text: "const value = 1;",
        type: "code"
      }
    ]);
  });

  it("flushes an unclosed code block at the end of the review text", () => {
    expect(parseLongTextReviewBlocks("```\nline one\nline two\n")).toEqual([
      {
        text: "line one\nline two",
        type: "code"
      }
    ]);
  });

  it("parses collapsed details blocks without rendering raw HTML", () => {
    expect(parseLongTextReviewBlocks([
      "## Proposed plan",
      "",
      "- Keep it simple.",
      "",
      "<details>",
      "<summary>Technical plan</summary>",
      "",
      "1. Inspect files.",
      "2. Patch runtime.",
      "",
      "</details>"
    ].join("\n"))).toEqual([
      {
        level: 2,
        text: "Proposed plan",
        type: "heading"
      },
      {
        items: [
          { text: "Keep it simple." }
        ],
        type: "ul"
      },
      {
        blocks: [
          {
            items: [
              { text: "Inspect files." },
              { text: "Patch runtime." }
            ],
            type: "ol"
          }
        ],
        summary: "Technical plan",
        type: "details"
      }
    ]);
  });

  it("parses compact details summary openings without rendering raw HTML", () => {
    expect(parseLongTextReviewBlocks([
      "Simple proposal.",
      "",
      "<details><summary>Technical details</summary>",
      "- Use localStorage.",
      "</details>"
    ].join("\n"))).toEqual([
      {
        text: "Simple proposal.",
        type: "paragraph"
      },
      {
        blocks: [
          {
            items: [
              { text: "Use localStorage." }
            ],
            type: "ul"
          }
        ],
        summary: "Technical details",
        type: "details"
      }
    ]);
  });

  it("parses one-line collapsed details blocks without rendering raw HTML", () => {
    expect(parseLongTextReviewBlocks(
      "<details><summary>Technical details</summary>Use localStorage.</details>"
    )).toEqual([
      {
        blocks: [
          {
            text: "Use localStorage.",
            type: "paragraph"
          }
        ],
        summary: "Technical details",
        type: "details"
      }
    ]);
  });

  it("keeps separate lists when ordered and unordered markers are mixed", () => {
    expect(parseLongTextReviewBlocks("- Unordered\n1. Ordered")).toEqual([
      {
        items: [
          { text: "Unordered" }
        ],
        type: "ul"
      },
      {
        items: [
          { text: "Ordered" }
        ],
        type: "ol"
      }
    ]);
  });

  it("parses point bullets as unordered lists", () => {
    expect(parseLongTextReviewBlocks("• First point\n• Second point")).toEqual([
      {
        items: [
          { text: "First point" },
          { text: "Second point" }
        ],
        type: "ul"
      }
    ]);
  });

  it("parses pipe tables with column alignment", () => {
    expect(parseLongTextReviewBlocks([
      "| Table | Rows | Role |",
      "| --- | ---: | --- |",
      "| users | 3 | JSKIT user mirror. |",
      "| assistant_config | 0 | Per-surface assistant config. |"
    ].join("\n"))).toEqual([
      {
        alignments: ["left", "right", "left"],
        headers: ["Table", "Rows", "Role"],
        rows: [
          ["users", "3", "JSKIT user mirror."],
          ["assistant_config", "0", "Per-surface assistant config."]
        ],
        type: "table"
      }
    ]);
  });

  it("renders the reported empty-header estimate as a table without flattening its rows", () => {
    const blocks = parseLongTextReviewBlocks(emptyHeaderTable.text);
    const table = blocks.find((block) => block.type === "table");
    expect(table).toMatchObject({
      headers: ["", ""],
      alignments: ["left", "left"],
      rows: [
        ["Main-owned open checks", "111 (the second session's 27 are separate)"],
        ["Mix", "Mostly browser and data proofs against V1, plus about 20 final acceptance checks"],
        ["S001-B1 so far", "About 3 hours and 60% done"],
        ["Typical heavy browser check", "2–4 hours each"],
        ["Faster checks", "Provider checks (now theory-only) and accepting the second session's evidence: 15–45 minutes each"],
        ["Total", "About 150–300 hours of continuous work, run strictly one check at a time"]
      ]
    });
    expect(blocks[0].text).toContain("My rough estimate is 2–4 weeks");
    expect(blocks.at(-1).text).toContain("1.5–2.5 weeks");
    expect(parseLongTextReviewBlocks("```markdown\n| | |\n|---|---|\n| a | b |\n```")).toEqual([
      { type: "code", text: "| | |\n|---|---|\n| a | b |" }
    ]);
    expect(parseLongTextReviewBlocks("| | |\n| ordinary | prose |").every((block) => block.type === "paragraph")).toBe(true);
  });

  it("parses compact single-line pipe tables from flattened chat text", () => {
    expect(parseLongTextReviewBlocks(
      "| Table | Rows | Role | | --- | ---: | --- | | users | 3 | JSKIT user mirror. | | user_settings | 2 | One settings row per user. |"
    )).toEqual([
      {
        alignments: ["left", "right", "left"],
        headers: ["Table", "Rows", "Role"],
        rows: [
          ["users", "3", "JSKIT user mirror."],
          ["user_settings", "2", "One settings row per user."]
        ],
        type: "table"
      }
    ]);
  });

  it("parses safe inline strong and code spans", () => {
    expect(parseLongTextInlineParts("For **6163** run `weather`.")).toEqual([
      {
        text: "For ",
        type: "text"
      },
      {
        text: "6163",
        type: "strong"
      },
      {
        text: " run ",
        type: "text"
      },
      {
        text: "weather",
        type: "code"
      },
      {
        text: ".",
        type: "text"
      }
    ]);
  });
});
