import { randomUUID } from "node:crypto";
import path from "node:path";

const INTEGRATION_SETUP_PROTOCOL = "vibe64.integration-setup.command.v1";
const ADS_OPERATIONS = ["ads-discover", "ads-targets", "ads-conversion", "ads-preview", "ads-create", "ads-campaign", "ads-launch", "ads-pause", "ads-report"];
const OPERATIONS = [...ADS_OPERATIONS,"status", "connect", "cancel", "disconnect", "payments-preview", "payments-publish", "payments-readiness", "payments-recover", "payments-history"];
const STATUSES = ["unconfigured", "disconnected", "connected", "pending", "reconnect-required", "cancelled"];
const MAX_BYTES = 32768;

function invalid(message = "The application returned an invalid integration setup result.", statusCode = 502) {
  const error = new Error(message);
  error.code = "vibe64_integration_setup_invalid";
  error.statusCode = statusCode;
  throw error;
}

function parseIntegrationSetupResponse(stdout, request) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > MAX_BYTES) invalid();
  let result;
  try { result = JSON.parse(stdout); } catch { invalid(); }
  if (!result || Array.isArray(result) || typeof result !== "object") invalid();
  if (request.operation.startsWith("ads-")) return parseAdsResponse(result, request);
  if (request.operation.startsWith("payments-")) return parsePaymentManagementResponse(result, request);
  const keys = ["protocol", "requestId", "status", "authorizationUrl", "attemptId", "expiresAt", "grantedScopes", "verifiedAt", "callbackUrl", "setupIssue", "accountLabel"];
  if (Object.keys(result).some((key) => !keys.includes(key)) ||
      result.protocol !== INTEGRATION_SETUP_PROTOCOL || result.requestId !== request.requestId ||
      !STATUSES.includes(result.status)) invalid();
  if (result.setupIssue !== undefined && (result.status !== "unconfigured" ||
      !["credentials-missing", "callback-invalid"].includes(result.setupIssue))) invalid();
  if (result.accountLabel !== undefined && (!["connected", "reconnect-required"].includes(result.status) ||
      typeof result.accountLabel !== "string" || !result.accountLabel.trim() || result.accountLabel.length > 256 ||
      /[\p{Cc}\p{Cf}]/u.test(result.accountLabel))) invalid();
  for (const key of ["expiresAt", "verifiedAt"]) {
    if (result[key] !== undefined && (typeof result[key] !== "string" || !Number.isFinite(Date.parse(result[key])))) invalid();
  }
  if (result.grantedScopes !== undefined && (!Array.isArray(result.grantedScopes) || result.grantedScopes.length > 200 ||
      result.grantedScopes.some((scope) => typeof scope !== "string" || !scope || scope.length > 2048))) invalid();
  for (const key of ["authorizationUrl", "callbackUrl"]) {
    if (result[key] === undefined) continue;
    let url;
    try { url = new URL(result[key]); } catch { invalid(); }
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (typeof result[key] !== "string" || result[key].length > 16384 ||
        (url.protocol !== "https:" && !localHttp) || url.username || url.password || url.hash ||
        (key === "callbackUrl" && url.search)) invalid();
  }
  if (result.status === "pending") {
    if (!["connect", "status"].includes(request.operation) || !result.authorizationUrl || !result.expiresAt ||
        typeof result.attemptId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(result.attemptId)) invalid();
  } else if (["authorizationUrl", "attemptId", "expiresAt"].some((key) => result[key] !== undefined)) invalid();
  if (request.operation === "disconnect" && result.status !== "disconnected") invalid();
  if (request.operation === "cancel" && result.status !== "cancelled") invalid();
  return result;
}

