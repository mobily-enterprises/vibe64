import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { sessionHistoryReviewSchema, sessionRepositoryReviewSchema } from "./inputSchemas.js";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS } from "./sessionRenewalState.js";

const shortText = { type: "string", maxLength: 256, required: false };
const sessionFields = {
  ...Object.fromEntries([
    "sessionId", "sessionName", "status", "updatedAt", "archivedAt", "workspaceSetupStatus", "agentStatus", "agentPhase", "runId",
    "routingStatus", "routingMode", "agentError", "engineId", "chatMode", "workflowEngineId", "catalogRevision"
  ].map((key) => [key, shortText])),
  ...Object.fromEntries(["modelId", "modelProviderId", "variantId", "agentId"].map((key) => [key, { ...shortText, maxLength: 512 }])),
  reviewEnabled: { type: "boolean", required: false },
  deslopEnabled: { type: "boolean", required: false },
  hasModelOverride: { type: "boolean", required: false },
  turnActive: { type: "boolean", required: false },
  needsUserInput: { type: "boolean", required: false }
};
const sessionOutput = {
  mode: "replace",
  schema: createSchema({
    ...sessionFields,
    ok: { type: "boolean", required: true },
    error: shortText,
    code: shortText,
    sessions: { type: "array", items: createSchema(sessionFields), required: false },
    sessionsTruncated: { type: "boolean", required: false },
    sessionCount: { type: "integer", min: 0, required: false },
    nextSessionOffset: { type: "integer", min: 0, nullable: true, required: false },
    unavailableSessionCount: { type: "integer", required: false }
  })
};

function sessionSummary(session) {
  const turn = session.agentSession?.turn;
  let route;
  let preferences;
  try { route = JSON.parse(session.metadata?.assistant_routing_request || "null"); } catch { /* No verified routing phase. */ }
  try { preferences = assistantRoutingFromMetadata(session.metadata); } catch { /* No verified mode preferences. */ }
  const fields = {
    sessionId: session.sessionId,
    sessionName: session.sessionName,
    status: session.status,
    updatedAt: session.updatedAt,
    archivedAt: session.archivedAt,
    workspaceSetupStatus: session.workspaceSetup?.status,
    agentStatus: turn?.state || session.agentSession?.status,
    agentPhase: turn?.phase,
    runId: turn?.id,
    routingStatus: route?.status,
    routingMode: route?.task || route?.resolvedMode,
    agentError: session.agentSession?.error || turn?.error,
    engineId: session.assistantSelection?.engineId,
    modelId: session.assistantSelection?.modelId,
    modelProviderId: session.assistantSelection?.modelProviderId,
    variantId: session.assistantSelection?.variantId,
    agentId: session.assistantSelection?.agentId,
    catalogRevision: session.assistantSelection?.catalogRevision,
    chatMode: preferences?.mode,
    workflowEngineId: preferences?.workflowEngineId
  };
  return {
    ...Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => (
      typeof value === "string" ? [[key, value.slice(0, sessionFields[key].maxLength)]] : []
    ))),
    ...(preferences ? { reviewEnabled: preferences.mode === "auto", deslopEnabled: preferences.mode === "auto" && preferences.review,
      hasModelOverride: Boolean(preferences.override) } : {}),
    ...(typeof turn?.active === "boolean" ? { turnActive: turn.active } : {}),
    ...(route ? { needsUserInput: route.reviewStatus === "skipped_question" } : {})
  };
}

