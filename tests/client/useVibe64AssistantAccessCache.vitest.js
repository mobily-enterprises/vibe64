import { createRenderer, nextTick, ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { afterEach, expect, it, vi } from "vitest";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "../../src/lib/vibe64AssistantHost.js";

const project = vi.hoisted(() => ({ slug: null }));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => project.slug }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({ useCommand: () => ({ run: vi.fn() }) }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ api: (suffix) => `/api${suffix}` }) }));
import { useVibe64AssistantAccess } from "../../src/composables/useVibe64AssistantAccess.js";
import { useVibe64DatabaseTools } from "../../packages/vibe64-database-tools/src/client/composables/useVibe64DatabaseTools.js";

const request = vi.fn();
const originalClient = getHttpWebClient();
let app;
let queryClient;
afterEach(() => { app?.unmount(); queryClient?.clear(); request.mockReset(); configureHttpWebClient(originalClient); });
const flush = async () => { await nextTick(); await new Promise((resolve) => setTimeout(resolve, 0)); await nextTick(); };

it("isolates real access caches when users or projects change", async () => {
  configureHttpWebClient({ request });
  project.slug = ref("first");
  const viewer = ref({ actorKey: "owner" });
  const member = Promise.withResolvers();
  request.mockImplementation((path) => {
    if (viewer.value.actorKey === "member" && path.endsWith("assistant-access")) return member.promise;
    expect(path).toMatch(/assistant-access$/);
    return Promise.resolve({ ok: true, canUse: true, canUseAny: true, currentMode: "auto", purposes: { auto: { available: true } } });
  });
  let access;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ setup() {
    access = useVibe64AssistantAccess({ sessionId: "same-session", sessionsApiPath: "/api/sessions" });
    return () => null;
  } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer);
  app.mount({});
  await flush();
  expect(access.canUsePurpose("auto")).toBe(true);
  const ownerScope = access.scopeKey.value;

  viewer.value = { actorKey: "member" };
  await flush();
  expect(access.scopeKey.value).not.toBe(ownerScope);
  expect(access.access.value).toBeNull();
  expect(access.canUseChat.value).toBe(false);
  member.resolve({ ok: true, canUse: true, currentMode: "junior", purposes: {
    junior: { available: true, backupUsed: true }, auto: { available: false }, prompt_hint: { available: true }
  } });
  await flush();
  expect(access.canUseChat.value).toBe(true);
  expect(access.canUsePurpose("auto")).toBe(false);
  expect(access.canUsePurpose("prompt_hint")).toBe(true);

  const memberScope = access.scopeKey.value;
  project.slug.value = "second";
  await flush();
  expect(access.scopeKey.value).not.toBe(memberScope);
  expect(request).toHaveBeenCalledTimes(3);
  viewer.value = null;
  await flush();
  expect(access.access.value).toBeNull();
  expect(request).toHaveBeenCalledTimes(3);
});

it("isolates database private workspaces and Economy availability for owner, member and sign-out", async () => {
  configureHttpWebClient({ request });
  const viewer = ref({ actorKey: "owner" });
  const slug = ref("first");
  const member = Promise.withResolvers();
  request.mockImplementation(() => viewer.value?.actorKey === "member" ? member.promise : Promise.resolve({
    assistant: { available: true, engineId: "codex", model: "gpt-6-luna" }, workspace: { history: ["owner query"] }
  }));
  let database;
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ setup() {
      database = useVibe64DatabaseTools({ sessionId: "same-session", projectSlug: slug });
      return () => null;
    } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer);
  app.mount({});
  await flush();
  expect(database.state.value.workspace.history).toEqual(["owner query"]);
  viewer.value = { actorKey: "member" };
  await flush();
  expect(database.state.value).toBeNull();
  member.resolve({ assistant: { available: true, engineId: "opencode", model: "deepseek-flash" }, workspace: { history: [] } });
  await flush();
  expect(database.state.value.assistant.model).toBe("deepseek-flash");
  expect(database.state.value.workspace.history).toEqual([]);
  slug.value = "second";
  await flush();
  expect(request).toHaveBeenCalledTimes(3);
  viewer.value = null;
  await flush();
  expect(database.state.value).toBeNull();
  expect(request).toHaveBeenCalledTimes(3);
});