function parseAdsResponse(result, request) {
  const record = value => value && typeof value === "object" && !Array.isArray(value);
  if (Object.keys(result).some(key => !["protocol", "requestId", "status", "operation", "data"].includes(key)) ||
      result.protocol !== INTEGRATION_SETUP_PROTOCOL || result.requestId !== request.requestId ||
      result.status !== "ads" || result.operation !== request.operation || !record(result.data)) invalid();
  const roots = {
    "ads-discover": ["accounts", "account", "clients", "conversions", "campaigns"], "ads-targets": ["locations", "languages"],
    "ads-conversion": ["results"], "ads-preview": ["plan", "account", "conversion", "reviewId"], "ads-create": ["campaignId", "status"],
    "ads-campaign": ["customerId", "account", "campaign", "campaignBudget", "ads", "goals", "customGoals", "targets", "keywords", "reviewId"],
    "ads-launch": ["results"], "ads-pause": ["results"], "ads-report": ["campaigns"]
  };
  if (Object.keys(result.data).some(key => !roots[request.operation]?.includes(key))) invalid();
  // Selected Google display fields only. Credentials and arbitrary diagnostics
  // never belong in an editor response, including nested provider objects.
  const fields = new Set(`accounts account clients conversions campaigns locations languages results plan conversion reviewId campaignId status customerId
    campaign campaignBudget ads goals customGoals targets keywords resourceName customer customerClient conversionAction geoTargetConstant languageConstant
    conversionGoalCampaignConfig customConversionGoal campaignCriterion adGroupCriterion adGroupAd adGroup ad location language keyword metrics
    id name descriptiveName currencyCode timeZone manager clientCustomer level type canonicalName tagSnippets globalSiteTag eventSnippet pageFormat trackingCodeType
    nonPolitical currency dailyBudgetMicros maxCpcMicros finalUrl conversionActionId locationIds languageId headlines descriptions
    advertisingChannelType biddingStrategyType networkSettings targetGoogleSearch targetSearchNetwork targetContentNetwork targetPartnerSearchNetwork
    geoTargetTypeSetting positiveGeoTargetType negativeGeoTargetType containsEuPoliticalAdvertising amountMicros finalUrls responsiveSearchAd text pinnedField
    policySummary approvalStatus reviewStatus cpcBidMicros goalConfigLevel conversionActions negative matchType impressions clicks costMicros conversions`.split(/\s+/));
  function check(value, depth = 0) {
    if (depth > 10) invalid();
    if (Array.isArray(value)) { if (value.length > 200) invalid(); value.forEach(item => check(item, depth + 1)); }
    else if (record(value)) { for (const [key, item] of Object.entries(value)) { if (!fields.has(key)) invalid(); check(item, depth + 1); } }
    else if (!["string", "number", "boolean"].includes(typeof value) && value !== null) invalid();
  }
  check(result.data);
  if (["ads-preview", "ads-campaign"].includes(request.operation) && !/^[a-f0-9]{64}$/.test(result.data.reviewId || "")) invalid();
  if (request.operation === "ads-preview" && (!record(result.data.plan) || !record(result.data.account) || !record(result.data.conversion))) invalid();
  if (request.operation === "ads-campaign" && (!record(result.data.campaign) || String(result.data.campaign.id) !== request.ads.campaignId)) invalid();
  if (request.operation === "ads-create" && (!/^[0-9]{1,20}$/.test(result.data.campaignId || "") || result.data.status !== "PAUSED")) invalid();
  return result;
}

function validateAdsSelection(operation, values) {
  if (!values || Array.isArray(values) || typeof values !== "object") invalid("Supply the advertising operation inputs.", 422);
  const fields = {
    "ads-discover": ["customerId"], "ads-targets": ["customerId", "name"],
    "ads-conversion": ["customerId", "name"], "ads-preview": [], "ads-create": ["reviewId"],
    "ads-campaign": ["campaignId"], "ads-launch": ["campaignId", "reviewId", "trackingConfirmed", "billingConfirmed"],
    "ads-pause": ["campaignId"], "ads-report": []
  }[operation];
  if (Object.keys(values).some(key => !fields.includes(key))) invalid("Unexpected advertising inputs.", 422);
  for (const field of fields) {
    const value = values[field];
    if (operation === "ads-discover" && value === undefined) continue;
    const valid = field === "customerId" ? typeof value === "string" && /^[0-9]{10}$/.test(value)
      : field === "campaignId" ? typeof value === "string" && /^[0-9]{1,20}$/.test(value)
      : field === "reviewId" ? typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
      : field.endsWith("Confirmed") ? value === true
      : typeof value === "string" && value.trim().length > 0 && value.length <= 100 && !/[\p{Cc}\p{Cf}]/u.test(value);
    if (!valid) invalid(`Check advertising field ${field}.`, 422);
  }
  return structuredClone(values);
}

