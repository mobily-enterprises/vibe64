import { describe, expect, it } from "vitest";

import {
  sourceSafetyButtonLabel,
  sourceSafetyMarkStyle,
  sourceSafetyDialogMessage,
  sourceSafetyPrompt,
  sourceSafetyStatusSummary,
  sourceSafetyStatusTitle
} from "../../src/lib/vibe64SessionSourceSafety.js";

describe("Vibe64 session source safety presentation", () => {
  it("uses commit-only language for local-source sessions", () => {
    const status = {
      changedFileCount: 2,
      repositoryMode: "local_source",
      requiresPush: false,
      unsafe: true
    };

    expect(sourceSafetyButtonLabel(status)).toBe("Commit");
    expect(sourceSafetyStatusTitle(status)).toContain("2 files not committed");
    expect(sourceSafetyStatusSummary(status)).toBe("2 files not committed");
    expect(sourceSafetyDialogMessage({
      ...status,
      changedFileCount: 1
    })).toContain("1 changed file still needs to be committed");
    expect(sourceSafetyDialogMessage(status)).toContain("Commit it before abandoning");
    expect(sourceSafetyPrompt(status)).toContain("Do not push");
    expect(sourceSafetyPrompt(status)).toContain("not a Vibe64 workflow step");
  });

  it("uses commit-and-push language for Git-backed sessions", () => {
    const status = {
      changedFileCount: 1,
      repositoryMode: "github",
      requiresPush: true,
      unpushedCommitCount: 3,
      unsafe: true
    };

    expect(sourceSafetyButtonLabel(status)).toBe("Commit & push");
    expect(sourceSafetyStatusTitle(status)).toContain("3 commits not pushed");
    expect(sourceSafetyDialogMessage(status)).toContain("Commit and push it before abandoning");
    expect(sourceSafetyPrompt(status)).toContain("never force-push");
    expect(sourceSafetyPrompt(status)).toContain("Do not change the workflow state");
  });

  it("moves the mark hue from yellow toward red as severity grows", () => {
    const yellow = sourceSafetyMarkStyle({
      severity: 0
    });
    const orange = sourceSafetyMarkStyle({
      severity: 50
    });
    const red = sourceSafetyMarkStyle({
      severity: 100
    });

    expect(yellow["--vibe64-source-safety-color"]).toContain("hsl(48 ");
    expect(orange["--vibe64-source-safety-color"]).toContain("hsl(24 ");
    expect(red["--vibe64-source-safety-color"]).toContain("hsl(0 ");
  });
});
