import * as Vue from "vue";
import { createRenderer, ssrContextKey } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resources: [], next: {}, listPath: "", dialogs: [] }));
vi.mock("@/lib/vibe64ProjectScope.js", async (importOriginal) => ({
  ...await importOriginal(), projectListPath: () => mocks.listPath
}));
vi.mock("@tanstack/vue-query", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, useQueryClient: () => new original.QueryClient() };
});
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { slug: "hello-node" } }),
  useRouter: () => ({ push: vi.fn() })
}));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource(options) {
    const error = Vue.ref(mocks.next.error || null);
    const resource = { options, data: Vue.ref(mocks.next.data || null), query: { error },
      loadError: Vue.computed(() => error.value?.message || ""),
      isInitialLoading: Vue.ref(false), isLoading: Vue.ref(false), reload: vi.fn(async () => null) };
    mocks.resources.push(resource);
    return resource;
  }
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => Vue.reactive({ options, messageType: "", message: "", async run() { return { ok: true }; } })
}));
vi.mock("../../src/lib/vibe64AccountConnectionsDialog.js", () => ({
  requestVibe64AccountConnectionsDialog: (detail) => mocks.dialogs.push(detail)
}));

import ProjectSelectionGate from "../../src/components/studio/ProjectSelectionGate.vue";
import { TEAM_AI_REQUIRED_CODE, useProjectSelectionGate } from "../../src/composables/useProjectSelectionGate.js";

const gated = (ownerName = "Tony") => Object.assign(new Error(`Ask ${ownerName || "the workspace owner"} to set up AI for team members.`), {
  status: 403, code: "vibe64_team_ai_required", details: { ownerName } });
const teamAi = (extra = {}) => ({ available: true, ownerName: "Tony", memberCount: 2, ready: false, ...extra });
const text = (html) => html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<[^>]+>/gu, " ").replace(/&#39;/gu, "'").replace(/\s+/gu, " ");

afterEach(() => {
  mocks.resources.length = 0;
  mocks.listPath = "";
  mocks.dialogs.length = 0;
  mocks.next = {};
});

// The gate's script without its template, for its handlers.
function mountGate(next, props = {}) {
  mocks.next = next;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const gate = Vue.ref();
  const app = renderer.createApp({ render: () => Vue.h({ ...ProjectSelectionGate, render: () => null }, { ...props, ref: gate }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { state: gate.value.$.setupState, unmount: () => app.unmount() };
}

async function renderGate(next, props = {}) {
  mocks.next = next;
  const app = Vue.createSSRApp({ render: () => Vue.h(ProjectSelectionGate, props, { default: () => Vue.h("p", "Project workspace") }) });
  app.use(createVuetify());
  return renderToString(app);
}

describe("a team member's project before team AI is set up", () => {
  it("shows the team AI screen with the owner's name instead of a load error", async () => {
    expect(TEAM_AI_REQUIRED_CODE).toBe("vibe64_team_ai_required");
    const html = text(await renderGate({ error: gated() }, { scopeSelectionToCurrentProject: true }));
    expect(html).toContain("Team AI isn't set up yet");
    expect(html).toContain("Tony needs to set up AI for team members before you can open projects here.");
    expect(html).toContain("Ask Tony to set up AI for team members.");
    expect(html).toContain("Check again");
    expect(html).not.toContain("Back to projects");
    expect(html).not.toContain("Project could not load");
    expect(html).not.toContain("Project workspace");
  });

  it("names the workspace owner when the host has no name", async () => {
    const html = text(await renderGate({ error: gated("") }, { scopeSelectionToCurrentProject: true }));
    expect(html).toContain("The workspace owner needs to set up AI for team members");
    expect(html).toContain("Ask the workspace owner to set up AI for team members.");
  });

  it("offers Back to projects only where the host has a project list", async () => {
    mocks.listPath = "/projects";
    const html = await renderGate({ error: gated() }, { scopeSelectionToCurrentProject: true });
    expect(text(html)).toContain("Back to projects");
    expect(mountGate({ error: gated() }).state.projectsPath).toBe("/projects");
  });

  it("is a refusal, not an error: no error event, and Check again reads the selection again", async () => {
    mocks.next = { error: gated() };
    const emitted = [];
    const scope = Vue.effectScope();
    const gate = scope.run(() => useProjectSelectionGate((name, value) => emitted.push([name, value]),
      { scopeSelectionToCurrentProject: true }));
    expect(gate.teamAiBlocked.value).toBe(true);
    expect(gate.teamAiOwnerName.value).toBe("Tony");
    expect(gate.errorMessage.value).toBe("");
    expect(emitted).toEqual([]);
    await gate.loadProjectSelection();
    expect(mocks.resources[0].reload).toHaveBeenCalledTimes(1);
    mocks.resources[0].query.error.value = null;
    mocks.resources[0].data.value = { hasSelection: true, currentProject: { slug: "hello-node" } };
    await Vue.nextTick();
    expect(gate.teamAiBlocked.value).toBe(false);
    expect(emitted.at(-1)[0]).toBe("ready");
    scope.stop();
  });

  it("Check again re-reads the selection from the screen", async () => {
    const { state, unmount } = mountGate({ error: gated() }, { scopeSelectionToCurrentProject: true });
    await state.retryProject();
    expect(mocks.resources[0].reload).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("the owner's project list", () => {
  const projects = [{ slug: "hello-node", path: "/p/hello-node", approvalsWaiting: 2 }, { slug: "shop", path: "/p/shop", approvalsWaiting: 0 }];

  it("prompts the owner while team members can't open projects", async () => {
    const html = text(await renderGate({ data: { hasSelection: false, projects, teamAi: teamAi() } }));
    expect(html).toContain("Team members can't open projects yet");
    expect(html).toContain("Set up AI for team members so they can work here.");
    expect(html).toContain("Set up team AI");
  });

  it("does not prompt without team members, once ready, or on a host without a team", async () => {
    for (const value of [teamAi({ memberCount: 0 }), teamAi({ ready: true }), teamAi({ available: false }), undefined]) {
      const html = text(await renderGate({ data: { hasSelection: false, projects, teamAi: value } }));
      expect(html).not.toContain("Team members can't open projects yet");
    }
  });

  it("opens AI setup at the team setup", () => {
    const { state, unmount } = mountGate({ data: { hasSelection: false, projects, teamAi: teamAi() } });
    state.openTeamAiSetup();
    expect(mocks.dialogs).toEqual([{ providerId: "ai", section: "team" }]);
    unmount();
  });

  it("shows how many messages wait for approval on each project", async () => {
    const html = await renderGate({ data: { hasSelection: false, projects } });
    expect(text(html)).toContain("2 waiting");
    expect(html.match(/data-test="project-approvals-waiting"/gu)).toHaveLength(1);
  });
});
