import { readFileSync } from "node:fs";
import * as Vue from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ data: null, sessionId: null, slug: null }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: () => ({ data: mocks.data, isLoading: Vue.ref(false), loadError: Vue.ref(""), reload: vi.fn() })
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({ useCommand: () => ({ run: vi.fn() }) }));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => mocks.slug }));
vi.mock("@/composables/useVibe64SessionSelection.js", () => ({
  useVibe64SessionSelection: () => ({ selectedId: mocks.sessionId })
}));
import PreviewIdentitySettings from "../../src/components/studio/PreviewIdentitySettings.vue";

import {
  PREVIEW_IDENTITIES_ENDPOINT,
  VIBE64_PREVIEW_IDENTITIES_API_SUFFIX,
  previewIdentitiesQueryKey
} from "../../src/lib/studioGateApi.js";

describe("managed app identity settings", () => {
  it("uses a project-scoped Vibe64 API rather than Env or Genesis", () => {
    expect(PREVIEW_IDENTITIES_ENDPOINT).toBe("/api/vibe64/preview-identities");
    expect(VIBE64_PREVIEW_IDENTITIES_API_SUFFIX).toBe("/vibe64/preview-identities");
    expect(previewIdentitiesQueryKey("app", "public", "books")).toEqual([
      "vibe64",
      "project",
      "books",
      "app",
      "public",
      "preview-identities"
    ]);
  });

  it("stores identities in the selected repository source through compact shared feedback", () => {
    const component = readFileSync(new URL(
      "../../src/components/studio/PreviewIdentitySettings.vue",
      import.meta.url
    ), "utf8");
    const page = readFileSync(new URL(
      "../../src/pages/app/project/[slug]/dashboard/access/index.vue",
      import.meta.url
    ), "utf8");

    expect(component).toContain("Managed app identities");
    expect(component).toContain("Add identity");
    expect(component).toContain("Make default");
    expect(component).toContain("Remove");
    expect(component).toContain("label=\"App identifier\"");
    expect(component).toContain("label=\"Application value\"");
    expect(component).toContain("PREVIEW_IDENTITIES_ENDPOINT");
    expect(component).toContain("useVibe64SessionSelection");
    expect(component).toContain("selectedSessionId.value || \"baseline\"");
    expect(component).toContain("{ sessionId: selectedSessionId.value }");
    expect(component).toContain(".vibe64/preview-identities.json");
    expect(component).toContain("not passwords or authentication secrets");
    expect(component).toContain("saving ? \"Saving…\" : \"Save\"");
    for (const button of component.matchAll(/<v-btn[\s\S]*?<\/v-btn>/gu)) {
      expect(button[0]).not.toContain(":loading=");
    }
    expect(component).not.toContain("v-if=\"saveError\"");
    expect(component).not.toContain("only in Vibe64 project state");
    expect(component).not.toContain("ENV_");
    expect(component).not.toContain("genesis");
    expect(page).toContain("<PreviewIdentitySettings />");
  });
});

describe("an unsaved managed app identity draft", () => {
  let app;
  afterEach(() => app?.unmount());
  const admin = { name: "admin", type: "email", value: "admin@example.test" };
  const editor = { name: "editor", type: "login", value: "editor" };

  function mount(identities) {
    mocks.data = Vue.ref({ identities });
    mocks.sessionId = Vue.ref("s1");
    mocks.slug = Vue.ref("books");
    const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
    app = renderer.createApp({ ...PreviewIdentitySettings, render: () => null });
    app.provide(Vue.ssrContextKey, { modules: new Set() });
    app.mount({});
    return app._instance.setupState;
  }

  it("follows a newer saved list while it has no edits", async () => {
    const state = mount([admin]);
    mocks.data.value = { identities: [admin, editor] };
    await Vue.nextTick();
    expect(state.identities).toEqual([admin, editor]);
    expect(state.stale).toBe(false);
  });

  it("keeps the person's edits when the saved list changes, and offers to reload it", async () => {
    const state = mount([admin]);
    state.addIdentity();
    state.identities[1].name = "draft";
    mocks.data.value = { identities: [admin, editor] };
    await Vue.nextTick();
    expect(state.identities.map((identity) => identity.name)).toEqual(["admin", "draft"]);
    expect(state.stale).toBe(true);
    expect(state.changed).toBe(true);
    state.resetDraft();
    expect(state.identities).toEqual([admin, editor]);
    expect(state.stale).toBe(false);
    expect(state.changed).toBe(false);
  });

  it("is not stale when the saved list becomes the draft or is refetched unchanged", async () => {
    const state = mount([admin]);
    state.addIdentity();
    Object.assign(state.identities[1], editor);
    mocks.data.value = { identities: [admin] };
    await Vue.nextTick();
    expect(state.stale).toBe(false);
    mocks.data.value = { identities: [admin, editor] };
    await Vue.nextTick();
    expect(state.stale).toBe(false);
    expect(state.changed).toBe(false);
  });

  it("starts a fresh draft for another session's source", async () => {
    const state = mount([admin]);
    state.addIdentity();
    mocks.sessionId.value = "s2";
    mocks.data.value = { identities: [editor] };
    await Vue.nextTick();
    expect(state.identities).toEqual([editor]);
    expect(state.stale).toBe(false);
  });
});
