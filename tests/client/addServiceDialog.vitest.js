// Add a service: the dialog reads what the chosen session's Stack can add,
// shows each kind with the Env names the app reads and what Preview gets, keeps
// a row it can't add disabled with the reason, and Add writes the Stack before
// it starts the AI task in that session.
import { createRenderer, nextTick, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import Vibe64AddServiceDialog from "../../src/components/studio/Vibe64AddServiceDialog.vue";

const DB_NAMES = { database: "DB_NAME", host: "DB_HOST", password: "DB_PASSWORD", port: "DB_PORT", username: "DB_USER" };
const SESSIONS = [{ sessionId: "s1", label: "Checkout" }, { sessionId: "s2", label: "Reports" }];

function choices({ managed = true, postgresql = {}, redis = {} } = {}) {
  return {
    ok: true,
    sessionId: "s1",
    stackHash: "h1",
    managed,
    choices: [
      { kind: "postgresql", piece: "jskit-postgresql", resourceId: "database", bindings: DB_NAMES, alternatives: [{ url: "DATABASE_URL" }],
        present: false, needsAi: false, refused: "", ...postgresql },
      { kind: "mysql", piece: "jskit-mysql", resourceId: "database", bindings: DB_NAMES, alternatives: [], present: true, needsAi: false,
        refused: "Already added: database (mysql)" },
      { kind: "redis", piece: null, resourceId: "redis", bindings: {}, alternatives: [], present: false, needsAi: true, refused: "", ...redis },
      { kind: "bucket", piece: "jskit-bucket", resourceId: "files", alternatives: [], present: false, needsAi: false, refused: "",
        bindings: { bucket: "JSKIT_STORAGE_S3_BUCKET", region: "JSKIT_STORAGE_S3_REGION" } },
      { kind: "service", piece: null, resourceId: null, bindings: {}, alternatives: [], present: false, needsAi: true, refused: "",
        services: [{ id: "web", exposure: "public" }] }
    ]
  };
}

let app;
afterEach(() => {
  app?.unmount();
  app = null;
});

function mount(props) {
  const node = () => ({});
  const renderer = createRenderer({ createComment: node, createElement: node, createText: node, setText() {}, setElementText() {},
    patchProp() {}, insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...Vibe64AddServiceDialog, render: () => null }, { modelValue: true, projectSlug: "shop", projectName: "Shop", ...props });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}

const posts = (calls) => calls.filter(([method]) => method === "POST");

/** The routes the dialog calls, answering as a session whose Stack is `answer`. */
function routes(answer = choices()) {
  const calls = [];
  const request = vi.fn(async (path, { method = "GET", body } = {}) => {
    calls.push([method, path, body]);
    if (path.endsWith("/stack/service-choices")) return answer;
    if (path.endsWith("/stack/services")) {
      return body.kind === "redis"
        ? { ok: true, added: null, needsAi: true, aiTask: { kind: "add-service", input: { kind: "redis", resourceId: "redis" } } }
        : { ok: true, needsAi: false, added: { component: "jskit-postgresql", id: "database", kind: "postgresql", bindings: DB_NAMES,
          alternatives: [{ url: "DATABASE_URL" }] }, aiTask: { kind: "add-service", input: { kind: "postgresql", resourceId: "database" } } };
    }
    if (path.endsWith("/ai-tasks")) return { ok: true, task: { id: "task-1", kind: body.kind } };
    throw new Error(`Unexpected ${method} ${path}`);
  });
  return { calls, request };
}

it("shows each kind with the Env names the app reads and what Preview gets, and disables what it can't add", async () => {
  const { calls, request } = routes();
  const dialog = mount({ sessions: SESSIONS, sessionId: "s1", request });
  await vi.waitFor(() => expect(dialog.rows.length).toBe(5));
  expect(calls[0]).toEqual(["GET", "/api/vibe64/sessions/s1/stack/service-choices", undefined]);
  expect(dialog.title).toBe("Add a service to Shop");
  const [postgresql, mysql, redis, bucket, service] = dialog.rows;
  expect(postgresql).toMatchObject({ kind: "postgresql", label: "PostgreSQL database", disabled: false, reason: "",
    appGets: "DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER (or DATABASE_URL)",
    previewGets: "A PostgreSQL database Vibe64 provides for this project" });
  expect(mysql).toMatchObject({ disabled: true, reason: "Already added: database (mysql)" });
  expect(redis).toMatchObject({ label: "Redis", disabled: false, needsAi: true,
    appGets: "The Env names your app's framework reads, which the AI declares",
    note: "Vibe64 has no ready entry for this stack: the AI declares it" });
  expect(bucket.previewGets).toBe("The app's own storage, until you enter the bucket's settings in Env");
  expect(service).toMatchObject({ label: "Another App Service", previewGets: "Runs in Preview only if the AI also declares it for Preview" });
  dialog.selectedKind = "mysql";
  expect(dialog.canAdd).toBe(false);
  dialog.selectedKind = "postgresql";
  expect(dialog.canAdd).toBe(true);
  expect(dialog.addLabel).toBe("Add PostgreSQL database");
});

it("says what Preview gets on a computer that supplies no values: the person's own server", async () => {
  const { request } = routes(choices({ managed: false }));
  const dialog = mount({ sessions: SESSIONS, sessionId: "s1", request });
  await vi.waitFor(() => expect(dialog.rows.length).toBe(5));
  expect(dialog.rows[0].previewGets).toBe("Your own PostgreSQL server, from the values in Env");
});

it("Add writes the Stack in the chosen session, then starts the AI task there, and says what happens next", async () => {
  const { calls, request } = routes();
  const added = vi.fn();
  const dialog = mount({ sessions: SESSIONS, sessionId: "s1", request, onAdded: added });
  await vi.waitFor(() => expect(dialog.rows.length).toBe(5));
  dialog.chosenSessionId = "s2";
  await nextTick();
  await vi.waitFor(() => expect(calls.at(-1)).toEqual(["GET", "/api/vibe64/sessions/s2/stack/service-choices", undefined]));
  await vi.waitFor(() => expect(dialog.rows.length).toBe(5));
  dialog.selectedKind = "postgresql";
  const adding = dialog.submit();
  expect(dialog.addLabel).toBe("Adding PostgreSQL database…");
  await adding;
  expect(posts(calls)).toEqual([
    ["POST", "/api/vibe64/sessions/s2/stack/services", { kind: "postgresql" }],
    ["POST", "/api/vibe64/sessions/s2/ai-tasks", { kind: "add-service", input: { kind: "postgresql", resourceId: "database" } }]
  ]);
  expect(calls.at(-1), "the rows are read again after Add").toEqual(["GET", "/api/vibe64/sessions/s2/stack/service-choices", undefined]);
  expect(dialog.resultMessage).toBe("Added `database` (postgresql) to genesis/stack.md in Reports. Next: the AI connects your app to it.");
  expect(added).toHaveBeenCalledWith({ sessionId: "s2", added: expect.objectContaining({ id: "database" }), needsAi: false,
    task: { id: "task-1", kind: "add-service" } });
});

it("a kind with no ready entry goes to the AI, which declares it; a refusal stays in the dialog", async () => {
  const { calls, request } = routes();
  const dialog = mount({ sessions: SESSIONS, sessionId: "s1", request });
  await vi.waitFor(() => expect(dialog.rows.length).toBe(5));
  dialog.selectedKind = "redis";
  await dialog.submit();
  expect(posts(calls).at(-1)).toEqual(["POST", "/api/vibe64/sessions/s1/ai-tasks", { kind: "add-service", input: { kind: "redis", resourceId: "redis" } }]);
  expect(dialog.resultMessage).toBe("The AI declares Redis in genesis/stack.md in Checkout, then connects your app to it.");
  request.mockImplementationOnce(async () => { throw new Error("Fix Update is still running. Wait for it to finish first."); });
  const before = calls.length;
  dialog.selectedKind = "postgresql";
  await dialog.submit();
  expect(dialog.addError).toBe("Fix Update is still running. Wait for it to finish first.");
  expect(dialog.resultMessage).toBe("");
  expect(calls.length, "no task starts after a refused Add").toBe(before);
});

it("another App Service asks for its name and the service that reaches it", async () => {
  const { calls, request } = routes();
  const dialog = mount({ sessions: SESSIONS, sessionId: "s1", request });
  await vi.waitFor(() => expect(dialog.rows.length).toBe(5));
  dialog.selectedKind = "service";
  expect(dialog.reachedBy).toBe("web");
  dialog.serviceName = "Worker!";
  expect(dialog.serviceNameError).toBe("Lowercase letters, digits and dashes, starting with a letter, up to 16 characters.");
  expect(dialog.canAdd).toBe(false);
  dialog.serviceName = "worker";
  expect(dialog.canAdd).toBe(true);
  request.mockImplementationOnce(async (path, { body }) => {
    calls.push(["POST", path, body]);
    return { ok: true, added: null, needsAi: true, aiTask: { kind: "add-service", input: { kind: "service", serviceId: "worker", exposure: "internal", reachedBy: "web" } } };
  });
  await dialog.submit();
  expect(posts(calls).map(([, path, body]) => [path, body])).toEqual([
    ["/api/vibe64/sessions/s1/stack/services", { kind: "service", serviceId: "worker", reachedBy: "web" }],
    ["/api/vibe64/sessions/s1/ai-tasks", { kind: "add-service", input: { kind: "service", serviceId: "worker", exposure: "internal", reachedBy: "web" } }]
  ]);
  expect(dialog.resultMessage).toBe("The AI declares worker in genesis/stack.md in Checkout, then connects your app to it.");
});

it("with no session open, it offers to open one and reads nothing", async () => {
  const { request } = routes();
  const openSession = vi.fn();
  const dialog = mount({ sessions: [], request, onOpenSession: openSession });
  await nextTick();
  expect(dialog.noSessions).toBe(true);
  expect(request).not.toHaveBeenCalled();
  dialog.openSession();
  expect(openSession).toHaveBeenCalledTimes(1);
});
