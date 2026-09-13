import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runVibe64Command } from "@local/vibe64-execution/server";
import {
  createIntegrationSetupRequest, INTEGRATION_SETUP_PROTOCOL, parseIntegrationSetupResponse, runIntegrationSetupCommand
} from "../../packages/vibe64-source-editor/src/server/integrationSetupCommand.js";

const request = { protocol: INTEGRATION_SETUP_PROTOCOL, requestId: "request-1", operation: "status" };
const reply = (values = {}) => ({ protocol: request.protocol, requestId: request.requestId, status: "disconnected", ...values });
const options = {
  sourceRoot: "/tmp/application", command: { argv: ["node", "scripts/integrations.js"], workdir: "." },
  env: { GOOGLE_SECRET: "private-value" }, runtimes: ["nodejs"], project: { id: "one" }, session: { id: "editing" },
  selection: { operation: "status", integrationId: "calendar" }
};

test("account labels are bounded display metadata only for an existing connection", () => {
  for (const status of ["connected", "reconnect-required"]) {
    const value = reply({ status, accountLabel: "business@example.test" });
    assert.deepEqual(parseIntegrationSetupResponse(JSON.stringify(value), request), value);
  }
  for (const accountLabel of ["", " ", "x".repeat(257), "mail\nheader", "hidden\u202Etext", {}, null]) {
    assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(reply({ status: "connected", accountLabel })), request));
  }
  assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(reply({ accountLabel: "old@example.test" })), request));
});

test("setup command uses declared argv and private Env while sending only bounded operation input", async () => {
  for (const [command, runtimes] of [
    [{ argv: ["node", "scripts/integrations.js"], workdir: "." }, ["node26"]],
    [{ argv: ["php", "artisan", "integrations:setup"], workdir: "backend" }, ["php84"]]
  ]) {
    let execution;
    const result = await runIntegrationSetupCommand({ ...options, command, runtimes, runCommand: async (value) => {
      execution = value;
      const input = JSON.parse(value.input);
      assert.equal(input.operation, "status");
      assert.equal(input.integrationId, "calendar");
      assert.equal(input.protocol, request.protocol);
      assert.ok(input.requestId);
      assert.equal(value.input.includes("private-value"), false);
      return { ok: true, stdout: JSON.stringify({ ...reply(), requestId: input.requestId }) };
    } });
    assert.equal(result.status, "disconnected");
    assert.equal(execution.command, command.argv[0]);
    assert.deepEqual(execution.args, command.argv.slice(1));
    assert.deepEqual(execution.runtimes, runtimes);
    assert.deepEqual(execution.env, options.env);
    assert.equal(execution.cwd, path.resolve(options.sourceRoot, command.workdir));
    assert.equal(execution.timeout, 30000);
    assert.equal(execution.maxBuffer, 32768);
    assert.deepEqual(execution.allowedRoots, [options.sourceRoot]);
  }
});

test("setup protocol crosses the real execution gateway with stdin, working directory and private Env", async () => {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), "integration-command-"));
  try {
    await writeFile(path.join(sourceRoot, "setup.cjs"), `
      const fs = require("node:fs");
      const request = JSON.parse(fs.readFileSync(0, "utf8"));
      if (process.cwd() !== process.env.EXPECTED_SOURCE ||
          process.env.PROVIDER_KEY !== "fixture-private-key" ||
          request.operation !== "status" || request.integrationId !== "calendar") process.exit(2);
      process.stdout.write(JSON.stringify({
        protocol: request.protocol, requestId: request.requestId, status: "disconnected"
      }) + "\\n");
    `);
    const result = await runIntegrationSetupCommand({
      ...options, sourceRoot, runCommand: runVibe64Command,
      command: { argv: [process.execPath, "setup.cjs"], workdir: "." },
      runtimes: [], env: { EXPECTED_SOURCE: sourceRoot, PROVIDER_KEY: "fixture-private-key" }
    });
    assert.equal(result.status, "disconnected");
    assert.deepEqual(Object.keys(result).sort(), ["protocol", "requestId", "status"]);
    assert.equal(JSON.stringify(result).includes("fixture-private-key"), false);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("setup output rejects tokens, unrelated responses, oversized output and invalid JSON", () => {
  for (const value of [
    { ...reply(), accessToken: "secret" }, { ...reply(), refreshToken: "secret" },
    { ...reply(), requestId: "other" }, { ...reply(), protocol: "other" },
    { ...reply(), status: "success" }, { ...reply(), grantedScopes: [42] },
    { ...reply(), verifiedAt: "yesterday" }, { ...reply(), callbackUrl: "https://app.test/callback?secret=1" }
  ]) assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(value), request), { code: "vibe64_integration_setup_invalid" });
  for (const text of ["not json", "null", "[]", " ".repeat(32769)]) {
    assert.throws(() => parseIntegrationSetupResponse(text, request), { code: "vibe64_integration_setup_invalid" });
  }
});

