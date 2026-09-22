import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as vue from "vue";
import { QueryClient } from "@tanstack/vue-query";
import { mergeConversationStream, normalizeThinkingMessageText } from "@jskit-ai/assistant-core/shared/conversation";
import { normalizeVibe64ConversationAttachments } from "@local/vibe64-runtime/shared";

// Run the real composable with Vue and the real query cache. Only the HTTP,
// routing and realtime boundaries are replaced with controlled adapters.
const source = (await readFile(new URL("../../src/composables/useVibe64ConversationLog.js", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?from "[^"]+";\n/gmu, "")
  .replace(/^export \{[\s\S]*?\};\s*$/mu, "return { useVibe64ConversationLog };");

function page(turns) {
  return { conversationLog: turns, pagination: { count: turns.length, totalTurnCount: turns.length }, ok: true };
}

function turn(id, text, answer = "") {
  return { turnId: id, user: { role: "user", text, messageId: `user-${id}` },
    ...(answer ? { assistant: { role: "assistant", text: answer, messageId: `answer-${id}` } } : {}) };
}

function fixture(t) {
  const scope = vue.effectScope();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const session = vue.ref({ sessionId: "session-1" });
  const requests = [];
  let options;
  let listener;
  const data = vue.ref(null);
  const http = { request(path, requestOptions) {
    return new Promise((resolve, reject) => requests.push({ path, ...requestOptions, resolve, reject }));
  } };
  const resource = { data, isLoading: vue.ref(false), loadError: vue.ref(""),
    reload() {
      return client.fetchQuery({
        queryKey: options.queryKey.value,
        queryFn: options.queryOptions.queryFn
      });
    }
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.query.queryHash === JSON.stringify(options?.queryKey.value)) data.value = event.query.state.data;
  });
  const dependencies = {
    computed: vue.computed,
    onScopeDispose: vue.onScopeDispose,
    ref: vue.ref,
    shallowRef: vue.shallowRef,
    watch: vue.watch,
    connectorDefinitions: [],
    getHttpWebClient: () => http,
    useQueryClient: () => client,
    useVibe64ProjectSlug: () => vue.ref("project-a"),
    usePaths: () => ({ api: () => "/api/vibe64/sessions" }),
    useEndpointResource: (value) => { options = value; return resource; },
    useRealtimeEvent: (value) => { listener = value; return value; },
    useRealtimeSocket: () => ({ on() {}, off() {} }),
    VIBE64_SESSION_CHANGED_EVENT: "vibe64.session.changed",
    VIBE64_SESSIONS_API_SUFFIX: "/vibe64/sessions",
    VIBE64_SURFACE_ID: "app",
    ROUTE_VISIBILITY_PUBLIC: "public",
    vibe64ConversationLogPath: (path, id) => `${path}/${id}/conversation-log`,
    vibe64SessionPath: (path, id, suffix = "") => `${path}/${id}${suffix}`,
    vibe64ConversationLogQueryKey: (surface, visibility, id, project) => [project, surface, visibility, id],
    readRefOrGetterValue: (value) => typeof value === "function" ? value() : vue.unref(value),
    vibe64SessionDebugLog() {},
    vibe64SessionDebugError: (error) => error.message,
    normalizeThinkingMessageText,
    mergeConversationStream,
    normalizeVibe64ConversationAttachments
  };
  const { useVibe64ConversationLog } = new Function(...Object.keys(dependencies), source)(...Object.values(dependencies));
  const model = scope.run(() => useVibe64ConversationLog({ session }));
  t.after(() => { scope.stop(); unsubscribe(); client.clear(); });
  return { model, requests, session, client,
    read: () => resource.reload(),
    seed: (value) => client.setQueryData(options.queryKey.value, value),
    event(savedTurn) {
      return listener.onEvent({ payload: { sessionId: session.value.sessionId,
        reason: savedTurn.assistant ? "assistant-response-bundle" : "codex-app-server-message-delivered",
        conversationLogPatch: { type: "upsert-turn", turn: savedTurn }
      } });
    }
  };
}

test("a slow initial history response retains the exchanges already delivered live", async (t) => {
  const f = fixture(t);
  const old = turn("000013", "Finish the plan", "13/13 complete");
  const pushed = turn("000014", "Commit and push", "Pushed to its own branch");
  const github = turn("000015", "Is this pushed to GitHub?", "origin/master was not modified");
  const spa = turn("000016", "How much work for a SPA?");
  const pending = f.read();
  f.event(pushed);
  f.event(github);
  f.event(spa);
  assert.deepEqual(f.model.turns.value.map((entry) => entry.turnId), ["000014", "000015", "000016"]);
  f.requests[0].resolve(page([old]));
  await pending;
  assert.deepEqual(f.model.turns.value.map((entry) => entry.turnId), ["000013", "000014", "000015", "000016"]);
});