function assistantAccessTool() {
  const strings = ["purpose", "role", "workflowEngineId", "reasonCode", "engineId", "modelProviderId", "modelId", "variantId", "agentId", "catalogRevision"];
  const purposeSchema = createSchema({
    ...Object.fromEntries(strings.map((key) => [key, { ...shortText, maxLength: 512 }])),
    message: { ...shortText, maxLength: 512 },
    available: { type: "boolean", required: true }, backupUsed: { type: "boolean", required: true }
  });
  return {
    description: "Inspect this actor's current coding-session AI access and configured destinations for Senior, Junior, Auto, review, Deslop and Helper. Returns available/reason/message and the effective selection for each purpose, including Backup use. These are configured roles, not the full model catalogue. Current chatMode/preferences come from sessions.inspect; changing chat mode affects future requests and does not mean the currently running model changed.",
    output: { mode: "replace", schema: createSchema({
      ok: { type: "boolean", required: true }, error: { ...shortText, maxLength: 512 }, code: shortText,
      currentMode: shortText, accessLabel: shortText,
      ...Object.fromEntries(["available", "canUse", "canUseAny", "nativeCanUse", "ownerOnly", "steering"].map((key) => [key, { type: "boolean", required: false }])),
      purposes: { type: "array", items: purposeSchema, required: true }
    }) },
    transformResult(result) {
      return { ok: result.ok === true,
        ...Object.fromEntries(["error", "code", "currentMode", "accessLabel"].flatMap((key) => typeof result[key] === "string" ? [[key, result[key].slice(0, key === "error" ? 512 : 256)]] : [])),
        ...Object.fromEntries(["available", "canUse", "canUseAny", "nativeCanUse", "ownerOnly", "steering"].flatMap((key) => typeof result[key] === "boolean" ? [[key, result[key]]] : [])),
        purposes: ["senior", "junior", "auto", "review", "deslop", "helper"].flatMap((purpose) => {
          const access = result.purposes?.[purpose];
          if (!access) return [];
          const values = { ...access, ...access.effectiveSelection, purpose };
          return [{ available: access.available === true, backupUsed: access.backupUsed === true,
            ...Object.fromEntries([...strings, "message"].flatMap((key) => typeof values[key] === "string" ? [[key, values[key].slice(0, 512)]] : [])) }];
        }) };
    }
  };
}

function sessionTool(description) {
  return {
    description,
    output: sessionOutput,
    transformResult(result, { input = {} } = {}) {
      const offset = Number(input.sessionOffset || 0);
      return {
        ...sessionSummary(result),
        ok: result.ok === true,
        ...Object.fromEntries(["error", "code"].flatMap((key) => typeof result[key] === "string" ? [[key, result[key].slice(0, 256)]] : [])),
        ...(Array.isArray(result.sessions) ? {
          sessions: result.sessions.slice(offset, offset + 60).map(sessionSummary),
          sessionsTruncated: offset > 0 || result.sessions.length > 60,
          sessionCount: result.sessions.length,
          nextSessionOffset: offset + 60 < result.sessions.length ? offset + 60 : null,
          unavailableSessionCount: result.unavailableSessions?.length || 0
        } : {})
      };
    }
  };
}

function sessionWorkTool(description) {
  const strings = ["sessionId", "repositoryMode", "mode", "branch", "relationship", "updateStrategy", "status", "operationId",
    "baseCommit", "canonicalCommit", "sessionHead", "saveCommit", "verifiedCommit", "code"];
  const booleans = ["unsaved", "dirty", "worktreeClean", "updateAvailable", "sessionCurrent", "sessionMatchesCanonical",
    "publicationRequiresPullRequest", "reconciled", "recovered", "cached"];
  const operationStrings = ["operationId", "kind", "status", "stage", "code", "error", "conflictReviewId"];
  const operationSchema = createSchema(Object.fromEntries(operationStrings.map((key) => [key, { ...shortText, maxLength: 512 }])));
  return {
    description,
    output: { mode: "replace", schema: createSchema({
      ok: { type: "boolean", required: true }, error: { ...shortText, maxLength: 512 },
      ...Object.fromEntries(strings.map((key) => [key, { ...shortText, maxLength: 256 }])),
      ...Object.fromEntries(booleans.map((key) => [key, { type: "boolean", required: false }])),
      ahead: { type: "integer", required: false }, behind: { type: "integer", required: false },
      changedPaths: { type: "array", items: { type: "string", noTrim: true, maxLength: 512 }, required: false },
      changedPathCount: { type: "integer", required: false }, changedPathsTruncated: { type: "boolean", required: false },
      destination: { type: "object", schema: sessionRepositoryReviewSchema, required: false },
      historyReview: { type: "object", schema: sessionHistoryReviewSchema, required: false },
      ...Object.fromEntries(["operation", "updateOperation", "activeOperation"].map((key) => [key, { type: "object", schema: operationSchema, required: false }])),
      cacheMaintenance: { type: "object", required: false, schema: createSchema({
        status: shortText, retryable: { type: "boolean", required: false }, message: { ...shortText, maxLength: 512 }
      }) }
    }) },
    transformResult(result) {
      const output = { ok: result.ok === true,
        ...Object.fromEntries([...strings, "error"].flatMap((key) => typeof result[key] === "string" ? [[key, result[key].slice(0, key === "error" ? 512 : 256)]] : [])),
        ...Object.fromEntries(booleans.flatMap((key) => typeof result[key] === "boolean" ? [[key, result[key]]] : [])),
        ...Object.fromEntries(["ahead", "behind"].flatMap((key) => Number.isSafeInteger(result[key]) ? [[key, result[key]]] : [])) };
      if (Array.isArray(result.changedPaths)) {
        output.changedPathCount = result.changedPaths.length;
        output.changedPaths = result.changedPaths.slice(0, 40).map((value) => String(value).slice(0, 512));
        output.changedPathsTruncated = result.changedPaths.length > 40 || result.changedPaths.some((value) => String(value).length > 512);
      }
      for (const [name, fields] of [["destination", ["sessionId", "mode", "repository", "branch"]],
        ["historyReview", ["baseCommit", "canonicalCommit", "sessionHead", "worktreeTree"]]]) {
        const record = result[name];
        // These are exact confirmation identities, not display excerpts.
        if (record) output[name] = Object.fromEntries(fields.map((key) => [key, record[key]]));
      }
      for (const name of ["operation", "updateOperation", "activeOperation"]) {
        if (!result[name]) continue;
        const record = { ...result[name], conflictReviewId: result[name].conflictRecovery?.reviewId };
        output[name] = Object.fromEntries(operationStrings.flatMap((key) => typeof record[key] === "string" ? [[key, record[key].slice(0, 512)]] : []));
      }
      if (result.cacheMaintenance) {
        output.cacheMaintenance = { retryable: result.cacheMaintenance.retryable === true,
          ...Object.fromEntries(["status", "message"].flatMap((key) => typeof result.cacheMaintenance[key] === "string" ? [[key, result.cacheMaintenance[key].slice(0, key === "message" ? 512 : 256)]] : [])) };
      }
      return output;
    }
  };
}

