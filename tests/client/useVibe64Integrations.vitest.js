import { afterEach, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { useVibe64Integrations } from "@/composables/useVibe64Integrations.js";

const mocks = vi.hoisted(() => ({ resource: null, save: null, setup: null }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: () => mocks.resource
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => ({ isRunning: false,
    run: options.writeMethod === "PUT" ? (...args) => mocks.save(...args) : (...args) => mocks.setup(...args) })
}));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({ useRealtimeEvent: () => {} }));

const scopes = [];
let sequence = 0;
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  vi.unstubAllGlobals();
});
function payload(name) {
  return { baseHash: name, configuration: { schemaVersion: 1, integrations: Object.fromEntries(["calendar", "gmail", "gmail-2", "sheets", "docs"].map((id) => [id, {
    provider: "gmail", accountMode: "shared", authentication: { method: "oauth2", registrationRef: "google" }, scopes: ["https://www.googleapis.com/auth/gmail.readonly"]
  }])), registrations: { google: { source: "own", clientId: "fixture", clientSecretRef: "env:GOOGLE_SECRET", callbackUrlRef: "env:GOOGLE_CALLBACK" } }, extensions: { name } } };
}
function fixture() {
  mocks.resource = { data: ref(payload("first")), reload: vi.fn() };
  mocks.setup = vi.fn(async () => ({ status: "disconnected" }));
  const context = ref({ sessionId: "one", sessionsApiPath: `/projects/${++sequence}/sessions` });
  const scope = effectScope();
  scopes.push(scope);
  const selected = ref("");
  return { context, selected, model: scope.run(() => useVibe64Integrations(context, selected)) };
}

it.each([false, true])("cancelling replacement consent rereads the old grant without reconnecting (status failure: %s)", async (statusFails) => {
  const { selected, model } = fixture();
  selected.value = "calendar";
  await nextTick();
  model.connection.value = { status: "pending", attemptId: "replacement-attempt" };
  mocks.setup.mockReset();
  mocks.setup.mockResolvedValueOnce({ status: "cancelled" });
  if (statusFails) mocks.setup.mockRejectedValueOnce(new Error("Status temporarily unavailable"));
  else mocks.setup.mockResolvedValueOnce({ status: "connected", accountLabel: "Existing mailbox" });

  await model.runSetup("cancel");

  expect(mocks.setup.mock.calls.map(([request]) => request.body)).toEqual([
    { operation: "cancel", attemptId: "replacement-attempt" }, { operation: "status" }
  ]);
  if (statusFails) {
    expect(model.connection.value).toEqual({ status: "cancelled" });
    expect(model.connectionError.value).toBe("Status temporarily unavailable");
    mocks.setup.mockResolvedValueOnce({ status: "connected", accountLabel: "Existing mailbox" });
    await model.runSetup("status");
  }
  expect(model.connection.value).toEqual({ status: "connected", accountLabel: "Existing mailbox" });
  expect(model.connectionError.value).toBe("");
  expect(mocks.setup.mock.calls.every(([request]) => ["cancel", "status"].includes(request.body.operation))).toBe(true);
});

it("failed key replacement rereads current credential status without completing a setup request", async () => {
  const { selected, model } = fixture();
  selected.value = "calendar";
  await nextTick();
  const updated = payload("api-key");
  updated.configuration.integrations.calendar.authentication = { method: "api-key", secretRef: "env:KEY" };
  mocks.resource.data.value = updated;
  await nextTick();
  model.connection.value = { status: "connected", verifiedAt: "2026-09-11T00:00:00Z" };
  mocks.setup.mockReset();
  mocks.setup.mockRejectedValueOnce(new Error("Replacement key rejected"));
  mocks.setup.mockResolvedValueOnce({ status: "reconnect-required", verifiedAt: "2026-09-11T00:00:00Z" });
  await model.runSetup("connect");
  expect(mocks.setup.mock.calls.map(([request]) => request.body)).toEqual([
    { operation: "connect" }, { operation: "status" }
  ]);
  expect(model.connection.value.status).toBe("reconnect-required");
  expect(model.connectionError.value).toBe("Replacement key rejected");
});

