import { createRenderer, nextTick, ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { afterEach, expect, it, vi } from "vitest";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "../../src/lib/vibe64AssistantHost.js";

const request = vi.fn();
const originalClient = getHttpWebClient();
vi.mock("../../packages/vibe64-accounts/src/client/lib/accountsGateApi.js", () => ({
  ACCOUNTS_ENDPOINT: "/api/accounts", VIBE64_ACCOUNTS_CHANGED_EVENT: "accounts-changed", VIBE64_CONNECTIONS_CHANGED_EVENT: "connections-changed"
}));
import { useModelRouting } from "../../packages/vibe64-accounts/src/client/composables/useModelRouting.js";

let app;
let queryClient;
afterEach(() => { app?.unmount(); queryClient?.clear(); request.mockReset(); configureHttpWebClient(originalClient); });
const flush = async () => { await nextTick(); await new Promise((resolve) => setTimeout(resolve, 0)); await nextTick(); };

it("keeps owner, member and project routing responses in separate real query caches", async () => {
  configureHttpWebClient({ request });
  const viewer = ref({ actorKey: "owner", projectSlug: "first" });
  const memberReply = Promise.withResolvers();
  request.mockResolvedValueOnce({ ok: true, canConfigure: true, engines: [{ engineId: "owner-view" }] })
    .mockReturnValueOnce(memberReply.promise)
    .mockResolvedValueOnce({ ok: true, canConfigure: false, engines: [{ engineId: "second-project" }] });
  let routing;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ setup() { routing = useModelRouting(); return () => null; } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer);
  app.mount({});
  await flush();
  expect(routing.resource.data.value.canConfigure).toBe(true);
  viewer.value = { actorKey: "member", projectSlug: "first" };
  await flush();
  expect(routing.engines.value).toEqual([]);
  expect(routing.resource.data.value).toBeUndefined();
  memberReply.resolve({ ok: true, canConfigure: false, engines: [{ engineId: "member-view" }] });
  await flush();
  expect(routing.resource.data.value.canConfigure).toBe(false);
  expect(routing.engines.value[0].engineId).toBe("member-view");
  viewer.value = { actorKey: "member", projectSlug: "second" };
  await flush();
  expect(routing.engines.value[0].engineId).toBe("second-project");
  viewer.value = null;
  await flush();
  expect(routing.engines.value).toEqual([]);
  expect(request).toHaveBeenCalledTimes(3);
});

it("loads workflow choices independently of a slow configuration catalogue", async () => {
  configureHttpWebClient({ request });
  const catalogue = Promise.withResolvers();
  request.mockImplementation((path) => path.endsWith("/workflows")
    ? Promise.resolve({ ok: true, workflows: [{ engineId: "codex", available: true }] })
    : catalogue.promise);
  let configuration;
  let picker;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ setup() {
    configuration = useModelRouting();
    picker = useModelRouting({ workflowsOnly: true });
    return () => null;
  } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, ref({ actorKey: "owner", projectSlug: "first" }));
  app.mount({});
  await flush();
  expect(configuration.resource.isInitialLoading.value).toBe(true);
  expect(picker.resource.isInitialLoading.value).toBe(false);
  expect(picker.resource.data.value.workflows[0].engineId).toBe("codex");
  expect(picker.scopeKey.value).not.toBe(configuration.scopeKey.value);
  catalogue.resolve({ ok: true, engines: [{ engineId: "catalogue" }] });
  await flush();
  expect(configuration.engines.value[0].engineId).toBe("catalogue");
  expect(picker.resource.data.value.workflows[0].engineId).toBe("codex");
});