function sessionPullRequestTool() {
  const sourceStrings = ["url", "baseRepository", "baseBranch", "headRepository", "headBranch"];
  return {
    description: "Publish this session's work as a GitHub pull request only when the user asks to create a PR. First inspect work, explain the reviewed repository/branch and pass its exact destination unchanged as destinationReview. Supply the user's intended title and description; draft defaults to true. This publishes all current session work through ordinary Save and binds the session to its PR source. It does not merge or deploy. An already bound PR is returned without editing its title/body. If publication fails or is uncertain, inspect work and existing PRs before any explicit retry: the session may already be bound and the code may already be published. Read the returned PR through pull-requests.read for current status and commit identities; saveCommit is the actual saved commit when this call saved work.",
    output: { mode: "replace", schema: createSchema({
      ok: { type: "boolean", required: true }, error: { ...shortText, maxLength: 512 }, code: shortText,
      saveCommit: shortText,
      pullRequest: { type: "object", required: false, schema: createSchema({
        number: { type: "integer", min: 1, required: true }, title: shortText,
        ...Object.fromEntries(sourceStrings.map((key) => [key, { ...shortText, maxLength: 4096, noTrim: true }]))
      }) }
    }) },
    transformResult(result) {
      const output = { ok: result.ok === true,
        ...Object.fromEntries(["error", "code", "saveCommit"].flatMap((key) => typeof result[key] === "string"
          ? [[key, result[key].slice(0, key === "error" ? 512 : 256)]] : [])) };
      if (result.pullRequest) {
        const pr = result.pullRequest;
        output.pullRequest = { number: pr.number,
          ...Object.fromEntries(["title", ...sourceStrings].flatMap((key) => typeof pr[key] === "string"
            ? [[key, pr[key].slice(0, key === "title" ? 256 : 4096)]] : [])) };
      }
      return output;
    }
  };
}

