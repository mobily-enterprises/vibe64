import fs from "node:fs";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ commands: [], resources: [] }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource(options) {
    const resource = { options, data: Vue.ref(null), reload: vi.fn(async () => null) };
    mocks.resources.push(resource);
    return resource;
  }
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand(options) {
    const command = Vue.reactive({ options, messageType: "", message: "", calls: [],
      async run(context) {
        this.calls.push({ context, request: options.buildCommandOptions(null, { context }), body: options.buildRawPayload(null, { context }) });
        return { ok: true };
      } });
    mocks.commands.push(command);
    return command;
  }
}));

import { practiceProjectsFromLearning, useVibe64PracticeProjects } from "../../src/composables/useVibe64PracticeProjects.js";
import { isPracticeProjectSlug, projectDisplayName } from "../../src/lib/vibe64PracticeProjectName.js";

const attempt = (attemptId, practiceSlug, extra = {}) => ({ attemptId, practiceSlug, pin: { lesson: { code: "V64-START-02" } }, ...extra });

describe("practice projects from the learner's saved lessons", () => {
  afterEach(() => { mocks.commands.length = 0; mocks.resources.length = 0; });

  it("lists only attempts that still have a practice project, once each", () => {
    expect(practiceProjectsFromLearning({ ok: true, available: true, attempts: [
      attempt("a1", "training-a1"), attempt("a2", ""), attempt("a3", "training-a1"), attempt("a4", "training-a4", { ended: { reason: "restart" } })
    ] })).toEqual([
      { slug: "training-a1", attemptId: "a1", lessonCode: "V64-START-02", lessonTitle: "", name: "Practice: V64-START-02", ended: false, mine: true, deleteAvailable: true },
      { slug: "training-a4", attemptId: "a4", lessonCode: "V64-START-02", lessonTitle: "", name: "Practice: V64-START-02", ended: true, mine: true, deleteAvailable: true }
    ]);
    // A server without the v2 attempts list (and so without practice.delete) offers no rows or deletes.
    expect(practiceProjectsFromLearning({ ok: true, available: true, active: attempt("b1", "training-b1"),
      history: [attempt("b2", "training-b2")] })).toEqual([]);
    expect(practiceProjectsFromLearning({ ok: false })).toEqual([]);
    expect(practiceProjectsFromLearning({ ok: true, available: false, attempts: [attempt("c", "training-c")] })).toEqual([]);
  });

  it("names each practice project by its lesson title from courses.list, else its lesson code", () => {
    const courses = { ok: true, courses: [{ lessons: [{ code: "V64-START-02", hash: "h2", title: "First change" },
      { code: "V64-START-03", hash: "h3", title: "Second change" }] }] };
    const rows = practiceProjectsFromLearning({ ok: true, available: true, attempts: [
      attempt("a1", "training-a1", { pin: { lesson: { code: "V64-START-02", hash: "h2" } } }),
      attempt("a2", "training-a2", { pin: { lesson: { code: "V64-START-03", hash: "other-release" } } }),
      attempt("a3", "training-a3", { pin: { lesson: {} } })
    ] }, courses);
    expect(rows.map(row => [row.slug, row.lessonTitle, row.name])).toEqual([
      ["training-a1", "First change", "Practice: First change"],
      ["training-a2", "", "Practice: V64-START-03"],
      ["training-a3", "", "Practice project"]
    ]);
  });

  it("deletes the learner's own practice project with one request and rereads the list", async () => {
    const scope = Vue.effectScope();
    const practice = scope.run(() => useVibe64PracticeProjects({ enabled: true }));
    const [resource] = mocks.resources;
    expect(resource.options.path).toBe("/api/vibe64/training/learning");
    expect(resource.options.realtime.events).toEqual(["vibe64.training.learner.changed", "vibe64.project.changed"]);
    resource.data.value = { ok: true, available: true, attempts: [attempt("12345678-1234-4234-8234-123456789abc", "training-x")] };
    expect(practice.practiceProjects.value).toHaveLength(1);
    expect(await practice.deletePracticeProject(practice.practiceProjects.value[0])).toBe(true);
    const [command] = mocks.commands;
    expect(command.calls).toEqual([{ context: { attemptId: "12345678-1234-4234-8234-123456789abc" },
      request: { method: "POST", path: "/api/vibe64/training/attempts/12345678-1234-4234-8234-123456789abc/practice/delete" }, body: {} }]);
    expect(command.options.messages.success).toBe("Practice project deleted.");
    expect(resource.reload).toHaveBeenCalledTimes(1);
    expect(practice.deletingSlug.value).toBe("");
    expect(await practice.deletePracticeProject({ ...practice.practiceProjects.value[0], deleteAvailable: false })).toBe(false);
    expect(command.calls).toHaveLength(1);
    scope.stop();
  });

  it("reuses L's own learning.read resource instead of reading again", async () => {
    const scope = Vue.effectScope();
    const learningResource = { data: Vue.ref({ ok: true, available: true, attempts: [attempt("12345678-1234-4234-8234-123456789abc", "training-l")] }),
      reload: vi.fn(async () => null) };
    const practice = scope.run(() => useVibe64PracticeProjects({ enabled: true, learningResource }));
    expect(mocks.resources).toHaveLength(0);
    expect(practice.practiceProjects.value.map(value => value.slug)).toEqual(["training-l"]);
    expect(await practice.deletePracticeProject(practice.practiceProjects.value[0])).toBe(true);
    expect(learningResource.reload).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("stays empty and reads nothing when disabled", () => {
    const scope = Vue.effectScope();
    const practice = scope.run(() => useVibe64PracticeProjects({ enabled: false }));
    mocks.resources[0].data.value = { ok: true, available: true, attempts: [attempt("a", "training-a")] };
    expect(mocks.resources[0].options.enabled.value).toBe(false);
    expect(practice.practiceProjects.value).toEqual([]);
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

describe("project picker Practice section", () => {
  it("lists practice projects separately, opens them and deletes only the learner's own, where its host offers delete, with one click", async () => {
    const deletePracticeProject = vi.fn(async () => true);
    const filename = new URL("../../src/components/studio/ProjectSelectionGate.vue", import.meta.url).pathname;
    const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
    const script = compileScript(descriptor, { id: "practice-gate" });
    const { code } = compile(descriptor.template.content, { mode: "function", prefixIdentifiers: true, bindingMetadata: script.bindings });
    const render = new Function("Vue", code)(Vue);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }] });
    await router.push("/app");
    const practiceProjects = Vue.ref([
      { slug: "training-mine", attemptId: "a", lessonCode: "V64-START-02", lessonTitle: "First change", name: "Practice: First change", ended: false, mine: true, deleteAvailable: true },
      { slug: "training-other", attemptId: "b", lessonCode: "", lessonTitle: "", name: "Practice project", ended: false, mine: false, deleteAvailable: true },
      { slug: "training-hosted", attemptId: "c", lessonCode: "", lessonTitle: "", name: "Practice project", ended: false, mine: true, deleteAvailable: false }
    ]);
    const ctx = Vue.reactive({ busy: false, deletingPracticeSlug: "", practiceProjects, projects: [], deletePracticeProject,
      mdiDeleteOutline: "icon", openPracticeProject: (slug) => router.push(`/app/project/${slug}`),
      displayError: "", selectionInitialLoading: false, runtimeReady: true, selectedSlotVisible: false, pickerVisible: true,
      projectsRoot: "~/vibe64", newProjectName: "", creating: false,
      selectingSlug: "", $props: {}, $slots: {} });
    const tree = render.call(null, ctx, [], ctx, ctx, ctx, ctx);
    const nodes = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      nodes.push(node);
      walk(node.children);
      if (node.children && typeof node.children === "object" && typeof node.children.default === "function") walk(node.children.default());
    };
    walk(tree);
    const rows = nodes.filter((node) => node.props?.["data-practice-slug"]);
    expect(rows.map((node) => node.props["data-practice-slug"])).toEqual(["training-mine", "training-other", "training-hosted"]);
    const deletes = nodes.filter((node) => String(node.props?.["aria-label"] || "").startsWith("Delete Practice"));
    expect(deletes.map((node) => node.props["aria-label"])).toEqual(["Delete Practice: First change"]);
    await deletes[0].props.onClick();
    expect(deletePracticeProject).toHaveBeenCalledWith(practiceProjects.value[0]);
  });
});