it("returning from provider consent rechecks pending status and removes listeners on disposal", async () => {
  const browserWindow = new EventTarget();
  const browserDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("document", browserDocument);
  const { selected, model } = fixture();
  selected.value = "calendar";
  await nextTick();
  model.connection.value = { status: "pending", attemptId: "attempt-one" };
  mocks.setup.mockClear();
  mocks.setup.mockResolvedValue({ status: "connected", grantedScopes: ["calendar.read"] });
  browserWindow.dispatchEvent(new Event("focus"));
  await nextTick();
  expect(mocks.setup).toHaveBeenCalledTimes(1);
  expect(mocks.setup).toHaveBeenLastCalledWith(expect.objectContaining({ body: { operation: "status" } }));
  expect(model.connection.value).toEqual({ status: "connected", grantedScopes: ["calendar.read"] });
  browserWindow.dispatchEvent(new Event("focus"));
  expect(mocks.setup).toHaveBeenCalledTimes(1);
  model.connection.value = { status: "pending" };
  browserDocument.visibilityState = "hidden";
  browserDocument.dispatchEvent(new Event("visibilitychange"));
  expect(mocks.setup).toHaveBeenCalledTimes(1);
  browserDocument.visibilityState = "visible";
  browserDocument.dispatchEvent(new Event("visibilitychange"));
  await nextTick();
  expect(mocks.setup).toHaveBeenCalledTimes(2);
  scopes.at(-1).stop();
  model.connection.value = { status: "pending" };
  browserWindow.dispatchEvent(new Event("focus"));
  browserDocument.dispatchEvent(new Event("visibilitychange"));
  expect(mocks.setup).toHaveBeenCalledTimes(2);
});

it("return checks preserve pending state on failure and cannot refresh an inactive or dirty session", async () => {
  const browserWindow = new EventTarget();
  vi.stubGlobal("window", browserWindow);
  const { context, selected, model } = fixture();
  selected.value = "calendar";
  await nextTick();
  mocks.setup.mockClear();
  context.value.active = false;
  await nextTick();
  model.connection.value = { status: "pending", attemptId: "attempt-one" };
  browserWindow.dispatchEvent(new Event("focus"));
  expect(mocks.setup).not.toHaveBeenCalled();
  context.value.active = true;
  await nextTick();
  mocks.setup.mockClear();
  model.connection.value = { status: "pending", attemptId: "attempt-one" };
  model.configuration.value.extensions.name = "unsaved";
  browserWindow.dispatchEvent(new Event("focus"));
  expect(mocks.setup).not.toHaveBeenCalled();
  model.configuration.value.extensions.name = "first";
  mocks.setup.mockRejectedValue(new Error("Connection check failed"));
  browserWindow.dispatchEvent(new Event("focus"));
  await nextTick();
  expect(model.connection.value).toEqual({ status: "pending", attemptId: "attempt-one" });
  expect(model.connectionError.value).toBe("Connection check failed");
});

it.each([false, true])("a previous account's late setup response cannot replace the selected account (failure=%s)", async (failure) => {
  const { selected, model } = fixture();
  selected.value = "gmail";
  await nextTick();
  let settle;
  mocks.setup.mockImplementationOnce(() => new Promise((resolve, reject) => { settle = failure ? reject : resolve; }));
  const connecting = model.runSetup("connect");
  mocks.setup.mockResolvedValue({ status: "connected", accountLabel: "support@example.test" });
  selected.value = "gmail-2";
  await nextTick();
  await nextTick();
  settle(failure ? new Error("Previous account failed") : { status: "connected", accountLabel: "business@example.test" });
  await connecting;
  expect(model.connection.value).toEqual({ status: "connected", accountLabel: "support@example.test" });
  expect(model.connectionError.value).toBe("");
  expect(mocks.setup).toHaveBeenLastCalledWith(expect.objectContaining({ path: expect.stringMatching(/\/gmail-2\/setup$/) }));
});

