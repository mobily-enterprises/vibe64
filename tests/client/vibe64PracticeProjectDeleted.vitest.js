import fs from "node:fs";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resources: [], slug: "training-12345678123442348234123456789abc", queryClient: null }));
vi.mock("@tanstack/vue-query", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, useQueryClient: () => mocks.queryClient };
});
vi.mock("vue-router", () => ({ useRoute: () => ({ params: { slug: mocks.slug } }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource(options) {
    const error = Vue.ref(null);
    const resource = { options, data: Vue.ref(null), query: { error },
      loadError: Vue.computed(() => error.value?.message || ""),
      isInitialLoading: Vue.ref(false), isLoading: Vue.ref(false), reload: vi.fn(async () => null) };
    mocks.resources.push(resource);
    return resource;
  }
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => Vue.reactive({ options, messageType: "", message: "", async run() { return { ok: true }; } })
}));

import { QueryClient } from "@tanstack/vue-query";
import { PRACTICE_PROJECT_DELETED_CODE, isPracticeNoticeForProject, useProjectSelectionGate } from "../../src/composables/useProjectSelectionGate.js";

const deletedError = () => Object.assign(new Error("This practice project was deleted. Its lesson is still in Learning."), {
  status: 404, code: "vibe64_practice_project_deleted" });

function openPage(options) {
  mocks.queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const emitted = [];
  const scope = Vue.effectScope();
  const gate = scope.run(() => useProjectSelectionGate((name, value) => emitted.push([name, value]), options));
  return { gate, emitted, scope, selection: mocks.resources[0] };
}

describe("an open practice project deleted elsewhere", () => {
  afterEach(() => { mocks.resources.length = 0; });

  it("turns the page's not-found into the deleted state instead of a load error", async () => {
    expect(PRACTICE_PROJECT_DELETED_CODE).toBe("vibe64_practice_project_deleted");
    const { gate, emitted, scope, selection } = openPage({ scopeSelectionToCurrentProject: true });
    selection.data.value = { hasSelection: true, currentProject: { slug: mocks.slug } };
    await Vue.nextTick();
    expect(emitted.at(-1)[0]).toBe("ready");
    expect(gate.practiceDeleted.value).toBe(false);
    selection.query.error.value = deletedError();
    await Vue.nextTick();
    expect(gate.practiceDeleted.value).toBe(true);
    expect(emitted.at(-1)).toEqual(["deleted", undefined]);
    expect(emitted.some(([name]) => name === "error")).toBe(false);
    scope.stop();
  });

  // The page's selection read fails with the deleted code once it is re-read.
  function selectionReadsDeleted(selection) {
    selection.reload.mockImplementation(async () => { selection.query.error.value = deletedError(); });
  }

  it("flips when another request of the open page is refused because the project was deleted", async () => {
    const { gate, emitted, scope, selection } = openPage({ scopeSelectionToCurrentProject: true });
    selection.data.value = { hasSelection: true, currentProject: { slug: mocks.slug } };
    selectionReadsDeleted(selection);
    await Vue.nextTick();
    // Another panel's ordinary failure re-reads nothing.
    await mocks.queryClient.fetchQuery({ queryKey: ["vibe64", "project", mocks.slug, "sessions"],
      queryFn: async () => { throw Object.assign(new Error("Busy."), { status: 503, code: "vibe64_busy" }); } }).catch(() => {});
    expect(selection.reload).not.toHaveBeenCalled();
    // The sessions panel's request is refused with the deleted code.
    await mocks.queryClient.fetchQuery({ queryKey: ["vibe64", "project", mocks.slug, "sessions"],
      queryFn: async () => { throw deletedError(); } }).catch(() => {});
    await Vue.nextTick();
    expect(selection.reload).toHaveBeenCalledTimes(1);
    expect(gate.practiceDeleted.value).toBe(true);
    expect(emitted.at(-1)).toEqual(["deleted", undefined]);
    scope.stop();
  });

  it("re-reads its selection on Learning's practice notice for this project only", async () => {
    const { gate, emitted, scope, selection } = openPage({ scopeSelectionToCurrentProject: true });
    selection.data.value = { hasSelection: true, currentProject: { slug: mocks.slug } };
    const { realtime } = selection.options;
    expect(realtime.events).toEqual(["vibe64.project.changed", "vibe64.training.learner.changed"]);
    const attemptId = "12345678-1234-4234-8234-123456789abc";
    const learner = (payload) => realtime.matches({ event: "vibe64.training.learner.changed", payload });
    expect(learner({ attemptId, reason: "practice" })).toBe(true);
    expect(learner({ attemptId, reason: "reader" })).toBe(false);
    expect(learner({ attemptId: "87654321-1234-4234-8234-123456789abc", reason: "practice" })).toBe(false);
    expect(learner({ reason: "notes" })).toBe(false);
    expect(realtime.matches({ event: "vibe64.project.changed", payload: {} })).toBe(true);
    expect(isPracticeNoticeForProject({ attemptId, reason: "practice" }, "my-app")).toBe(false);
    // The delivered notice invalidates the selection, which now reads deleted.
    selectionReadsDeleted(selection);
    await selection.reload();
    await Vue.nextTick();
    expect(gate.practiceDeleted.value).toBe(true);
    expect(emitted.at(-1)).toEqual(["deleted", undefined]);
    scope.stop();
  });

  it("keeps other load errors, and the picker's own errors, as ordinary errors", async () => {
    const page = openPage({ scopeSelectionToCurrentProject: true });
    page.selection.query.error.value = Object.assign(new Error("Project path is not readable."), { status: 404, code: "vibe64_project_path_not_accessible" });
    await Vue.nextTick();
    expect(page.gate.practiceDeleted.value).toBe(false);
    expect(page.emitted.at(-1)).toEqual(["error", "Project path is not readable."]);
    page.scope.stop();
    mocks.resources.length = 0;
    const picker = openPage({ scopeSelectionToCurrentProject: false });
    picker.selection.query.error.value = deletedError();
    await Vue.nextTick();
    expect(picker.gate.practiceDeleted.value).toBe(false);
    expect(picker.emitted.at(-1)[0]).toBe("error");
    // The picker keeps its plain project-changed refresh.
    expect(picker.selection.options.realtime).toEqual({ event: "vibe64.project.changed" });
    picker.scope.stop();
  });
});

describe("project page deleted notice", () => {
  const filename = new URL("../../src/components/studio/ProjectSelectionGate.vue", import.meta.url).pathname;
  const source = fs.readFileSync(filename, "utf8");
  const { descriptor } = parse(source, { filename });
  const script = compileScript(descriptor, { id: "deleted-gate" });
  const { code } = compile(descriptor.template.content, { mode: "function", prefixIdentifiers: true, bindingMetadata: script.bindings });
  const render = new Function("Vue", code)(Vue);

  function nodesOf(ctx) {
    const nodes = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      nodes.push(node);
      walk(node.children);
      if (node.children && typeof node.children === "object" && typeof node.children.default === "function") walk(node.children.default());
    };
    walk(render.call(null, ctx, [], ctx, ctx, ctx, ctx));
    return nodes;
  }
  const baseContext = (extra) => Vue.reactive({ busy: false, deletingPracticeSlug: "", practiceProjects: [], projects: [],
    mdiDeleteOutline: "icon", displayError: "Project path is not readable.", selectionInitialLoading: false, runtimeReady: true,
    selectedSlotVisible: false, pickerVisible: false, projectsRoot: "~/vibe64", newProjectName: "", creating: false,
    recovering: false, selectingSlug: "", $props: {}, $slots: {}, ...extra });
  const texts = (nodes) => nodes.filter((node) => typeof node.children === "string").map((node) => node.children.trim());

  it("shows that the practice project was deleted with a button back to Learning, not an error", async () => {
    const openLearning = vi.fn();
    const nodes = nodesOf(baseContext({ practiceDeleted: true, learning: { show: vi.fn() }, openLearning }));
    expect(texts(nodes)).toContain("This practice project was deleted");
    expect(nodes.some((node) => node.props?.title === "Project could not load")).toBe(false);
    const button = nodes.find((node) => String(node.props?.class || "").includes("project-selection-gate__deleted-learning"));
    expect(button).toBeTruthy();
    await button.props.onClick();
    expect(openLearning).toHaveBeenCalledTimes(1);
    // The button opens L on its course list, where the lesson remains.
    expect(script.content).toMatch(/learning\?\.show\(\{ surface: "courses" \}\)/u);
  });

  it("leaves other load errors on the ordinary error notice", () => {
    const nodes = nodesOf(baseContext({ practiceDeleted: false, learning: null, openLearning: vi.fn() }));
    expect(texts(nodes)).not.toContain("This practice project was deleted");
    expect(nodes.some((node) => node.props?.title === "Project could not load")).toBe(true);
  });
});