test("pending OAuth returns a resumable attempt while rejecting unsafe authorization links", () => {
  const pending = reply({ status: "pending", authorizationUrl: "https://provider.test/authorize?state=one",
    attemptId: "one", expiresAt: "2026-09-11T12:00:00Z" });
  assert.deepEqual(parseIntegrationSetupResponse(JSON.stringify(pending), request), pending);
  for (const authorizationUrl of ["javascript:alert(1)", "https://user:secret@provider.test/", "http://remote.test/", "https://provider.test/#secret"]) {
    assert.throws(() => parseIntegrationSetupResponse(JSON.stringify({ ...pending, authorizationUrl }), request), { code: "vibe64_integration_setup_invalid" });
  }
  assert.throws(() => parseIntegrationSetupResponse(JSON.stringify({ ...pending, attemptId: "" }), request));
  assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(pending), { ...request, operation: "disconnect" }));
});

test("cancel and disconnect must report their own completion and cannot retain an authorization URL", () => {
  for (const [operation, status] of [["cancel", "cancelled"], ["disconnect", "disconnected"]]) {
    const input = { ...request, operation };
    assert.equal(parseIntegrationSetupResponse(JSON.stringify(reply({ status })), input).status, status);
    assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(reply({ status: "connected" })), input));
    assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(reply({ status, authorizationUrl: "https://provider.test/" })), input));
  }
});

test("failed and throwing commands do not expose private stdout, stderr or exception text", async () => {
  for (const failure of [
    async () => ({ ok: false, stdout: "private-value", stderr: "private-value" }),
    async () => { throw new Error("private-value"); }
  ]) {
    await assert.rejects(runIntegrationSetupCommand({ ...options, runCommand: failure }), (error) => {
      assert.equal(error.code, "vibe64_integration_setup_failed");
      assert.equal(error.message.includes("private-value"), false);
      return true;
    });
  }
  await assert.rejects(runIntegrationSetupCommand({ ...options, runCommand: async () => ({ ok: false, timedOut: true }) }),
    { code: "vibe64_integration_setup_timed_out" });
});

test("invalid operations and unbounded verification inputs fail before execution", async () => {
  for (const selection of [
    { operation: "invoke", integrationId: "calendar" },
    { operation: "status", integrationId: "../other" },
    { operation: "cancel", integrationId: "calendar" },
    { operation: "status", integrationId: "calendar", verificationInput: {} },
    { operation: "connect", integrationId: "calendar", verificationInput: { data: "x".repeat(32768) } }
  ]) {
    await assert.rejects(runIntegrationSetupCommand({ ...options, selection, runCommand: async () => assert.fail("must not execute") }),
      { code: "vibe64_integration_setup_invalid" });
  }
});


test("setup readiness accepts only fixed safe issue codes for unconfigured results", () => {
  for (const setupIssue of ["credentials-missing", "callback-invalid"]) {
    const result = reply({ status: "unconfigured", setupIssue });
    assert.deepEqual(parseIntegrationSetupResponse(JSON.stringify(result), request), result);
    assert.throws(() => parseIntegrationSetupResponse(JSON.stringify({ ...result, status: "connected" }), request));
  }
  for (const setupIssue of ["secret-value", { message: "private output" }, null]) {
    assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(reply({ status: "unconfigured", setupIssue })), request));
  }
});

