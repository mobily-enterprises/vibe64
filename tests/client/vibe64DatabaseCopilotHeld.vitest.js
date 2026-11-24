import { createRenderer, ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "../../src/lib/vibe64AssistantHost.js";

const feedback = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({ useCommand: () => ({ isRunning: false, run: vi.fn() }) }));
vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({ useUiFeedback: () => feedback }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ api: (suffix) => `/api${suffix}` }) }));
import { useVibe64DatabaseTools } from "../../packages/vibe64-database-tools/src/client/composables/useVibe64DatabaseTools.js";

// A copilot question runs an AI turn and its queries, which can outlast the hosted edge's minute: the server answers
// within two seconds that it is answering, and the page repeats the same question until its answer.
const request = vi.fn();
const originalClient = getHttpWebClient();
let app;
let queryClient;
let database;

beforeEach(() => {
  configureHttpWebClient({ request });
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ setup() {
      database = useVibe64DatabaseTools({ active: false, projectSlug: "project-a", sessionId: "session-a" });
      return () => null;
    } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  app.use(VueQueryPlugin, { queryClient });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, ref({ actorKey: "owner" }));
  app.mount({});
});

afterEach(() => {
  app?.unmount();
  queryClient?.clear();
  request.mockReset();
  feedback.error.mockReset();
  configureHttpWebClient(originalClient);
  vi.useRealTimers();
});

function ask() {
  return database.assistantCommand.run({
    path: database.assistantEndpoint.value,
    payload: { messages: [{ content: "What is stored here?", role: "user", table: "" }] }
  });
}

it("repeats a held question with the same request until its answer, and shows no failure", async () => {
  request.mockResolvedValueOnce({ ok: true, answering: true, requestId: "held", waitingFor: "answering" })
    .mockResolvedValueOnce({ ok: true, answer: "The books table.", queries: [] });
  await expect(ask()).resolves.toMatchObject({ answer: "The books table." });
  expect(request).toHaveBeenCalledTimes(2);
  const [[firstPath, first], [, second]] = request.mock.calls;
  expect(firstPath).toBe("/api/vibe64/database/sessions/session-a/assistant");
  expect(first.method).toBe("POST");
  expect(first.body.requestId).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u);
  expect(first.body.repeat).toBeUndefined();
  expect(first.body.messages).toEqual([{ content: "What is stored here?", role: "user", table: "" }]);
  expect(second.body).toMatchObject({ requestId: first.body.requestId, repeat: true });
  expect(feedback.error).not.toHaveBeenCalled();
  expect(database.assistantBusy.value).toBe(false);
});

it.each([0, 502, 504])("repeats a question whose answer was lost with status %s, and never shows that failure", async (status) => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  request.mockRejectedValueOnce(Object.assign(new Error(`Request failed with status ${status}.`), { status }))
    .mockResolvedValueOnce({ ok: true, answer: "The books table.", queries: [] });
  const asking = ask();
  await vi.advanceTimersByTimeAsync(5_000);
  await expect(asking).resolves.toMatchObject({ answer: "The books table." });
  expect(request.mock.calls[1][1].body.repeat).toBe(true);
  expect(feedback.error).not.toHaveBeenCalled();
});