describe("the project picker in learning mode", () => {
  afterEach(() => { mocks.resources.length = 0; });

  async function openInLearningMode(learning, options = {}) {
    const { VIBE64_LEARNING_KEY } = await import("../../src/lib/vibe64AssistantHost.js");
    mocks.queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const app = Vue.createApp({});
    app.provide(VIBE64_LEARNING_KEY, learning);
    const emitted = [];
    const scope = Vue.effectScope();
    const gate = app.runWithContext(() => scope.run(() => useProjectSelectionGate((name, value) => emitted.push([name, value]), options)));
    return { gate, emitted, scope, selection: mocks.resources[0] };
  }

  it("lists only the lesson's projects, and every project once learning mode ends", async () => {
    const learning = Vue.reactive({ learningMode: { on: true, practiceSlug: "training-abc", projectSlugs: ["training-abc"] },
      leaveLesson: vi.fn(async () => ({ ok: true })) });
    const { gate, scope, selection } = await openInLearningMode(learning);
    selection.data.value = { hasSelection: false, projects: [{ slug: "my-shop", path: "/p/my-shop" },
      { slug: "training-abc", path: "/p/training-abc", practice: { attemptId: "a", lessonCode: "L1", mine: true } }] };
    await Vue.nextTick();
    expect(gate.learningModeOn.value).toBe(true);
    expect(gate.projects.value).toEqual([]);
    expect(gate.practiceProjects.value.map(project => project.slug)).toEqual(["training-abc"]);
    await gate.leaveLesson();
    expect(learning.leaveLesson).toHaveBeenCalledTimes(1);
    learning.learningMode = { on: false, paused: true, practiceSlug: "", projectSlugs: [] };
    await Vue.nextTick();
    expect(gate.learningModeOn.value).toBe(false);
    expect(gate.projects.value.map(project => project.slug)).toEqual(["my-shop"]);
    scope.stop();
  });

  it("shows no load error when the server refuses a project outside the lesson", async () => {
    const learning = Vue.reactive({ learningMode: { on: true, practiceSlug: "", projectSlugs: [] }, leaveLesson: vi.fn() });
    const { gate, emitted, scope, selection } = await openInLearningMode(learning, { scopeSelectionToCurrentProject: true });
    selection.query.error.value = Object.assign(new Error("You're in a lesson. Leave lesson to get back to your projects."),
      { status: 403, code: "vibe64_learning_mode_project" });
    await Vue.nextTick();
    expect(gate.learningModeBlocked.value).toBe(true);
    expect(gate.errorMessage.value).toBe("");
    expect(emitted.some(([name]) => name === "error")).toBe(false);
    scope.stop();
  });
});