// Payment management uses the same app-owned command and execution policy.
// Only bounded, explicitly selected display data crosses back into the editor.
function parsePaymentManagementResponse(result, request) {
  const record = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
  const text = (value, max = 200) => typeof value === "string" && value.trim() && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);
  const planId = (value) => text(value, 100) && /^[a-z][a-z0-9-]*$/u.test(value) && !["constructor", "prototype"].includes(value);
  if (request.operation === "payments-history") {
    const cursor = (value) => value === null || (typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value));
    const minor = (value) => value === null || (typeof value === "string" && /^-?[0-9]{1,30}$/.test(value));
    if (!record(result, ["protocol", "requestId", "status", "paymentEnvironment", "providerAccountId", "subjectId", "collection", "items", "nextCursor"]) ||
        result.protocol !== INTEGRATION_SETUP_PROTOCOL || result.requestId !== request.requestId || result.status !== "payments-history" ||
        result.paymentEnvironment !== request.paymentEnvironment || !text(result.providerAccountId) ||
        result.subjectId !== request.subjectId || result.collection !== request.collection || !cursor(result.nextCursor) ||
        !Array.isArray(result.items) || result.items.length > 20 || (result.nextCursor !== null && !result.items.length)) invalid();
    for (const item of result.items) {
      if (!record(item, ["id", "kind", "status", "createdAt", "currency", "totalMinor", "paidMinor"]) ||
          !text(item.id) || !text(item.status, 100) || typeof item.createdAt !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.createdAt) || !Number.isFinite(Date.parse(item.createdAt))) invalid();
      if (request.collection === "subscriptions") {
        if (item.kind !== "subscription" || ["currency", "totalMinor", "paidMinor"].some((key) => key in item)) invalid();
      } else if (!["invoice", "transaction"].includes(item.kind) || !/^[A-Z]{3}$/.test(item.currency || "") ||
          !minor(item.totalMinor) || !minor(item.paidMinor)) invalid();
    }
    return result;
  }
  if (request.operation === "payments-readiness") {
    const ids = ["credentials", "account", "charges", "payouts", "catalogue", "webhook", "checkout", "site", "deployment"];
    if (!record(result, ["protocol", "requestId", "status", "paymentEnvironment", "providerAccountId", "checks"]) ||
        result.protocol !== INTEGRATION_SETUP_PROTOCOL || result.requestId !== request.requestId || result.status !== "payments-readiness" ||
        result.paymentEnvironment !== request.paymentEnvironment || !text(result.providerAccountId) ||
        !Array.isArray(result.checks) || result.checks.length !== ids.length || new Set(result.checks.map((check) => check?.id)).size !== ids.length ||
        result.checks.some((check) => !record(check, ["id", "status", "detail"]) || !ids.includes(check.id) ||
          !["passed", "failed", "unknown", "manual"].includes(check.status) || !text(check.detail, 500))) invalid();
    return result;
  }
  if (!record(result, ["protocol", "requestId", "status", "paymentEnvironment", "providerAccountId", "review"]) ||
      result.protocol !== INTEGRATION_SETUP_PROTOCOL || result.requestId !== request.requestId || result.status !== "payments" ||
      result.paymentEnvironment !== request.paymentEnvironment || !text(result.providerAccountId)) invalid();
  const review = result.review;
  if (!record(review, ["reviewId", "changes", "drift", "removed", "pending", "pendingOperation"]) || !/^[a-f0-9]{64}$/u.test(review.reviewId || "") ||
      typeof review.pending !== "boolean" || !Array.isArray(review.changes) || review.changes.length > 200 ||
      !Array.isArray(review.drift) || review.drift.length > 200 || !Array.isArray(review.removed) || review.removed.length > 100) invalid();
  if (review.pending ? !review.pendingOperation : review.pendingOperation !== undefined) invalid();
  for (const change of [...review.changes, ...(review.pending ? [review.pendingOperation] : [])]) {
    if (!record(change, ["action", "planId", "name", "amount", "currency", "interval"]) || !planId(change.planId)) invalid();
    if (["create-product", "rename-product"].includes(change.action)) {
      if (!text(change.name) || ["amount", "currency", "interval"].some((key) => key in change)) invalid();
    } else if (change.action === "create-price") {
      if ("name" in change || !Number.isSafeInteger(change.amount) || change.amount < 1 || change.amount > 1000000000 ||
          !/^[A-Z]{3}$/u.test(change.currency || "") || !["month", "year"].includes(change.interval)) invalid();
    } else invalid();
  }
  if (review.removed.some((id) => !planId(id)) || review.drift.some((item) =>
      !record(item, ["planId", "reason"]) || !planId(item.planId) || !text(item.reason, 500))) invalid();
  return result;
}