it("verification inputs are sent only on connect and stay outside configuration", async () => {
  const { selected, model } = fixture();
  selected.value = "sheets";
  await nextTick();
  model.verificationInput.value.spreadsheetId = "sheet-123";
  await model.runSetup("connect");
  expect(mocks.setup).toHaveBeenLastCalledWith(expect.objectContaining({
    body: { operation: "connect", verificationInput: { spreadsheetId: "sheet-123" } }
  }));
  await model.runSetup("status");
  expect(mocks.setup).toHaveBeenLastCalledWith(expect.objectContaining({ body: { operation: "status" } }));
  expect(JSON.stringify(model.configuration.value)).not.toContain("sheet-123");
  expect(model.dirty.value).toBe(false);
});

it("verification drafts survive remount and remain isolated by integration and session", () => {
  const { context, selected, model } = fixture();
  selected.value = "sheets";
  model.verificationInput.value.spreadsheetId = "sheet-one";
  selected.value = "docs";
  expect(model.verificationInput.value).toEqual({});
  model.verificationInput.value.documentId = "doc-one";
  context.value.sessionId = "two";
  expect(model.verificationInput.value).toEqual({});
  context.value.sessionId = "one";
  expect(model.verificationInput.value).toEqual({ documentId: "doc-one" });
  selected.value = "sheets";
  expect(model.verificationInput.value).toEqual({ spreadsheetId: "sheet-one" });
  scopes.at(-1).stop();
  const scope = effectScope();
  scopes.push(scope);
  const restored = scope.run(() => useVibe64Integrations(context, selected));
  expect(restored.verificationInput.value).toEqual({ spreadsheetId: "sheet-one" });
});

it("a confirmed session switch clears the previous draft before accepting the new resource", async () => {
  const { context, model } = fixture();
  model.configuration.value.extensions.name = "draft";
  expect(model.dirty.value).toBe(true);
  context.value.sessionId = "two";
  expect(model.configuration.value).toBe(null);
  expect(model.dirty.value).toBe(false);
  mocks.resource.data.value = payload("second");
  await nextTick();
  expect(model.configuration.value.extensions.name).toBe("second");
  expect(model.changedElsewhere.value).toBe(false);
});

it.each([false, true])("late save result from the previous session is ignored (failure=%s)", async (failure) => {
  const { context, model } = fixture();
  let settle;
  mocks.save = () => new Promise((resolve, reject) => { settle = failure ? reject : resolve; });
  model.configuration.value.extensions.name = "draft";
  const saving = model.save();
  context.value.sessionId = "two";
  mocks.resource.data.value = payload("second");
  await nextTick();
  settle(failure ? Object.assign(new Error("old conflict"), { statusCode: 409 }) : payload("old saved"));
  await saving;
  expect(model.configuration.value.extensions.name).toBe("second");
  expect(model.error.value).toBe("");
  expect(model.changedElsewhere.value).toBe(false);
});

it("late reload from a discarded previous-session draft cannot replace the current session", async () => {
  const { context, model } = fixture();
  let finish;
  mocks.resource.reload = () => new Promise((resolve) => { finish = resolve; });
  const discarding = model.discard();
  context.value.sessionId = "two";
  mocks.resource.data.value = payload("second");
  await nextTick();
  finish({ data: payload("old reload") });
  await discarding;
  expect(model.configuration.value.extensions.name).toBe("second");
});


it("returning to a session restores its draft and detects external changes", async () => {
  const { context, model } = fixture();
  model.configuration.value.extensions.name = "first draft";
  context.value.sessionId = "two";
  mocks.resource.data.value = payload("second");
  await nextTick();
  model.configuration.value.extensions.name = "second draft";
  context.value.sessionId = "one";
  expect(model.configuration.value.extensions.name).toBe("first draft");
  mocks.resource.data.value = payload("first changed elsewhere");
  await nextTick();
  expect(model.configuration.value.extensions.name).toBe("first draft");
  expect(model.changedElsewhere.value).toBe(true);
  context.value.sessionId = "two";
  mocks.resource.data.value = payload("second");
  await nextTick();
  expect(model.configuration.value.extensions.name).toBe("second draft");
  expect(model.changedElsewhere.value).toBe(false);
});

