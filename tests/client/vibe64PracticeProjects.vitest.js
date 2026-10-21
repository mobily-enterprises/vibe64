import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VIBE64_LEARNING_ROUTES, createVibe64Learning, normalizePractice } from "../../src/lib/vibe64Learning.js";
import { isPracticeProjectSlug, projectDisplayName } from "../../src/lib/vibe64PracticeProjectName.js";

const CURRENT = "12345678-1234-4234-8234-123456789abc";
const listed = { ok: true,
  current: { attemptId: CURRENT, slug: "training-x", lesson: { code: "V64-START-02", title: "First change" }, status: "in-progress" },
  archived: [
    { attemptId: "a1", lesson: { code: "V64-START-01", title: "Orientation" }, reason: "finished", archivedAt: "2026-10-20T10:15:00.000Z", hasProject: true },
    { attemptId: "a0", lesson: { code: "V64-START-00" }, reason: "archived", archivedAt: "2026-10-19T08:00:00.000Z", hasProject: false },
    { lesson: {} }] };

describe("the lesson in progress and the archived lessons (practice.list)", () => {
  it("lists one current row with its practice project and the archived lessons by lesson, reason and date", () => {
    expect(normalizePractice(listed)).toEqual({ loaded: true,
      current: { attemptId: CURRENT, name: "First change", projectName: "Practice: First change", slug: "training-x", status: "in-progress" },
      archived: [
        { attemptId: "a1", name: "Orientation", reason: "finished", archivedAt: "2026-10-20T10:15:00.000Z", hasProject: true },
        { attemptId: "a0", name: "V64-START-00", reason: "archived", archivedAt: "2026-10-19T08:00:00.000Z", hasProject: false }
      ] });
    // Lesson 0 has no practice project; an interrupted deletion is listed as deleting.
    expect(normalizePractice({ ok: true, current: { attemptId: CURRENT, lesson: { code: "V64-START-00", title: "Set yourself up" }, status: "deleting" }, archived: [] }).current)
      .toEqual({ attemptId: CURRENT, name: "Set yourself up", projectName: "", slug: "", status: "deleting" });
    expect(normalizePractice({ ok: true, current: null })).toMatchObject({ current: null, archived: [], loaded: true });
    expect(normalizePractice({ ok: false })).toMatchObject({ current: null, archived: [], loaded: false });
  });

  it("reads the list through the controller, rereads it on a learner change once read, and keeps one person's list", async () => {
    let result = listed;
    const reads = [];
    const request = vi.fn(async url => {
      if (url === VIBE64_LEARNING_ROUTES.practice) { reads.push(url); return result; }
      if (url.includes("/learning-mode")) return { ok: true, available: true, learningMode: { on: true, currentAttemptId: CURRENT, practiceSlug: "training-x" } };
      return { ok: true, available: true, lesson: { steps: [] }, results: [] };
    });
    const learning = createVibe64Learning({ request });
    expect(learning.practice.loaded).toBe(false);
    learning.setViewer("member");
    await learning.readPractice();
    expect(learning.practice.current.attemptId).toBe(CURRENT);
    result = { ok: true, current: null, archived: [] };
    learning.learnerChanged({ reason: "practice" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reads).toHaveLength(2);
    expect(learning.practice.current).toBeNull();
    learning.learnerChanged({ reason: "notes" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reads, "a notes change touches no lesson").toHaveLength(2);
    learning.setViewer("someone-else");
    expect(learning.practice.loaded).toBe(false);
  });
});

describe("practice project display name", () => {
  const slug = `training-${"0123456789abcdef".repeat(2)}`;

  it("names a practice project by its lesson, keeps ordinary slugs and never shows the training slug", () => {
    expect(isPracticeProjectSlug(slug)).toBe(true);
    expect(isPracticeProjectSlug("training-notes")).toBe(false);
    expect(projectDisplayName({ slug: "my-app" })).toBe("my-app");
    expect(projectDisplayName({ slug: "training-notes" })).toBe("training-notes");
    // The slug alone names a practice project as practice (no catalogue marker); the lesson title completes it.
    expect(projectDisplayName({ slug: "my-app", practice: { lessonCode: "V64-START-02" } })).toBe("my-app");
    expect(projectDisplayName({ slug })).toBe("Practice project");
    expect(projectDisplayName({ slug }, { lessonTitle: "First change" })).toBe("Practice: First change");
  });
});

describe("project picker", () => {
  it("has no Practice section: practice projects live only in Courses → In progress and Archived", () => {
    const source = fs.readFileSync(new URL("../../src/components/studio/ProjectSelectionGate.vue", import.meta.url), "utf8");
    expect(source).not.toMatch(/practiceProjects|showPractice|data-practice-slug|deletePracticeProject/u);
  });
});
