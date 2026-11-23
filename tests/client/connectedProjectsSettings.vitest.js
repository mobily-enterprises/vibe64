import { readFileSync } from "node:fs";
import { createRenderer, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({ useCommand: () => ({ run: vi.fn() }) }));
import ConnectedProjectsSettings from "../../src/components/studio/ConnectedProjectsSettings.vue";

let app;
function mount(repositories, extra = {}) {
  const renderer = createRenderer({ createComment: (text) => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...ConnectedProjectsSettings, render: () => null }, { projectSlug: "books", state: {
    available: true, canEdit: true, exists: true, revision: "r1", source: { sessionId: "s1" }, repositories, ...extra
  } });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
afterEach(() => app?.unmount());

const library = { name: "Library", repository: "https://github.com/example/library", relationship: "dependency" };

it("offers the Stack default followed by every ecosystem label from the shared vocabulary", () => {
  const state = mount([]);
  expect(state.packageTypes.map(item => item.label)).toEqual(["Stack default", "npm (Node.js)", "Composer (PHP)",
    "pip (Python)", "Bundler (Ruby)", "Go modules", "Cargo (Rust)", "Maven", "Gradle", "NuGet (.NET)", "custom"]);
  expect(state.packageTypes.map(item => item.value)).toEqual(["", "npm", "composer", "pip", "bundler", "gomod",
    "cargo", "maven", "gradle", "nuget", "custom"]);
});

it("disables and clears the script for every non-custom type while custom and Stack default keep it", () => {
  const state = mount([{ ...library, script: "tooling/prepare.mjs" }]);
  const [entry] = state.draft;
  expect(state.scriptAllowed(entry)).toBe(true);
  state.setPackageType(entry, "custom");
  expect(entry).toMatchObject({ type: "custom", script: "tooling/prepare.mjs" });
  for (const type of ["npm", "composer", "pip", "bundler", "gomod", "cargo", "maven", "gradle", "nuget"]) {
    state.setPackageType(entry, "custom");
    state.setScript(entry, "tooling/prepare.mjs");
    state.setPackageType(entry, type);
    expect(entry.type).toBe(type);
    expect(Object.hasOwn(entry, "script")).toBe(false);
    expect(state.scriptAllowed(entry)).toBe(false);
  }
  state.setPackageType(entry, "");
  expect(Object.hasOwn(entry, "type")).toBe(false);
  expect(state.scriptAllowed(entry)).toBe(true);
});

it("binds the script field's disabled state to the shared type rule", () => {
  const component = readFileSync(new URL("../../src/components/studio/ConnectedProjectsSettings.vue", import.meta.url), "utf8");
  expect(component).toContain("saving || !scriptAllowed(entry)\"");
  expect(component).toContain("@local/vibe64-genesis/shared/connectedPackageTypes");
  expect(component).not.toMatch(/entry\.type === 'npm'/u);
});

it("says beside each connection nothing in the session installs that it is connected but unused, and nothing beside the others", () => {
  const other = { name: "Other", repository: "https://github.com/example/other", relationship: "dependency" };
  const reason = "Library is connected, but nothing here installs it: remove it or install it. No tree of this session installs any of its packages (library).";
  const state = mount([library, other], { unused: [{ repository: library.repository, reason }] });
  expect(state.draft.map((entry) => state.unusedReason(entry))).toEqual([reason, ""]);
  const component = readFileSync(new URL("../../src/components/studio/ConnectedProjectsSettings.vue", import.meta.url), "utf8");
  expect(component).toContain('<v-alert v-if="unusedReason(entry)" type="info" variant="tonal" density="compact">{{ unusedReason(entry) }}</v-alert>');
});
