import { describe, expect, it } from "vitest";

import {
  buildResolveDeslopFindingsPrompt,
  deslopFindingsByPriority,
  parseDeslopResult
} from "../../src/lib/deslopResult.js";

const resolvePromptTemplate = [
  "Resolve selected findings.",
  "",
  "[resolve_deslop_findings]",
  "{{findings}}",
  "[/resolve_deslop_findings]"
].join("\n");

describe("deslop result parsing", () => {
  it("parses the final conversational deslop result block", () => {
    const findings = parseDeslopResult([
      "The implementation is mostly sound.",
      "",
      "[deslop_result]",
      "priority: low",
      "category: copy",
      "title: Old finding",
      "reason: Ignore this earlier block.",
      "[/deslop_result]",
      "",
      "After another pass, two items remain.",
      "",
      "[deslop_result]",
      "priority: high",
      "category: bug",
      "title: Mobile nav cannot reach About",
      "files:",
      "- src/components/AppNav.vue",
      "reason: The desktop nav was updated but the mobile drawer was not.",
      "recommended_action: Add the route to the shared nav item source.",
      "",
      "priority: low",
      "category: content",
      "title: Placeholder copy is generic",
      "files:",
      "- src/pages/about.vue",
      "reason: The copy is acceptable for scaffolding.",
      "recommended_action: Ask the user before replacing it.",
      "[/deslop_result]"
    ].join("\n"));

    expect(findings).toEqual([
      {
        category: "bug",
        files: ["src/components/AppNav.vue"],
        id: "",
        priority: "high",
        reason: "The desktop nav was updated but the mobile drawer was not.",
        recommendedAction: "Add the route to the shared nav item source.",
        title: "Mobile nav cannot reach About"
      },
      {
        category: "content",
        files: ["src/pages/about.vue"],
        id: "",
        priority: "low",
        reason: "The copy is acceptable for scaffolding.",
        recommendedAction: "Ask the user before replacing it.",
        title: "Placeholder copy is generic"
      }
    ]);
  });

  it("filters high and medium findings for automatic resolution", () => {
    const findings = [
      { priority: "high", title: "Fix A" },
      { priority: "medium", title: "Fix B" },
      { priority: "low", title: "Maybe C" }
    ];

    expect(deslopFindingsByPriority(findings).map((finding) => finding.title))
      .toEqual(["Fix A", "Fix B"]);
  });

  it("can use the JSKIT-provided deslop marker name", () => {
    const findings = parseDeslopResult([
      "[review_result]",
      "priority: medium",
      "category: maintainability",
      "title: Remove duplication",
      "[/review_result]"
    ].join("\n"), "review_result");

    expect(findings).toEqual([
      expect.objectContaining({
        priority: "medium",
        title: "Remove duplication"
      })
    ]);
  });

  it("parses a low-priority no-op summary from Codex terminal output", () => {
    const findings = parseDeslopResult([
      "• [deslop_result]",
      "  priority: low",
      "  category: other",
      "  title: Stable minimal change remains unchanged",
      "  files:",
      "",
      "  - eight.txt",
      "    reason: The change stays a single file with exact literal content and no runtime/UI/JSKIT",
      "    workflow impact; no actionable defects were found.",
      "    recommended_action: No changes required unless another process rewrites eight.txt; rerun",
      "    exactness checks if the file is edited again.",
      "    [/deslop_result]"
    ].join("\n"));

    expect(findings).toEqual([
      {
        category: "other",
        files: ["eight.txt"],
        id: "",
        priority: "low",
        reason: "The change stays a single file with exact literal content and no runtime/UI/JSKIT\nworkflow impact; no actionable defects were found.",
        recommendedAction: "No changes required unless another process rewrites eight.txt; rerun\nexactness checks if the file is edited again.",
        title: "Stable minimal change remains unchanged"
      }
    ]);
  });

  it("parses a high-priority verification finding with wrapped shell text", () => {
    const findings = parseDeslopResult([
      "[deslop_result]",
      "  priority: high",
      "  category: verification",
      "  title: Simulated high-severity issue: strict content contract can be silently broken",
      "  files:",
      "",
      "  - eight.txt",
      "    reason: If content is edited by an external formatter, hidden whitespace/newline changes could",
      "    violate the exact eight requirement and still look visually correct.",
      "    recommended_action: Enforce a literal assertion step in workflow ([ \"$(cat eight.txt)\" =",
      "    \"eight\" ] && [ \"$(wc -c < eight.txt)\" -eq 5 ]) before handoff.",
      "    [/deslop_result]"
    ].join("\n"));

    expect(findings).toEqual([
      expect.objectContaining({
        category: "verification",
        files: ["eight.txt"],
        priority: "high",
        recommendedAction: "Enforce a literal assertion step in workflow ([ \"$(cat eight.txt)\" =\n\"eight\" ] && [ \"$(wc -c < eight.txt)\" -eq 5 ]) before handoff.",
        title: "Simulated high-severity issue: strict content contract can be silently broken"
      })
    ]);
  });

  it("builds a scoped resolve prompt for selected findings", () => {
    const prompt = buildResolveDeslopFindingsPrompt([
      {
        category: "bug",
        files: ["src/App.vue"],
        id: "D001",
        priority: "high",
        reason: "It breaks navigation.",
        recommendedAction: "Use the shared nav source.",
        title: "Navigation is inconsistent"
      }
    ], resolvePromptTemplate);

    expect(prompt).toContain("[resolve_deslop_findings]");
    expect(prompt).toContain("id: D001");
    expect(prompt).toContain("priority: high");
    expect(prompt).toContain("recommended_action: Use the shared nav source.");
  });
});
