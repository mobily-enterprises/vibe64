import { describe, expect, it } from "vitest";

import {
  diffSectionStatusLabel,
  filterDiffSections,
  sessionDiffSections
} from "../../src/lib/vibe64SessionDiffView.js";

describe("Vibe64 session diff view", () => {
  it("splits a combined session diff into file sections", () => {
    const sections = sessionDiffSections({
      stagedDiff: `diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,2 +1,2 @@
-old
+new
 same`,
      untrackedDiff: `diff --git a/TODO.md b/TODO.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/TODO.md
@@ -0,0 +1,2 @@
+one
+two`
    });

    expect(sections).toMatchObject([
      {
        added: 1,
        path: "src/app.js",
        removed: 1,
        stage: "staged",
        stageLabel: "Staged",
        status: "modified"
      },
      {
        added: 2,
        path: "TODO.md",
        removed: 0,
        stage: "untracked",
        stageLabel: "Untracked",
        status: "added"
      }
    ]);
  });

  it("marks large sections before the UI attempts expensive rendering", () => {
    const largeDiff = [
      "diff --git a/big.txt b/big.txt",
      "--- a/big.txt",
      "+++ b/big.txt",
      "@@ -1,1 +1,1 @@",
      ...Array.from({ length: 1_900 }, (_, index) => `+line ${index}`)
    ].join("\n");

    expect(sessionDiffSections({
      unstagedDiff: largeDiff
    })[0].large).toBe(true);
  });

  it("filters sections by path, stage, or status label", () => {
    const sections = sessionDiffSections({
      unstagedDiff: `diff --git a/src/app.js b/src/app.js
deleted file mode 100644
--- a/src/app.js
+++ /dev/null
@@ -1 +0,0 @@
-gone`
    });

    expect(filterDiffSections(sections, "app")).toHaveLength(1);
    expect(filterDiffSections(sections, "unstaged")).toHaveLength(1);
    expect(filterDiffSections(sections, "deleted")).toHaveLength(1);
    expect(filterDiffSections(sections, "missing")).toHaveLength(0);
    expect(diffSectionStatusLabel(sections[0].status)).toBe("Deleted");
  });
});
