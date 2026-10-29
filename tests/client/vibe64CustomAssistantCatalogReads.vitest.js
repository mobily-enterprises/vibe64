import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import {
  configureHttpWebClient,
  resetHttpWebClientForTests
} from "@jskit-ai/http-web/client/lib/httpClient";
import { createRenderer, nextTick, reactive, ssrContextKey } from "vue";
import { routeLocationKey } from "vue-router";
import { expect, it, onTestFinished, vi } from "vitest";

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({ api: (suffix) => `/api${suffix}` })
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({ useCommand: () => ({ run: vi.fn() }) }));
vi.mock("@/lib/vibe64AccountConnectionsDialog.js", () => ({ requestVibe64AccountConnectionsDialog: vi.fn() }));

import Menu from "../../src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue";

const revision = (letter) => `sha256:${letter.repeat(64)}`;
// Each tool's whole connected catalogue. A model list read can start that
// tool's discovery process, so the menu reads it once per opening burst.
const catalogues = {
  codex: { engineId: "codex", label: "Codex", revision: revision("a"), health: { status: "ready" },
    agents: [{ id: "codex", mode: "primary" }], defaults: { agentId: "codex", modelProviderId: "openai", modelId: "gpt" },
    modelProviders: [{ id: "openai", label: "OpenAI", connected: true,
      models: [{ id: "gpt", label: "GPT", status: "available", variants: [{ id: "high", label: "High" }] }] }] },
  opencode: { engineId: "opencode", label: "OpenCode", revision: revision("b"), health: { status: "ready" },
    agents: [{ id: "build", mode: "primary" }], defaults: { agentId: "build", modelProviderId: "zai", modelId: "glm" },
    modelProviders: [{ id: "zai", label: "Z.AI", connected: true,
      models: [{ id: "glm", label: "GLM", status: "available", variants: [{ id: "high", label: "High" }] }] }] }
};

it("reads each connected tool's model list once while Custom AI opens, reopens and switches tools", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const modelListReads = [];
  configureHttpWebClient({
    request(_url, { query = {} }) {
      if (query.configuredOnly === "true") return Promise.resolve({ ok: true, engines: Object.values(catalogues) });
      modelListReads.push(query.engineId);
      return Promise.resolve({ ok: true, engines: [catalogues[query.engineId]] });
    }
  });
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const saved = { engineId: "codex", agentId: "codex", modelProviderId: "openai", modelId: "gpt", variantId: "high",
    catalogRevision: catalogues.codex.revision };
  const app = renderer.createApp({ ...Menu, render: () => null }, { modelValue: false, sessionsApiPath: "/api/sessions",
    session: { sessionId: "one", assistantSelection: saved, metadata: { assistant_routing: JSON.stringify({ mode: "auto" }) } } });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(ssrContextKey, { modules: new Set() });
  app.provide(routeLocationKey, reactive({ fullPath: "/app/project/project-a/dashboard", params: { slug: "project-a" }, query: {} }));
  onTestFinished(() => {
    app.unmount();
    queryClient.clear();
    resetHttpWebClientForTests();
  });
  app.mount({});
  const state = app._instance.setupState;
  const settled = () => vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));

  state.menuOpen = true;
  await vi.waitFor(() => expect(state.canSave).toBe(true));
  await settled();
  expect(modelListReads.sort()).toEqual(["codex", "opencode"]);

  state.menuOpen = false; await nextTick();
  state.menuOpen = true;
  await vi.waitFor(() => expect(state.canSave).toBe(true));
  await settled();
  state.selectEngine("opencode");
  await vi.waitFor(() => expect(state.draftSelection).toMatchObject({ engineId: "opencode", modelProviderId: "zai", modelId: "glm" }));
  await settled();
  expect(modelListReads.sort()).toEqual(["codex", "opencode"]);
  // Apply carries the whole catalogue's revision, which the server accepts.
  expect(state.draftSelection.catalogRevision).toBe(catalogues.opencode.revision);
  expect(state.canSave).toBe(true);
});
