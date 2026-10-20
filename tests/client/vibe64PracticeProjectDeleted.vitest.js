import fs from "node:fs";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resources: [], slug: "training-12345678123442348234123456789abc" }));
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

import { PRACTICE_PROJECT_DELETED_CODE, useProjectSelectionGate } from "../../src/composables/useProjectSelectionGate.js";

const deletedError = () => Object.assign(new Error("This practice project was deleted. Its lesson is still in Learning."), {
  status: 404, code: "vibe64_practice_project_deleted" });

function openPage(options) {
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
