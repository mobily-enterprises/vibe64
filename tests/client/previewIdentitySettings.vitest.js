import { readFileSync } from "node:fs";
import * as Vue from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ data: null, reload: null, run: null, sessionId: null, slug: null }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: () => ({ data: mocks.data, isLoading: Vue.ref(false), loadError: Vue.ref(""), reload: () => mocks.reload?.() })
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({ useCommand: () => ({ run: (context) => mocks.run?.(context) }) }));
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
  afterEach(() => {
    app?.unmount();
    mocks.reload = null;
    mocks.run = null;
  });
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

  it("takes the server's normalized list as the draft after the person's own save", async () => {
    const state = mount([admin]);
    state.addIdentity();
    Object.assign(state.identities[1], { name: "Editor ", type: "login", value: "editor" });
    mocks.run = async () => ({ ok: true });
    mocks.reload = async () => {
      mocks.data.value = { identities: [admin, editor] };
      await Vue.nextTick();
    };
    await state.save();
    await Vue.nextTick();
    expect(state.stale).toBe(false);
    expect(state.changed).toBe(false);
    expect(state.identities).toEqual([admin, editor]);
  });

  it("keeps the draft when the save did not run", async () => {
    const state = mount([admin]);
    state.addIdentity();
    Object.assign(state.identities[1], editor);
    mocks.run = async () => null;
    await state.save();
    expect(state.changed).toBe(true);
    expect(state.identities).toEqual([admin, editor]);
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

describe("a saved identity list with invalid entries", () => {
  let app;
  afterEach(() => {
    app?.unmount();
    mocks.reload = null;
    mocks.run = null;
  });
  const admin = { name: "admin", type: "email", value: "admin@example.test" };
  const you = { name: "you", type: "login", value: "merc" };
  const reason = "The name \"you\" is reserved by Vibe64 (default, guest and you are). Choose another, such as admin or user.";

  function mount(data) {
    mocks.data = Vue.ref(data);
    mocks.sessionId = Vue.ref("s1");
    mocks.slug = Vue.ref("books");
    const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
    app = renderer.createApp({ ...PreviewIdentitySettings, render: () => null });
    app.provide(Vue.ssrContextKey, { modules: new Set() });
    app.mount({});
    return app._instance.setupState;
  }

  it("shows every entry in its place, marks the invalid one with its reason, and saves once it is renamed", async () => {
    const state = mount({
      identities: [admin],
      invalidIdentities: [{ ...you, code: "vibe64_application_identity_name_reserved", position: 1, reason }]
    });
    expect(state.identities).toEqual([you, admin]);
    expect(state.identityProblems).toEqual([reason, ""]);
    expect(state.savedListNotice).toBe(
      "Preview skips identity 1 (\"you\") until it is fixed. Rename or remove it, then choose Save."
    );
    expect(state.canSave).toBe(false);
    expect(state.saveBlockedReason).toBe("Fix or remove identity 1 (\"you\") to save.");

    state.identities[0].name = "owner";
    await Vue.nextTick();
    expect(state.identityProblems).toEqual(["", ""]);
    expect(state.canSave).toBe(true);
    let saved = null;
    mocks.run = async (context) => {
      saved = context;
      return { ok: true };
    };
    await state.save();
    expect(saved.identities).toEqual([{ ...you, name: "owner" }, admin]);
  });

  it("lets the person remove the invalid entry and keep the valid ones", async () => {
    const state = mount({
      identities: [admin],
      invalidIdentities: [{ ...you, code: "vibe64_application_identity_name_reserved", position: 2, reason }]
    });
    expect(state.identities).toEqual([admin, you]);
    state.removeIdentity(1);
    await Vue.nextTick();
    expect(state.identities).toEqual([admin]);
    expect(state.canSave).toBe(true);
  });

  it("marks an entry the person adds while it is invalid, and refuses to save it", async () => {
    const state = mount({ identities: [admin] });
    state.addIdentity();
    Object.assign(state.identities[1], { name: "guest", type: "email", value: "guest@example.test" });
    await Vue.nextTick();
    expect(state.identityProblems[1]).toMatch(/^The name "guest" is reserved by Vibe64/u);
    expect(state.canSave).toBe(false);
  });

  it("offers Save for an entry whose only problem saving fixes", async () => {
    const viewer = { name: "viewer", type: "email", value: "viewer@example.test" };
    const state = mount({
      identities: [admin],
      invalidIdentities: [{
        ...viewer,
        code: "vibe64_application_identity_fields_unsupported",
        position: 2,
        reason: "It has fields Vibe64 does not use (vibe64User): an identity has only a name, an app identifier and an application value."
      }]
    });
    expect(state.identities).toEqual([admin, viewer]);
    expect(state.identityProblems).toEqual(["", ""]);
    expect(state.savedListNotice).toBe("Preview skips identity 2 (\"viewer\") until it is fixed: It has fields Vibe64 does not use " +
      "(vibe64User): an identity has only a name, an app identifier and an application value. Choose Save to store it without them.");
    expect(state.canSave).toBe(true);
  });

  it("loads a file that is not an identity list, says why, and can replace it", async () => {
    const fileProblem = ".vibe64/preview-identities.json is not valid JSON (Unexpected end of JSON input).";
    const state = mount({ fileProblem, identities: [] });
    expect(state.identities).toEqual([]);
    expect(state.savedListNotice).toBe(`${fileProblem} Preview runs without managed app identities until it is replaced: ` +
      "add the identities you need and choose Save.");
    expect(state.canSave).toBe(true);
  });
});
