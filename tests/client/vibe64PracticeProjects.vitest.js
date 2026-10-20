import fs from "node:fs";
import * as Vue from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resources: [] }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource(options) {
    const resource = { options, data: Vue.ref(null), loadError: Vue.ref(""), reload: vi.fn(async () => null) };
    mocks.resources.push(resource);
    return resource;
  }
}));

import { practiceListFromResult, useVibe64PracticeProjects } from "../../src/composables/useVibe64PracticeProjects.js";
import { isPracticeProjectSlug, projectDisplayName } from "../../src/lib/vibe64PracticeProjectName.js";

const PRACTICE = "12345678-1234-4234-8234-123456789abc";
const listed = { ok: true,
  projects: [
    { practiceId: PRACTICE, slug: "training-x", lesson: { code: "V64-START-02", title: "First change" }, status: "in-progress", createdAt: "2026-10-20T09:00:00.000Z" },
    { practiceId: "p2", slug: "training-y", lesson: { code: "V64-START-03" }, status: "finished", deleting: true },
    { practiceId: "", slug: "training-z", lesson: {}, status: "finished" }
  ],
  archived: [{ practiceId: "p3", archiveId: "20261020T101500Z-training-w", lesson: { code: "V64-START-01", title: "Orientation" }, archivedAt: "2026-10-20T10:15:00.000Z" },
    { practiceId: "p4", lesson: {} }] };

describe("practice projects in the learning space", () => {
  afterEach(() => { mocks.resources.length = 0; });

  it("lists practice.list projects by lesson and status, and archived ones by lesson and date", () => {
    expect(practiceListFromResult(listed)).toEqual({
      projects: [
        { practiceId: PRACTICE, slug: "training-x", name: "Practice: First change", status: "in-progress", statusLabel: "In progress" },
        // An interrupted deletion offers only Delete.
        { practiceId: "p2", slug: "training-y", name: "Practice: V64-START-03", status: "deleting", statusLabel: "Being deleted" }
      ],
      archived: [{ practiceId: "p3", archiveId: "20261020T101500Z-training-w", name: "Practice: Orientation", archivedAt: "2026-10-20T10:15:00.000Z" }]
    });
    expect(practiceListFromResult({ ok: false })).toEqual({ projects: [], archived: [] });
  });

  it("retries an unconfirmed open with the same request ID and uses a new one after a confirmed open", async () => {
    const scope = Vue.effectScope();
    const request = vi.fn().mockRejectedValueOnce(new Error("ack lost")).mockResolvedValue({ ok: true, attempt: { attemptId: "a2" } });
    const practice = scope.run(() => useVibe64PracticeProjects({ enabled: true, request }));
    mocks.resources[0].data.value = listed;
    const [project] = practice.projects.value;
    expect(await practice.open(project, { expectedRevision: 4 })).toBeNull();
    expect(practice.error.value).toBe("ack lost");
    await practice.open(project, { expectedRevision: 4 });
    await practice.open(project, { expectedRevision: 5 });
    const ids = request.mock.calls.map(([, options]) => options.body.requestId);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
    scope.stop();
  });

  it("opens, archives and deletes through the practice actions, one at a time, and rereads the list", async () => {
    const scope = Vue.effectScope();
    const calls = [];
    let release;
    const request = vi.fn((url, options) => { calls.push({ url, ...options }); return new Promise(resolve => { release = resolve; }); });
    const practice = scope.run(() => useVibe64PracticeProjects({ enabled: true, request }));
    const [resource] = mocks.resources;
    expect(resource.options.path).toBe("/api/vibe64/training/practice");
    expect(resource.options.realtime.event).toBe("vibe64.training.learner.changed");
    expect(resource.options.realtime.matches({ payload: { reason: "notes" } }), "notes never touch a practice project").toBe(false);
    resource.data.value = listed;
    const [project] = practice.projects.value;
    const archived = practice.archived.value[0];

    const opening = practice.open(project, { expectedRevision: 4 });
    expect(practice.busy.value).toBe(`open:${PRACTICE}`);
    expect(await practice.archive(project), "one action at a time").toBeNull();
    release({ ok: true, attempt: { attemptId: "a2" } });
    expect(await opening).toEqual({ ok: true, attempt: { attemptId: "a2" } });
    for (const [run, result] of [[() => practice.archive(project), { ok: true }], [() => practice.remove(project), { ok: true }],
      [() => practice.removeArchive(archived), { ok: true }]]) {
      const pending = run();
      release(result);
      await pending;
    }
    expect(calls).toEqual([
      { url: `/api/vibe64/training/practice/${PRACTICE}/open`, method: "POST", body: { requestId: expect.any(String), expectedRevision: 4 } },
      { url: `/api/vibe64/training/practice/${PRACTICE}/archive`, method: "POST", body: {} },
      { url: `/api/vibe64/training/practice/${PRACTICE}/delete`, method: "POST", body: {} },
      { url: "/api/vibe64/training/practice/p3/archives/20261020T101500Z-training-w/delete", method: "POST", body: {} }
    ]);
    expect(resource.reload).toHaveBeenCalledTimes(4);
    expect(practice.busy.value).toBe("");

    const refused = practice.remove(project);
    release({ ok: false, error: "This practice project is in use." });
    expect(await refused).toBeNull();
    expect(practice.error.value).toBe("This practice project is in use.");
    scope.stop();
  });

  it("stays empty and reads nothing when disabled", () => {
    const scope = Vue.effectScope();
    const practice = scope.run(() => useVibe64PracticeProjects({ enabled: false }));
    mocks.resources[0].data.value = listed;
    expect(mocks.resources[0].options.enabled.value).toBe(false);
    expect(practice.projects.value).toEqual([]);
    expect(practice.archived.value).toEqual([]);
    scope.stop();
  });
});

describe("practice project display name", () => {
  const slug = `training-${"0123456789abcdef".repeat(2)}`;

  it("names a practice project by its lesson, keeps ordinary slugs and never shows the training slug", () => {
    expect(isPracticeProjectSlug(slug)).toBe(true);
    expect(isPracticeProjectSlug("training-notes")).toBe(false);
    expect(projectDisplayName({ slug: "my-app" })).toBe("my-app");
    expect(projectDisplayName({ slug: "training-notes" })).toBe("training-notes");
    expect(projectDisplayName({ slug, practice: { attemptId: "a", lessonCode: "V64-START-02" } })).toBe("Practice: V64-START-02");
    expect(projectDisplayName({ slug, practice: { lessonCode: "V64-START-02" } }, { lessonTitle: "First change" }))
      .toBe("Practice: First change");
    // A local practice project has no listed record: its slug alone still names it as practice.
    expect(projectDisplayName({ slug })).toBe("Practice project");
    expect(projectDisplayName({ slug }, { lessonTitle: "First change" })).toBe("Practice: First change");
  });
});

describe("project picker", () => {
  it("has no Practice section: practice projects live only in L's Practice tab", () => {
    const source = fs.readFileSync(new URL("../../src/components/studio/ProjectSelectionGate.vue", import.meta.url), "utf8");
    expect(source).not.toMatch(/practiceProjects|showPractice|data-practice-slug|deletePracticeProject/u);
  });
});
