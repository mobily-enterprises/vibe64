import { describe, expect, it } from "vitest";

import {
  parseLongTextInlineParts,
  parseLongTextReviewBlocks
} from "../../src/lib/studioLongTextBlocks.js";

describe("Studio long text review blocks", () => {
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
