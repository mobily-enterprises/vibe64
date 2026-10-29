import { readFileSync } from "node:fs";
import { computed, createRenderer, h, nextTick, ref } from "vue";
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

it("shares one query and derives the setups, viewer decisions, team and connected tools", async () => {
  configureHttpWebClient({ request });
  request.mockResolvedValue({ ok: true, revision: 1, setups: { owner: { roles: {} } }, viewer: { senior: { available: true } },
    team: { available: true, ownerName: "Owner", memberCount: 2 },
    engines: [{ engineId: "codex", connected: true }, { engineId: "claude", connected: false }] });
  let first;
  let second;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ setup() { first = useModelRouting(); second = useModelRouting(); return () => null; } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, ref({ actorKey: "owner", projectSlug: "first" }));
  app.mount({});
  await flush();
  expect(first.scopeKey.value).toBe(second.scopeKey.value);
  expect(request).toHaveBeenCalledTimes(1);
  expect(first.connectedEngines.value.map(({ engineId }) => engineId)).toEqual(["codex"]);
  expect(first.setups.value).toEqual({ owner: { roles: {} } });
  expect(first.viewerDecisions.value.senior.available).toBe(true);
  expect(first.team.value.memberCount).toBe(2);
});

it("gives main chat the owner's Senior, falling back to its recommendation", async () => {
  configureHttpWebClient({ request });
  const recommended = { engineId: "codex", modelId: "recommended" };
  const saved = { engineId: "codex", modelId: "saved" };
  request.mockResolvedValueOnce({ ok: true, setups: { owner: { roles: { senior: { effective: null, recommendation: recommended } } } } });
  let routing;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ setup() { routing = useModelRouting(); return () => null; } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, ref({ actorKey: "owner", projectSlug: "first" }));
  app.mount({});
  await flush();
  expect(routing.mainChatSelection.value).toEqual(recommended);
  queryClient.setQueryData(JSON.parse(routing.scopeKey.value),
    { ok: true, setups: { owner: { roles: { senior: { effective: saved, recommendation: recommended } } } } });
  await flush();
  expect(routing.mainChatSelection.value).toEqual(saved);
});

it("reads only main chat's selection in its own cache for the main view", async () => {
  configureHttpWebClient({ request });
  const saved = { engineId: "codex", modelId: "saved" };
  request.mockResolvedValueOnce({ ok: true, revision: 3, mainSelection: saved });
  let main;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ setup() { main = useModelRouting({ view: "main" }); return () => null; } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, ref({ actorKey: "owner", projectSlug: "first" }));
  app.mount({});
  await flush();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe("/api/accounts/model-routing?view=main");
  expect(JSON.parse(main.scopeKey.value).at(-1)).toBe("main");
  expect(main.mainChatSelection.value).toEqual(saved);
});

it("lets an open session read only main chat's view, leaving the full read to Models", async () => {
  configureHttpWebClient({ request });
  request.mockImplementation(async (path) => path.endsWith("?view=main")
    ? { ok: true, revision: 1, canConfigure: true, mainSelection: null }
    : { ok: true, revision: 1, canConfigure: true, setups: { owner: { roles: {} } }, engines: [] });
  // The session view's own call, exactly as the component makes it.
  const source = readFileSync(new URL("../../src/components/studio/vibe64-session/Vibe64AutopilotView.vue", import.meta.url), "utf8");
  const call = source.match(/useModelRouting\(\{[\s\S]*?\n\}\)/u)?.[0];
  expect(call).toBeTruthy();
  const sessionViewRouting = new Function("useModelRouting", "computed", "props", "selectedAssistantSessionId", `return ${call};`);
  let session;
  let dialog;
  const modelsOpen = ref(false);
  const Models = { setup() { useModelRouting(); return () => null; } };
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ setup() {
    session = sessionViewRouting(useModelRouting, computed, { sessionSelectionArchived: false }, ref("session-1"));
    // Start an AI session and renewal read the same main view.
    dialog = useModelRouting({ view: "main" });
    return () => modelsOpen.value ? h(Models) : null;
  } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, ref({ actorKey: "owner", projectSlug: "first" }));
  app.mount({});
  await flush();
  expect(request.mock.calls.map(([path]) => path)).toEqual(["/api/accounts/model-routing?view=main"]);
  expect(session.resource.data.value.canConfigure).toBe(true);
  expect(dialog.scopeKey.value).toBe(session.scopeKey.value);
  modelsOpen.value = true;
  await flush();
  expect(request.mock.calls.map(([path]) => path)).toEqual(["/api/accounts/model-routing?view=main", "/api/accounts/model-routing"]);
});