test("payment catalogue commands require explicit environments and bounded reviewed output", async () => {
  const review = { reviewId: "a".repeat(64), changes: [{ action: "create-price", planId: "pro", amount: 1200, currency: "USD", interval: "month" }], drift: [], removed: [], pending: false };
  for (const operation of ["payments-preview", "payments-publish"]) {
    const selection = { operation, integrationId: "billing", paymentEnvironment: "sandbox", ...(operation === "payments-publish" ? { reviewId: review.reviewId } : {}) };
    await runIntegrationSetupCommand({ ...options, selection, runCommand: async ({ input }) => {
      const request = JSON.parse(input);
      assert.equal(request.paymentEnvironment, "sandbox");
      assert.equal(request.reviewId, selection.reviewId);
      return { ok: true, stdout: JSON.stringify({ protocol: request.protocol, requestId: request.requestId, status: "payments", paymentEnvironment: "sandbox", providerAccountId: "acct_fixture", review }) };
    } });
  }
  const request = { protocol: INTEGRATION_SETUP_PROTOCOL, requestId: "payment-1", operation: "payments-preview", paymentEnvironment: "sandbox" };
  const response = { ...request, status: "payments", providerAccountId: "acct_fixture", review };
  delete response.operation;
  assert.equal(parseIntegrationSetupResponse(JSON.stringify(response), request).review.changes[0].amount, 1200);
  for (const mutate of [
    (value) => { value.paymentEnvironment = "live"; },
    (value) => { value.review.accessToken = "secret"; },
    (value) => { value.review.pending = {}; },
    (value) => { value.review.changes[0].amount = 0.5; },
    (value) => { value.review.changes[0].action = "charge-customer"; },
    (value) => { value.review.changes[0].secret = "private"; },
    (value) => { value.review.drift = [{ planId: "pro", reason: "bad\noutput" }]; },
    (value) => { value.review.reviewId = "unreviewed"; }
  ]) {
    const value = structuredClone(response); mutate(value);
    assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(value), request), { code: "vibe64_integration_setup_invalid" });
  }
  for (const selection of [
    { operation: "payments-preview", integrationId: "billing" },
    { operation: "payments-publish", integrationId: "billing", paymentEnvironment: "live" },
    { operation: "payments-preview", integrationId: "billing", paymentEnvironment: "sandbox", reviewId: review.reviewId },
    { operation: "status", integrationId: "billing", paymentEnvironment: "sandbox" },
    { operation: "payments-preview", integrationId: "billing", paymentEnvironment: "sandbox", setupRequest: {} }
  ]) await assert.rejects(runIntegrationSetupCommand({ ...options, selection, runCommand: async () => assert.fail("must reject before execution") }));
});

test('payment readiness requires each bounded check and the selected environment', () => {
  const request = createIntegrationSetupRequest({ operation: 'payments-readiness', integrationId: 'billing', paymentEnvironment: 'live' });
  const result = { protocol: request.protocol, requestId: request.requestId, status: 'payments-readiness', paymentEnvironment: 'live', providerAccountId: 'acct_a',
    checks: ['credentials', 'account', 'charges', 'payouts', 'catalogue', 'webhook', 'checkout', 'site', 'deployment'].map((id) => ({ id, status: 'unknown', detail: 'No evidence yet.' })) };
  assert.deepEqual(parseIntegrationSetupResponse(JSON.stringify(result), request), result);
  for (const invalid of [
    { ...result, paymentEnvironment: 'sandbox' },
    { ...result, checks: result.checks.slice(1) },
    { ...result, checks: result.checks.map(() => result.checks[0]) },
    { ...result, checks: result.checks.map((check) => ({ ...check, status: 'approved' })) },
    { ...result, ready: true },
    { ...result, checks: result.checks.map((check) => ({ ...check, token: 'secret' })) }
  ]) assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(invalid), request));
  assert.throws(() => createIntegrationSetupRequest({ operation: 'payments-readiness', integrationId: 'billing', paymentEnvironment: 'live', reviewId: 'a'.repeat(64) }));
});

test('catalogue recovery binds the reviewed operation and excludes private pending fields', () => {
  const selection = { operation: 'payments-recover', integrationId: 'billing', paymentEnvironment: 'sandbox', reviewId: 'a'.repeat(64), providerId: 'price_existing' };
  const request = createIntegrationSetupRequest(selection);
  assert.equal(request.providerId, 'price_existing');
  for (const change of [{ reviewId: undefined }, { providerId: '../other' }, { operation: 'payments-preview' }]) {
    assert.throws(() => createIntegrationSetupRequest({ ...selection, ...change }));
  }
  const response = { protocol: request.protocol, requestId: request.requestId, status: 'payments', paymentEnvironment: 'sandbox', providerAccountId: 'acct_a',
    review: { reviewId: 'b'.repeat(64), changes: [], drift: [], removed: [], pending: true,
      pendingOperation: { action: 'create-price', planId: 'pro', amount: 1000, currency: 'USD', interval: 'month' } } };
  assert.deepEqual(parseIntegrationSetupResponse(JSON.stringify(response), request), response);
  response.review.pendingOperation.token = 'private-operation-token';
  assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(response), request));
  delete response.review.pendingOperation;
  assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(response), request));
});

