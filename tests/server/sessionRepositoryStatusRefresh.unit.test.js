import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import * as vue from "vue";
import * as realtime from "../../src/lib/vibe64RepositoryRealtime.js";
import * as visibility from "../../src/lib/vibe64SessionToolbarVisibility.js";
import { readRefOrGetterValue } from "../../src/lib/vueRefOrGetterValue.js";

// Exercise the real registry and Vue scheduling with controlled HTTP/realtime boundaries.
const source = (await readFile(new URL("../../src/composables/useVibe64SessionRepositoryStatusRegistry.js", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?from "[^"]+";\n/gmu, "")
  .replace(/^export \{[\s\S]*?\};\s*$/mu, "return { useVibe64SessionRepositoryStatusRegistry };");

function fixture(t, { suspended = false } = {}) {
  const requests = [];
  const states = [];
  const access = vue.ref(suspended);
  const dependencies = {
    computed: vue.computed, onScopeDispose: vue.onScopeDispose, watch: vue.watch,
    ...realtime, ...visibility, readRefOrGetterValue,
    useRealtimeEvent: () => {},
    VIBE64_SESSION_CHANGED_EVENT: "vibe64.session.changed",
    VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT: "vibe64.source-editor.file.changed",
    vibe64SessionPath: (path, id, suffix) => `${path}/${id}${suffix}`,
    vibe64SessionCheckUpdatesPath: (path, id) => `${path}/${id}/updates/check`,
    getHttpWebClient: () => ({
      request(path, options) {
        const pending = Promise.withResolvers();
        requests.push({ path, ...options, ...pending });
        return pending.promise;
      }
    })
  };
  const { useVibe64SessionRepositoryStatusRegistry } = new Function(
    ...Object.keys(dependencies), source
  )(...Object.values(dependencies));
  const scope = vue.effectScope();
  const registry = scope.run(() => useVibe64SessionRepositoryStatusRegistry({
    onState: ({ workState }) => states.push(workState),
    selectedSessionId: vue.ref("session-a"),
    sessionSourceOperationsSuspended: () => access.value,
    sessions: vue.ref([{ sessionId: "session-a" }]),
    sessionsApiPath: vue.ref("/api/sessions")
  }));
  t.after(() => scope.stop());
  return { registry, requests, states, access, scope };
}

async function finishInitialCheck(f) {
  f.requests[0].resolve({ ok: true, canonicalCommit: "old", updateAvailable: false });
  await setImmediate();
  f.requests[1].resolve({ ok: true, canonicalCommit: "old", unsaved: false, updateAvailable: false });
  await setImmediate();
}

test("manual refresh forces a server check and remains pending through the work inspection", async (t) => {
  const f = fixture(t);
  await finishInitialCheck(f);
  let complete = false;
  const refresh = f.registry.refresh("session-a").then(() => { complete = true; });
  assert.deepEqual(f.requests[2].body, { force: true });
  assert.equal(f.requests[2].path, "/api/sessions/session-a/updates/check");
  f.requests[2].resolve({ ok: true, canonicalCommit: "new", updateAvailable: true });
  await setImmediate();
  assert.equal(complete, false);
  assert.equal(f.states.at(-1).updateAvailable, true);
  assert.equal(f.requests[3].path, "/api/sessions/session-a/work");
  f.requests[3].resolve({ ok: true, canonicalCommit: "new", unsaved: false, updateAvailable: true });
  await refresh;
  assert.equal(complete, true);
  assert.equal(f.states.at(-1).updateStatusPending, undefined);
  assert.equal(f.states.at(-1).updateAvailable, true);
  assert.equal(f.requests.length, 4);
});

test("manual refresh during a background check waits for its forced follow-up and fresh work", async (t) => {
  const f = fixture(t);
  let complete = false;
  const refresh = f.registry.refresh("session-a").then(() => { complete = true; });
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({ ok: true, canonicalCommit: "old", updateAvailable: false });
  await setImmediate();
  assert.equal(complete, false);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[1].body, { force: true });
  f.requests[1].resolve({ ok: true, canonicalCommit: "new", updateAvailable: true });
  await setImmediate();
  assert.equal(complete, false);
  f.requests[2].resolve({ ok: true, canonicalCommit: "new", unsaved: true, updateAvailable: true });
  await refresh;
  assert.equal(f.states.at(-1).unsaved, true);
  assert.equal(f.states.at(-1).updateAvailable, true);
  assert.equal(f.requests.length, 3);
});

test("a failed check settles and a later manual check recovers without saving or updating", async (t) => {
  const f = fixture(t);
  await finishInitialCheck(f);
  const failed = f.registry.refresh("session-a");
  f.requests[2].reject(new Error("Server unreachable"));
  await failed;
  assert.equal(f.states.at(-1).error, "Server unreachable");
  assert.equal(f.requests.length, 3);
  const retry = f.registry.refresh("session-a");
  f.requests[3].resolve({ ok: true, canonicalCommit: "old", updateAvailable: false });
  await setImmediate();
  f.requests[4].resolve({ ok: true, canonicalCommit: "old", unsaved: true, updateAvailable: false });
  await retry;
  assert.equal(f.states.at(-1).error, "");
  assert.equal(f.states.at(-1).unsaved, true);
  assert.ok(f.requests.every(({ path }) => /\/(updates\/check|work)$/u.test(path)));
});

test("manual checks respect suspended source access and disposed sessions", async (t) => {
  const f = fixture(t, { suspended: true });
  await f.registry.refresh("session-a");
  assert.equal(f.requests.length, 0);
  f.scope.stop();
  f.access.value = false;
  await f.registry.refresh("session-a");
  assert.equal(f.requests.length, 0);
});