it("leaving and remounting preserves a draft without writing configuration", async () => {
  const { context, model } = fixture();
  model.configuration.value.extensions.name = "keep while in Env";
  scopes.at(-1).stop();
  const scope = effectScope();
  scopes.push(scope);
  const restored = scope.run(() => useVibe64Integrations(context, ref("")));
  expect(restored.configuration.value.extensions.name).toBe("keep while in Env");
  expect(restored.dirty.value).toBe(true);
  expect(restored.changedElsewhere.value).toBe(false);
});

it("production isolates saved configuration and commands while restoring development drafts", async () => {
  const { context, selected, model } = fixture();
  model.configuration.value.extensions.name = "unsaved development";
  context.value = { ...context.value, integrationEnvironment: "production", owner: true,
    sourceOperationsSuspended: true, productionIntegrationsApiPath: "/projects/example/deployments/integrations" };
  mocks.resource.data.value = { ...payload("published"), releaseId: "release-one", environment: "production" };
  await nextTick();
  expect(model.configuration.value.extensions.name).toBe("published");
  selected.value = "calendar";
  await nextTick();
  mocks.setup.mockClear();
  await model.runSetup("connect");
  expect(mocks.setup).toHaveBeenCalledWith({ path: "/projects/example/deployments/integrations/calendar/setup",
    body: { operation: "connect", releaseId: "release-one" } });
  mocks.save = vi.fn();
  model.configuration.value.extensions.name = "attempted production edit";
  await model.save();
  expect(mocks.save).not.toHaveBeenCalled();
  // The form disables edits; reset this deliberate direct-state mutation.
  model.configuration.value.extensions.name = "published";
  context.value = { ...context.value, integrationEnvironment: "development", sourceOperationsSuspended: false };
  await nextTick();
  expect(model.configuration.value.extensions.name).toBe("unsaved development");
  expect(model.dirty.value).toBe(true);
  expect(model.releaseId.value).toBe("");
});

it("production commands require an owner and ignore completions from a replaced release", async () => {
  const { context, selected, model } = fixture();
  context.value = { ...context.value, integrationEnvironment: "production", owner: false,
    productionIntegrationsApiPath: "/projects/other/deployments/integrations" };
  mocks.resource.data.value = { ...payload("published"), releaseId: "release-one", environment: "production" };
  selected.value = "calendar";
  await nextTick();
  mocks.setup.mockClear();
  await model.runSetup("connect");
  expect(mocks.setup).not.toHaveBeenCalled();
  context.value = { ...context.value, owner: true };
  let complete;
  mocks.setup.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const pending = model.runSetup("connect");
  mocks.resource.data.value = { ...payload("published"), releaseId: "release-two", environment: "production" };
  await nextTick();
  complete({ status: "connected", accountLabel: "old account" });
  await pending;
  expect(model.releaseId.value).toBe("release-two");
  expect(model.connection.value?.accountLabel).not.toBe("old account");
});

it("a new release removing the selected integration stops setup requests", async () => {
  const { context, selected, model } = fixture();
  context.value = { ...context.value, integrationEnvironment: "production", owner: true,
    productionIntegrationsApiPath: "/projects/removed/deployments/integrations" };
  mocks.resource.data.value = { ...payload("published"), releaseId: "one", environment: "production" };
  selected.value = "calendar";
  await nextTick();
  await model.runSetup("status");
  expect(mocks.setup).toHaveBeenCalled();
  mocks.setup.mockClear();
  const removed = payload("next");
  delete removed.configuration.integrations.calendar;
  mocks.resource.data.value = { ...removed, releaseId: "two", environment: "production" };
  await nextTick();
  await nextTick();
  await model.runSetup("status");
  await model.runSetup("connect");
  expect(model.connection.value).toBe(null);
  expect(mocks.setup).not.toHaveBeenCalled();
  selected.value = "gmail";
  await nextTick();
  await model.runSetup("status");
  expect(mocks.setup).toHaveBeenLastCalledWith({ path: "/projects/removed/deployments/integrations/gmail/setup",
    body: { operation: "status", releaseId: "two" } });
});