test("payment history binds a bounded display page to the requested subject and environment", () => {
  const input = { operation: "payments-history", integrationId: "stripe", paymentEnvironment: "sandbox", subjectId: "tenant-a", collection: "transactions" };
  const selected = createIntegrationSetupRequest(input);
  assert.equal(selected.after, null);
  const result = { protocol: selected.protocol, requestId: selected.requestId, status: "payments-history",
    paymentEnvironment: "sandbox", providerAccountId: "acct_fixture", subjectId: "tenant-a", collection: "transactions",
    items: [{ id: "inv_1", kind: "invoice", status: "open", createdAt: "2026-09-12T00:00:00.000Z",
      currency: "USD", totalMinor: "9007199254740993", paidMinor: "0" }], nextCursor: "inv_1" };
  assert.deepEqual(parseIntegrationSetupResponse(JSON.stringify(result), selected), result);
  for (const change of [ { subjectId: "tenant-b" }, { paymentEnvironment: "live" }, { collection: "subscriptions" },
    { accessToken: "secret" }, { nextCursor: "bad cursor" }, { items: Array(21).fill(result.items[0]) },
    { items: [{ ...result.items[0], metadata: { private: true } }] },
    { items: [{ ...result.items[0], totalMinor: Number.MAX_SAFE_INTEGER + 1 }] } ]) {
    assert.throws(() => parseIntegrationSetupResponse(JSON.stringify({ ...result, ...change }), selected));
  }
  for (const change of [{ subjectId: "" }, { collection: "customers" }, { after: "bad cursor" }, { operation: "payments-preview" }]) {
    assert.throws(() => createIntegrationSetupRequest({ ...input, ...change }), { statusCode: 422 });
  }
  const subscriptions = createIntegrationSetupRequest({ ...input, collection: "subscriptions" });
  assert.doesNotThrow(() => parseIntegrationSetupResponse(JSON.stringify({ ...result, requestId: subscriptions.requestId,
    collection: "subscriptions", items: [{ id: "sub_1", kind: "subscription", status: "active", createdAt: "2026-09-12T00:00:00.000Z" }], nextCursor: null }), subscriptions));
});

test("Ads requests bind explicit inputs and reviewed launch confirmation to the existing application command", () => {
  const reviewId = "a".repeat(64);
  const selection = { operation: "ads-launch", integrationId: "google-ads", ads: { campaignId: "33", reviewId, trackingConfirmed: true, billingConfirmed: true } };
  const request = createIntegrationSetupRequest(selection);
  assert.deepEqual(request.ads, selection.ads);
  for (const ads of [{ ...selection.ads, billingConfirmed: false }, { ...selection.ads, url: "https://elsewhere.test" },
    { ...selection.ads, campaignId: "33/../44" }, { ...selection.ads, reviewId: "unreviewed" }]) assert.throws(() => createIntegrationSetupRequest({ ...selection, ads }));
  assert.throws(() => createIntegrationSetupRequest({ operation: "status", integrationId: "google-ads", ads: {} }));
  assert.deepEqual(createIntegrationSetupRequest({ operation: "ads-discover", integrationId: "google-ads", ads: {} }).ads, {});
});

test("Ads responses reject credentials, mismatched campaign reviews and wrong operations", () => {
  const request = createIntegrationSetupRequest({ operation: "ads-campaign", integrationId: "google-ads", ads: { campaignId: "33" } });
  const value = { protocol: request.protocol, requestId: request.requestId, status: "ads", operation: request.operation,
    data: { campaign: { id: "33", status: "PAUSED" }, reviewId: "a".repeat(64), ads: [{ adGroupAd: { ad: { finalUrls: ["https://app.test"] } } }] } };
  assert.deepEqual(parseIntegrationSetupResponse(JSON.stringify(value), request), value);
  for (const change of [{ ...value, operation: "ads-launch" }, { ...value, data: [] },
    { ...value, data: { ...value.data, campaign: { id: "44" } } },
    { ...value, data: { ...value.data, account: { accessToken: "secret" } } },
    { ...value, data: { ...value.data, logs: "diagnostics" } }]) assert.throws(() => parseIntegrationSetupResponse(JSON.stringify(change), request));
});