function conversationLogTool() {
  return {
    description: "Read a bounded page of Main conversation text in a session. Returns up to six turns with stable turn IDs and nextBeforeTurnId for older pages. Truncated text is explicitly marked; use Colleague's conversation summary for a large range. Status/phase comes from session inspection, not from silence in this log.",
    output: { mode: "replace", schema: createSchema({
      ok: { type: "boolean", required: true }, error: shortText,
      nextBeforeTurnId: shortText, hasMoreBefore: { type: "boolean", required: true },
      turns: { type: "array", required: true, items: createSchema({
        turnId: shortText,
        user: { type: "string", maxLength: 2000, required: true },
        assistant: { type: "string", maxLength: 4000, required: true },
        truncated: { type: "boolean", required: true }
      }) }
    }) },
    transformResult(result) {
      const all = result.conversationLog || [];
      const turns = all.slice(-6);
      const hasMoreBefore = result.pagination?.hasMoreBefore === true || all.length > turns.length;
      return { ok: result.ok === true, ...(result.error ? { error: String(result.error).slice(0, 256) } : {}),
        hasMoreBefore, nextBeforeTurnId: hasMoreBefore ? turns[0]?.turnId || "" : "",
        turns: turns.map((turn) => ({ turnId: turn.turnId,
          user: String(turn.user?.text || "").slice(0, 2000), assistant: String(turn.assistant?.text || "").slice(0, 4000),
          truncated: String(turn.user?.text || "").length > 2000 || String(turn.assistant?.text || "").length > 4000
        })) };
    }
  };
}

function conversationOperationTool(description) {
  const strings = ["sessionId", "messageId", "deliveryMode", "code", "error", "reason", "turnId", "turnState", "routingStatus", "routingMode"];
  const booleans = ["delivered", "duplicate", "interrupted", "routingCancelled", "turnActive"];
  return {
    description,
    output: { mode: "replace", schema: createSchema({
      ok: { type: "boolean", required: true },
      ...Object.fromEntries(strings.map((key) => [key, { ...shortText, maxLength: 512 }])),
      ...Object.fromEntries(booleans.map((key) => [key, { type: "boolean", required: false }]))
    }) },
    transformResult(result) {
      const values = { ...result, turnId: result.turn?.id, turnState: result.turn?.state, turnActive: result.turn?.active,
        routingStatus: result.assistantRoutingRequest?.status, routingMode: result.assistantRoutingRequest?.resolvedMode };
      return { ok: result.ok === true,
        ...Object.fromEntries(strings.flatMap((key) => typeof values[key] === "string" ? [[key, values[key].slice(0, 512)]] : [])),
        ...Object.fromEntries(booleans.flatMap((key) => typeof values[key] === "boolean" ? [[key, values[key]]] : [])) };
    }
  };
}

function renewalTool(description, { includeDraft = false } = {}) {
  const strings = ["sessionId", "renewalId", "operationKey", "status", "stage", "successorSessionId", "updatedAt",
    "draftHash", "draftOrigin", "code", "maintenanceStatus"];
  return {
    description,
    output: { mode: "replace", schema: createSchema({
      ok: { type: "boolean", required: true }, hasRenewal: { type: "boolean", required: true },
      ...Object.fromEntries(strings.map((key) => [key, shortText])),
      error: { ...shortText, maxLength: 512 }, maintenanceError: { ...shortText, maxLength: 512 },
      available: { type: "boolean", required: false }, manualRequired: { type: "boolean", required: false },
      draftRevision: { type: "integer", required: false },
      draftText: { type: "string", noTrim: true, maxLength: SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS * 2, required: false }
    }) },
    transformResult(result) {
      const renewal = result.renewal;
      const values = { ...renewal, successorSessionId: renewal?.successor?.sessionId,
        draftHash: renewal?.draft?.hash, draftRevision: renewal?.draft?.revision, draftOrigin: renewal?.draft?.origin,
        code: result.code || renewal?.error?.code, error: result.error || renewal?.error?.message,
        maintenanceStatus: renewal?.maintenance?.status, maintenanceError: renewal?.maintenance?.error?.message };
      return {
        ok: result.ok === true, hasRenewal: Boolean(renewal),
        ...Object.fromEntries(strings.flatMap((key) => typeof values[key] === "string" ? [[key, values[key].slice(0, 256)]] : [])),
        ...Object.fromEntries(["error", "maintenanceError"].flatMap((key) => typeof values[key] === "string" ? [[key, values[key].slice(0, 512)]] : [])),
        ...(typeof result.available === "boolean" ? { available: result.available } : {}),
        ...(renewal ? { manualRequired: renewal.manualRequired === true } : {}),
        ...(renewal?.draft ? { draftRevision: renewal.draft.revision,
          ...(includeDraft ? { draftText: renewal.draft.text } : {}) } : {})
      };
    }
  };
}

export { assistantAccessTool, conversationLogTool, conversationOperationTool, renewalTool, sessionTool, sessionWorkTool, sessionPullRequestTool };