it("inherited object properties cannot select an integration or invoke setup", async () => {
  const { selected, model } = fixture();
  mocks.resource.data.value = payload("configured");
  await nextTick();
  mocks.setup.mockClear();
  for (const id of ["__proto__", "constructor", "toString"]) {
    selected.value = id;
    await nextTick();
    await model.runSetup("status");
    await model.runSetup("connect");
  }
  expect(mocks.setup).not.toHaveBeenCalled();
});


it("binds setup to the selected saved request and reloads the server conversation on completion", async () => {
  const { context, selected, model } = fixture();
  const refresh = vi.fn(async () => {});
  mocks.resource.data.value = payload("a".repeat(64));
  context.value.refreshConversation = refresh;
  context.value.integrationSetupRequest = { sessionId: "one", integrationId: "calendar", turnId: "000001", requestId: "b".repeat(64) };
  selected.value = "calendar";
  await nextTick();
  mocks.setup.mockClear();
  const decision = { outcome: "completed", requestId: "b".repeat(64), continuation: { status: "accepted" } };
  mocks.setup.mockResolvedValue({ status: "connected", integrationSetup: decision });
  await model.runSetup("connect");
  expect(mocks.setup).toHaveBeenLastCalledWith(expect.objectContaining({ body: {
    operation: "connect", setupRequest: { turnId: "000001", requestId: "b".repeat(64), configurationHash: "a".repeat(64) }
  } }));
  expect(refresh).toHaveBeenCalledTimes(1);
  // A later reconnection is account management, not another completion of this request.
  await model.runSetup("connect");
  expect(mocks.setup).toHaveBeenLastCalledWith(expect.objectContaining({ body: { operation: "connect" } }));
});

it.each([false, true])("resumes verified setup and preserves the connection when delivery is uncertain (uncertain=%s)", async (uncertain) => {
  const { context, selected, model } = fixture();
  context.value.refreshConversation = vi.fn(async () => {});
  context.value.integrationSetupRequest = {
    sessionId: "one", integrationId: "calendar", turnId: "000001", requestId: "b".repeat(64)
  };
  selected.value = "calendar";
  await nextTick();
  mocks.setup.mockClear();
  const decision = { outcome: "completed", requestId: "b".repeat(64), continuation: { status: "pending" } };
  mocks.setup.mockImplementation(async ({ path }) => {
    if (path.endsWith("/integration-setup/resume")) {
      if (uncertain) throw new Error("Delivery unconfirmed. Check again.");
      return { integrationSetup: { ...decision, continuation: { status: "accepted" } } };
    }
    return { status: "connected", integrationSetup: decision };
  });
  await model.runSetup("connect");
  expect(mocks.setup).toHaveBeenCalledTimes(2);
  expect(mocks.setup).toHaveBeenLastCalledWith({
    path: `${context.value.sessionsApiPath}/one/integration-setup/resume`,
    body: { turnId: "000001", requestId: "b".repeat(64) }
  });
  expect(model.connection.value.status).toBe("connected");
  expect(model.connectionError.value).toBe(uncertain ? "Delivery unconfirmed. Check again." : "");
  expect(model.connection.value.integrationSetup.continuation.status).toBe(uncertain ? "pending" : "accepted");
  expect(context.value.refreshConversation).toHaveBeenCalledTimes(1);
});

