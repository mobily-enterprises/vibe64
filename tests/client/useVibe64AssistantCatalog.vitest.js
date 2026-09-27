import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import {
  configureHttpWebClient,
  resetHttpWebClientForTests
} from "@jskit-ai/http-web/client/lib/httpClient";
import { createRenderer, reactive, ref } from "vue";
import { routeLocationKey } from "vue-router";
import { expect, it, onTestFinished, vi } from "vitest";

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({ api: (suffix) => `/api${suffix}` })
}));

import { useVibe64AssistantCatalog } from "../../src/composables/useVibe64AssistantCatalog.js";

it.each([
  { label: "all connected models in one orchestrator",
    input: { engineId: "opencode", allConnectedModels: true, providerConnectedOnly: true },
    expectedQueries: [{ allConnectedModels: "true", connectedOnly: "true", engineId: "opencode", limit: "25" }] },
  {
    label: "shared OpenCode overview/provider page",
    input: { engineId: "opencode", modelProviderId: "example-provider", providerConnectedOnly: true },
    expectedQueries: [
      { connectedOnly: "true", engineId: "opencode", limit: "25" },
      { connectedOnly: "true", engineId: "opencode", limit: "100", modelProviderId: "example-provider" }
    ]
  },
  {
    label: "searched OpenCode providers",
    input: { engineId: "opencode", providerSearch: "example", providerConnectedOnly: true },
    expectedQueries: [
      { connectedOnly: "true", engineId: "opencode", limit: "25" },
      { connectedOnly: "true", engineId: "opencode", limit: "25", search: "example" }
    ]
  },
  {
    label: "a later OpenCode provider page",
    input: { engineId: "opencode", providerCursor: "next-page", providerConnectedOnly: true },
    expectedQueries: [
      { connectedOnly: "true", engineId: "opencode", limit: "25" },
      { connectedOnly: "true", engineId: "opencode", limit: "25", cursor: "next-page" }
    ]
  },
  {
    label: "all OpenCode providers",
    input: { engineId: "opencode", modelProviderId: "example-provider" },
    expectedQueries: [
      { engineId: "opencode", limit: "25" },
      { engineId: "opencode", limit: "100", modelProviderId: "example-provider" }
    ]
  },
  {
    label: "Codex models",
    input: { engineId: "codex", modelProviderId: "openai" },
    expectedQueries: [
      { engineId: "codex", limit: "25" },
      { engineId: "codex", limit: "100", modelProviderId: "openai" }
    ]
  },
  {
    label: "configured choices without model discovery",
    input: { configuredOnly: true, engineId: "opencode", modelProviderId: "example-provider" },
    expectedQueries: [{ configuredOnly: "true", limit: "100" }]
  }
])("refreshes $label once with cached data", async ({ input, expectedQueries }) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const heldRefresh = Promise.withResolvers();
  const requests = [];
  let refreshing = false;
  let catalog;
  configureHttpWebClient({
    request(url, options) {
      expect(url).toBe("/api/vibe64/assistants/capabilities");
      expect(options.method).toBe("GET");
      requests.push(options.query);
      return refreshing ? heldRefresh.promise : Promise.resolve({ engines: [], revision: 1 });
    }
  });
  const app = createRenderer({
    createComment: () => ({}),
    insert() {},
    nextSibling: () => null,
    parentNode: () => null,
    remove() {}
  }).createApp({
    setup() {
      catalog = useVibe64AssistantCatalog({
        active: ref(true),
        ...input
      });
      return () => null;
    }
  });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(routeLocationKey, reactive({
    fullPath: "/app/project/project-a/dashboard", params: { slug: "project-a" }, query: {}
  }));
  onTestFinished(() => {
    heldRefresh.resolve({ engines: [], revision: 2 });
    app.unmount();
    queryClient.clear();
    resetHttpWebClientForTests();
  });
  app.mount({});

  await vi.waitFor(() => {
    expect(requests).toEqual(expectedQueries);
    expect(queryClient.isFetching()).toBe(0);
  });
  expect(catalog.overview.data.value.revision).toBe(1);
  requests.length = 0;
  refreshing = true;

  const reload = catalog.reload();
  expect(requests).toEqual(expectedQueries);
  expect(catalog.overview.isInitialLoading.value).toBe(false);
  expect(catalog.overview.data.value.revision).toBe(1);
  heldRefresh.resolve({ engines: [], revision: 2 });
  await reload;
  expect(catalog.overview.data.value.revision).toBe(2);
  if (input.engineId === "opencode" && !input.configuredOnly && !input.allConnectedModels) {
    expect(catalog.providerPage.data.value.revision).toBe(2);
  }
  if (input.modelProviderId && !input.configuredOnly && !input.allConnectedModels) {
    expect(catalog.modelPage.data.value.revision).toBe(2);
  }
});