function createIntegrationSetupRequest(selection) {
  const { operation, integrationId, attemptId, verificationInput, paymentEnvironment, reviewId, providerId, subjectId, collection, after, ads } = selection || {};
  if (!OPERATIONS.includes(operation) || typeof integrationId !== "string" ||
      !/^[a-z][a-z0-9-]*$/u.test(integrationId) || integrationId.length > 200 ||
      ["constructor", "prototype"].includes(integrationId)) invalid("Choose a valid integration setup operation.", 422);
  if (operation === "cancel" && (typeof attemptId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(attemptId))) {
    invalid("Choose the pending connection attempt to cancel.", 422);
  }
  if (verificationInput !== undefined && (operation !== "connect" || !verificationInput ||
      typeof verificationInput !== "object" || Array.isArray(verificationInput))) invalid("Check the provider verification inputs.", 422);
  const advertising = ADS_OPERATIONS.includes(operation);
  const adsInput = advertising ? validateAdsSelection(operation, ads) : undefined;
  if (!advertising && ads !== undefined) invalid("Advertising inputs require an advertising operation.", 422);
  if (advertising && (attemptId !== undefined || selection.setupRequest !== undefined)) invalid("Advertising commands cannot resolve a connection request.", 422);
  const payment = operation.startsWith("payments-");
  if (payment && (!["sandbox", "live"].includes(paymentEnvironment) || attemptId !== undefined || selection.setupRequest !== undefined ||
      (["payments-publish", "payments-recover"].includes(operation) ? !/^[a-f0-9]{64}$/u.test(reviewId || "") : reviewId !== undefined))) {
    invalid("Select the payment environment and review catalogue changes before publishing.", 422);
  }
  if (operation === "payments-recover" ? typeof providerId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(providerId) : providerId !== undefined) {
    invalid("Recovery requires the exact provider object ID and a current review.", 422);
  }
  if (!payment && (paymentEnvironment !== undefined || reviewId !== undefined)) invalid("Payment inputs require a payment operation.", 422);
  if (operation === "payments-history") {
    if (typeof subjectId !== "string" || !subjectId.trim() || subjectId.length > 200 || /[\p{Cc}\p{Cf}]/u.test(subjectId) ||
        !["subscriptions", "transactions"].includes(collection) ||
        (after !== undefined && after !== null && (typeof after !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(after)))) {
      invalid("Select an application billing account, history collection and valid page cursor.", 422);
    }
  } else if (subjectId !== undefined || collection !== undefined || after !== undefined) {
    invalid("Billing history inputs require a history operation.", 422);
  }
  const request = {
    protocol: INTEGRATION_SETUP_PROTOCOL, requestId: randomUUID(), operation, integrationId,
    ...(advertising ? { ads: adsInput } : {}),
    ...(operation === "cancel" ? { attemptId } : {}),
    ...(operation === "payments-history" ? { subjectId, collection, after: after ?? null } : {}),
    ...(payment ? { paymentEnvironment, ...(["payments-publish", "payments-recover"].includes(operation) ? { reviewId } : {}), ...(operation === "payments-recover" ? { providerId } : {}) } : {}),
    ...(verificationInput === undefined ? {} : { verificationInput })
  };
  const input = `${JSON.stringify(request)}\n`;
  if (Buffer.byteLength(input) > MAX_BYTES) invalid("Integration setup inputs are too large.", 422);
  return request;
}

// The caller supplies an inspected command, authorized project scope and resolved
// environment. This function never accepts an executable from a browser request.
async function runIntegrationSetupCommand({
  runCommand, command, sourceRoot, runtimes, env, releaseEnvironmentFile, project, session, selection
}) {
  if (typeof runCommand !== "function" || !command || !path.isAbsolute(sourceRoot || "")) {
    invalid("Application integration setup is not configured.");
  }
  const request = createIntegrationSetupRequest(selection);
  const input = `${JSON.stringify(request)}\n`;
  const [executable, ...args] = command.argv;
  const cwd = path.resolve(sourceRoot, command.workdir);
  let result;
  try {
    result = await runCommand({
    actor: "app", allowedRoots: [sourceRoot], command: executable, args, cwd,
    env, envPolicy: releaseEnvironmentFile ? "deployment" : "project", project, session, runtimes,
    ...(releaseEnvironmentFile ? { releaseEnvironmentFile } : {}),
    purpose: "source-editor", mode: "capture", input, maxBuffer: MAX_BYTES, timeout: 30000
    });
  } catch {
    // Execution errors may contain command output or private environment values.
    result = { ok: false };
  }
  if (result?.ok !== true) {
    const error = new Error(result?.timedOut ? "Application integration setup timed out." : "Application integration setup failed.");
    error.code = result?.timedOut ? "vibe64_integration_setup_timed_out" : "vibe64_integration_setup_failed";
    error.statusCode = 502;
    throw error;
  }
  return parseIntegrationSetupResponse(result.stdout, request);
}

export { createIntegrationSetupRequest, INTEGRATION_SETUP_PROTOCOL, parseIntegrationSetupResponse, runIntegrationSetupCommand };