it("does not attach another session's, slot's or production request to application commands", async () => {
  const { context, selected, model } = fixture();
  selected.value = "calendar";
  await nextTick();
  for (const request of [
    { sessionId: "other", integrationId: "calendar", turnId: "000001", requestId: "b".repeat(64) },
    { sessionId: "one", integrationId: "gmail", turnId: "000001", requestId: "b".repeat(64) },
    { sessionId: "one", integrationId: "calendar", turnId: ["000001"], requestId: "b".repeat(64) }
  ]) {
    context.value.integrationSetupRequest = request;
    await nextTick();
    mocks.setup.mockClear();
    await model.runSetup("connect");
    expect(mocks.setup).toHaveBeenLastCalledWith(expect.objectContaining({ body: { operation: "connect" } }));
  }
  context.value = { ...context.value, integrationEnvironment: "production", owner: true,
    productionIntegrationsApiPath: "/projects/example/deployments/integrations",
    integrationSetupRequest: { sessionId: "one", integrationId: "calendar", turnId: "000001", requestId: "b".repeat(64) } };
  mocks.resource.data.value = { ...payload("published"), releaseId: "release-one", environment: "production" };
  await nextTick();
  mocks.setup.mockClear();
  await model.runSetup("connect");
  expect(mocks.setup).toHaveBeenLastCalledWith(expect.objectContaining({ body: { operation: "connect", releaseId: "release-one" } }));

});


it("Analytics public configuration never starts a connection command", async () => {
  const { selected, model } = fixture();
  const updated = payload("analytics");
  updated.configuration.integrations.analytics = {
    provider: "google-analytics", accountMode: "shared", scopes: [],
    authentication: { method: "none" }, settings: { measurementId: "G-ABC1234567" }
  };
  mocks.resource.data.value = updated;
  await nextTick();
  mocks.setup.mockClear();
  selected.value = "analytics";
  await nextTick();
  for (const operation of ["status", "connect", "disconnect", "cancel"]) await model.runSetup(operation);
  expect(mocks.setup).not.toHaveBeenCalled();
  expect(model.connection.value).toBeNull();
  expect(model.configuration.value.integrations.analytics).toEqual(updated.configuration.integrations.analytics);
});


it("production payment reviews are owner-only and tied to the published release", async () => {
  const { context, selected, model } = fixture();
  const published = payload("payments");
  published.configuration.integrations.stripe = { provider: "stripe", accountMode: "shared", authentication: { method: "api-key", secretRef: "env:STRIPE_KEY" } };
  published.configuration.extensions.payments = { version: 1, environments: { live: { integrationId: "stripe", providerAccountId: "acct_fixture", webhookSecretRef: "env:WEBHOOK", returnUrlRef: "env:RETURN" } }, plans: {} };
  context.value = { ...context.value, integrationEnvironment: "production", owner: false,
    sourceOperationsSuspended: true, productionIntegrationsApiPath: "/projects/payments/deployments/integrations" };
  mocks.resource.data.value = { ...published, releaseId: "one", environment: "production" };
  selected.value = "stripe";
  await nextTick();
  mocks.setup.mockClear();
  await model.runPaymentOperation({ operation: "payments-preview", paymentEnvironment: "live" });
  expect(mocks.setup).not.toHaveBeenCalled();
  context.value = { ...context.value, owner: true };
  mocks.setup.mockResolvedValueOnce({ status: "payments", paymentEnvironment: "live", review: { reviewId: "review", pending: false, drift: [] } });
  await model.runPaymentOperation({ operation: "payments-preview", paymentEnvironment: "live" });
  expect(mocks.setup).toHaveBeenLastCalledWith({ path: "/projects/payments/deployments/integrations/stripe/setup",
    body: { operation: "payments-preview", paymentEnvironment: "live", releaseId: "one" } });
  let complete;
  mocks.setup.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const pending = model.runPaymentOperation({ operation: "payments-publish", paymentEnvironment: "live", reviewId: "review" });
  mocks.resource.data.value = { ...published, releaseId: "two", environment: "production" };
  await nextTick();
  complete({ status: "payments", review: { reviewId: "obsolete" } });
  await pending;
  expect(model.paymentResult.value).toBeNull();
  mocks.setup.mockClear();
  await model.runPaymentOperation({ operation: "payments-publish", paymentEnvironment: "live", reviewId: "review" });
  expect(mocks.setup).not.toHaveBeenCalled();
});