test("a refresh cannot replace a completed answer with its earlier pending snapshot", async (t) => {
  const f = fixture(t);
  const user = turn("000016", "How much work for a SPA?");
  f.seed(page([user]));
  const pending = f.model.reload();
  f.event(turn("000016", user.user.text, "A hybrid conversion would take several weeks."));
  f.requests[0].resolve(page([user]));
  await pending;
  assert.equal(f.model.turns.value[0].assistant.text, "A hybrid conversion would take several weeks.");
});

test("a later authoritative read can remove an undone exchange", async (t) => {
  const f = fixture(t);
  const previous = turn("000015", "GitHub?", "Pushed");
  f.seed(page([previous]));
  f.event(turn("000016", "SPA?", "Several weeks"));
  const pending = f.read();
  f.requests[0].resolve(page([previous]));
  await pending;
  assert.deepEqual(f.model.turns.value.map((entry) => entry.turnId), ["000015"]);
});

test("a buffered pending turn does not erase an answer already present in the response", async (t) => {
  const f = fixture(t);
  const pending = f.read();
  const user = turn("000016", "SPA?");
  f.event(user);
  f.requests[0].resolve(page([turn("000016", "SPA?", "Several weeks")]));
  await pending;
  assert.equal(f.model.turns.value[0].assistant.text, "Several weeks");
});

test("a delayed live patch preserves already displayed answer and progress messages", async (t) => {
  const f = fixture(t);
  const first = { role: "thinking", text: "Checking", at: "2026-09-22T04:00:00.000Z" };
  const second = { role: "thinking", text: "Verified", at: "2026-09-22T04:01:00.000Z" };
  f.seed(page([{ ...turn("000016", "SPA?", "Several weeks"), thinking: [first, second], messages: [first, second] }]));
  f.event({ ...turn("000016", "SPA?"), thinking: [first], messages: [first] });
  assert.equal(f.model.turns.value[0].assistant.text, "Several weeks");
  assert.deepEqual(f.model.turns.value[0].thinking.map((message) => message.text), ["Checking", "Verified"]);
});

test("live progress corrects a matching message while retaining other delivered activity", (t) => {
  const f = fixture(t);
  const first = { role: "thinking", messageId: "thought-1", text: "Checking", at: "2026-09-22T04:00:00.000Z" };
  const second = { role: "commentary", messageId: "comment-1", text: "Verifying", at: "2026-09-22T04:01:00.000Z" };
  f.seed(page([{ ...turn("000016", "SPA?"), messages: [first, second] }]));
  f.event({ ...turn("000016", "SPA?"), messages: [{ ...first, text: "Checked" }] });
  assert.deepEqual(f.model.turns.value[0].messages.map((message) => message.text), ["SPA?", "Checked", "Verifying"]);
});

test("an invalid live patch cannot erase a pending history response", async (t) => {
  const f = fixture(t);
  const pending = f.read();
  const refresh = f.event({ assistant: { role: "assistant", text: "Missing turn identity" } });
  const original = page([turn("000016", "SPA?", "Several weeks")]);
  f.requests[0].resolve(original);
  await Promise.all([pending, refresh]);
  assert.equal(f.model.turns.value[0].assistant.text, "Several weeks");
});

test("switching sessions does not attach new-session messages to an earlier read", async (t) => {
  const f = fixture(t);
  const pending = f.read();
  f.session.value = { sessionId: "session-2" };
  await vue.nextTick();
  f.event(turn("000001", "Different session", "Different answer"));
  const original = page([turn("000016", "SPA?", "Several weeks")]);
  f.requests[0].resolve(original);
  assert.deepEqual(await pending, original);
  assert.equal(f.model.turns.value[0].assistant.text, "Different answer");
});

test("query cancellation reaches the history transport and rejects its late response", async (t) => {
  const f = fixture(t);
  const pending = f.read();
  const rejected = assert.rejects(pending, { message: "CancelledError" });
  await f.client.cancelQueries();
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[0].resolve(page([turn("000016", "SPA?", "Late answer")]));
  await rejected;
  assert.equal(f.model.turns.value.length, 0);
});
