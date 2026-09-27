import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { COLLEAGUE_TOOL_PAYLOAD_LIMIT } from "../../packages/vibe64-colleague/src/server/protocol.js";
import { assertSessionRenewalDraftVersion, assertSessionRenewalOperation, createSessionRenewalDraft } from "../../packages/vibe64-sessions/src/server/sessionRenewalState.js";

import {
  ACTION_CANCEL_SESSION_RENEWAL,
  ACTION_CONFIRM_SESSION_RENEWAL,
  ACTION_INSPECT_SESSION_RENEWAL,
  ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
  ACTION_RETRY_SESSION_RENEWAL,
  ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
  createSessionActions
} from "../../packages/vibe64-sessions/src/server/actions.js";
import {
  SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS,
  sessionRenewalConfirmationActionInputValidator,
  sessionRenewalConfirmationInputValidator,
  sessionRenewalDraftGuardInputValidator,
  sessionRenewalDraftGuardActionInputValidator,
  sessionRenewalDraftRequestInputValidator,
  sessionRenewalDraftRequestActionInputValidator,
  sessionRenewalDraftUpdateInputValidator,
  sessionRenewalRetryInputValidator,
  sessionRenewalDraftUpdateActionInputValidator
} from "../../packages/vibe64-sessions/src/server/inputSchemas.js";
import {
  registerRoutes
} from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

const RENEWAL_ACTION_IDS = Object.freeze([
  ACTION_INSPECT_SESSION_RENEWAL,
  ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
  ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
  ACTION_CANCEL_SESSION_RENEWAL,
  ACTION_CONFIRM_SESSION_RENEWAL,
  ACTION_RETRY_SESSION_RENEWAL
]);
const DRAFT_HASH = "a".repeat(64);
const ASSISTANT_SELECTION = Object.freeze({
  agentId: "build",
  catalogRevision: `sha256:${"b".repeat(64)}`,
  engineId: "opencode",
  modelId: "glm-4.7-flash",
  modelProviderId: "zai",
  variantId: ""
});

test("native renewal tools retain complete reviewed text and guards without leaking private renewal state", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    let allowed = true;
    const user = { username: "member", uid: 42, role: "member" };
    const state = { sessionId: "one", renewalId: "renewal-1", operationKey: "renewal:one:check", status: "review", stage: "draft_ready",
      draft: createSessionRenewalDraft("😀".repeat(20000)), manualRequired: false,
      successor: { sessionId: "successor-1", assistantSelection: { secret: "private-binding" } },
      basis: { repositoryPath: "/private/source", provider: { secret: "private-token" } }, actor: { id: "private-actor" } };
    const calls = [];
    const methods = [
      ["inspect", "inspectSessionRenewal"], ["draft.request", "requestSessionRenewalDraft"],
      ["draft.update", "updateSessionRenewalDraft"], ["cancel", "cancelSessionRenewal"],
      ["confirm", "confirmSessionRenewal"], ["retry", "retrySessionRenewal"]
    ];
    const sessions = Object.fromEntries(methods.map(([suffix, name]) => [name, async (sessionId, input) => {
      calls.push({ suffix, sessionId, input });
      if (suffix !== "inspect") assertSessionRenewalOperation(state, input.operationKey);
      if (["draft.update", "cancel", "confirm"].includes(suffix)) assertSessionRenewalDraftVersion(state, input);
      return { ok: true, available: true, renewal: state, viewerScope: "private-viewer" };
    }]));
    const actions = createActionCatalogue();
    actions.register({ contributorId: "renewal", domain: "sessions", actions: createSessionActions({ sessions }).map(action => ({
      channels: ["api", "automation"], surfaces: ["app"], ...action
    })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => user,
      authorizeProject() { if (!allowed) throw Object.assign(new Error("Project access revoked."), { statusCode: 403 }); }
    });
    const catalog = createServiceToolCatalog(actions, { maxToolArgumentBytes: COLLEAGUE_TOOL_PAYLOAD_LIMIT, maxToolResultBytes: COLLEAGUE_TOOL_PAYLOAD_LIMIT });
    const context = { surface: "app" };
    const toolSet = catalog.resolveToolSet(context);
    const execute = (suffix, fields = {}) => {
      const tool = toolSet.tools.find(entry => entry.actionId === `vibe64.sessions.renewal.${suffix}`);
      assert.ok(tool, suffix);
      return catalog.executeToolCall({ toolName: tool.name, context, toolSet,
        argumentsText: JSON.stringify({ projectSlug: slug, sessionId: "one", ...fields }) });
    };
    const guards = { operationKey: state.operationKey, expectedHash: state.draft.hash, expectedRevision: state.draft.revision };
    for (const [suffix] of methods) {
      const fields = suffix === "inspect" ? {} : ["draft.request", "retry"].includes(suffix) ? { operationKey: state.operationKey }
        : { ...guards, ...(suffix === "draft.update" ? { draft: state.draft.text } : {}), ...(suffix === "confirm" ? { workflowEngineId: "codex" } : {}) };
      const result = await execute(suffix, fields);
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.result.hasRenewal, true);
      assert.equal(result.result.draftHash, guards.expectedHash);
      assert.equal(result.result.draftRevision, guards.expectedRevision);
      assert.equal(result.result.successorSessionId, "successor-1");
      assert.equal(JSON.stringify(result).includes("private"), false);
      if (suffix === "inspect") assert.equal(result.result.draftText, state.draft.text);
      else { assert.equal(Object.hasOwn(result.result, "draftText"), false); assert.ok(JSON.stringify(result).length < 2000); }
      assert.equal(calls.at(-1).sessionId, "one");
      assert.deepEqual(calls.at(-1).input.vibe64User, user);
      if (suffix === "draft.update") assert.equal(calls.at(-1).input.draft, state.draft.text);
    }
    const count = calls.length;
    for (const fields of [{ operationKey: state.operationKey }, { ...guards, sessionId: " " }, { ...guards, vibe64User: { role: "owner" } }]) {
      assert.equal((await execute("confirm", fields)).ok, false);
    }
    allowed = false;
    assert.equal((await execute("confirm", guards)).ok, false);
    assert.equal(calls.length, count, "missing guards, missing target, spoofed actor and revoked access never reach the renewal service");
    allowed = true;
    state.draft = createSessionRenewalDraft("New reviewed handover", { revision: 2 });
    const stale = await execute("confirm", guards);
    assert.equal(stale.ok, false);
    assert.match(JSON.stringify(stale.error), /vibe64_session_renewal_draft_stale/);
  });
});

function actionById(actions, id) {
  const action = actions.find((candidate) => candidate.id === id);
  assert.ok(action, `Expected action ${id}`);
  return action;
}

test("renewal inputs require durable operation and optimistic draft guards", () => {
  const operation = sessionRenewalDraftRequestActionInputValidator.schema.create({
    operationKey: "renewal:session-1:one",
    sessionId: "session-1",
    vibe64User: { username: "spoofed" }
  });
  assert.equal(operation.errors.vibe64User.code, "FIELD_NOT_ALLOWED");
  assert.deepEqual(operation.validatedObject, {
    operationKey: "renewal:session-1:one",
    sessionId: "session-1"
  });

  const guarded = sessionRenewalDraftGuardActionInputValidator.schema.create({
    expectedHash: DRAFT_HASH,
    expectedRevision: 3,
    operationKey: "renewal:session-1:one",
    sessionId: "session-1"
  });
  assert.deepEqual(guarded.errors, {});
  assert.deepEqual(guarded.validatedObject, {
    expectedHash: DRAFT_HASH,
    expectedRevision: 3,
    operationKey: "renewal:session-1:one",
    sessionId: "session-1"
  });

  const missingGuard = sessionRenewalDraftGuardActionInputValidator.schema.create({
    operationKey: "renewal:session-1:one",
    sessionId: "session-1"
  });
  assert.deepEqual(Object.keys(missingGuard.errors).sort(), [
    "expectedHash",
    "expectedRevision"
  ]);

  const malformedGuard = sessionRenewalDraftGuardActionInputValidator.schema.create({
    expectedHash: "not-a-draft-hash",
    expectedRevision: 0,
    operationKey: "contains spaces",
    sessionId: "session-1"
  });
  assert.deepEqual(Object.keys(malformedGuard.errors).sort(), [
    "expectedHash",
    "expectedRevision",
    "operationKey"
  ]);

  const confirmation = sessionRenewalConfirmationActionInputValidator.schema.create({
    assistantSelection: ASSISTANT_SELECTION,
    workflowEngineId: "codex",
    expectedHash: DRAFT_HASH,
    expectedRevision: 3,
    operationKey: "renewal:session-1:one",
    sessionId: "session-1"
  });
  assert.deepEqual(confirmation.errors, {});
  assert.deepEqual(confirmation.validatedObject.assistantSelection, ASSISTANT_SELECTION);
});

test("renewal draft transport stays bounded without rejecting 20,000 astral code points", () => {
  const exactDraft = `  ${"😀".repeat(SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS - 4)}  `;
  assert.equal(Array.from(exactDraft).length, SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS);

  const accepted = sessionRenewalDraftUpdateActionInputValidator.schema.create({
    draft: exactDraft,
    expectedHash: DRAFT_HASH,
    expectedRevision: 1,
    operationKey: "renewal:session-1:one",
    sessionId: "session-1"
  });
  assert.deepEqual(accepted.errors, {});
  assert.equal(accepted.validatedObject.draft, exactDraft);

  const transportMaximum = "x".repeat(SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS * 2);
  const transportAccepted = sessionRenewalDraftUpdateActionInputValidator.schema.create({
    draft: transportMaximum,
    expectedHash: DRAFT_HASH,
    expectedRevision: 1,
    operationKey: "renewal:session-1:one",
    sessionId: "session-1"
  });
  assert.deepEqual(transportAccepted.errors, {});

  const rejected = sessionRenewalDraftUpdateActionInputValidator.schema.create({
    draft: `${transportMaximum}x`,
    expectedHash: DRAFT_HASH,
    expectedRevision: 1,
    operationKey: "renewal:session-1:one",
    sessionId: "session-1"
  });
  assert.equal(rejected.errors.draft.code, "MAX_LENGTH");
});

test("renewal actions use server action context identity and domain-native idempotency", async () => runWithProjectRequestContext({ slug: "unit_project" }, async () => {
  const calls = [];
  const sessions = {
    async inspectSessionRenewal(...args) {
      calls.push(["inspect", ...args]);
      return { ok: true };
    },
    async requestSessionRenewalDraft(...args) {
      calls.push(["request", ...args]);
      return { ok: true };
    },
    async updateSessionRenewalDraft(...args) {
      calls.push(["update", ...args]);
      return { ok: true };
    },
    async cancelSessionRenewal(...args) {
      calls.push(["cancel", ...args]);
      return { ok: true };
    },
    async confirmSessionRenewal(...args) {
      calls.push(["confirm", ...args]);
      return { ok: true };
    },
    async retrySessionRenewal(...args) {
      calls.push(["retry", ...args]);
      return { ok: true };
    }
  };
  const actions = createSessionActions({ sessions });
  const vibe64User = {
    role: "member",
    username: "ada"
  };
  const context = {
    requestMeta: {
      request: { vibe64User }
    }
  };
  const base = {
    assistantSelection: ASSISTANT_SELECTION,
    workflowEngineId: "codex",
    expectedHash: DRAFT_HASH,
    expectedRevision: 2,
    operationKey: "renewal:session-1:one",
    originId: "tab:one",
    sessionId: "session-1",
    vibe64User: { username: "spoofed" }
  };

  await actionById(actions, ACTION_INSPECT_SESSION_RENEWAL).execute(base, context);
  await actionById(actions, ACTION_REQUEST_SESSION_RENEWAL_DRAFT).execute(base, context);
  await actionById(actions, ACTION_UPDATE_SESSION_RENEWAL_DRAFT).execute({
    ...base,
    draft: "Continue from the saved canonical commit."
  }, context);
  await actionById(actions, ACTION_CANCEL_SESSION_RENEWAL).execute(base, context);
  await actionById(actions, ACTION_CONFIRM_SESSION_RENEWAL).execute(base, context);
  await actionById(actions, ACTION_RETRY_SESSION_RENEWAL).execute(base, context);

  assert.deepEqual(calls, [
    ["inspect", "session-1", { vibe64User }],
    ["request", "session-1", {
      operationKey: "renewal:session-1:one",
      originId: "tab:one",
      vibe64User
    }],
    ["update", "session-1", {
      draft: "Continue from the saved canonical commit.",
      expectedHash: DRAFT_HASH,
      expectedRevision: 2,
      operationKey: "renewal:session-1:one",
      originId: "tab:one",
      vibe64User
    }],
    ["cancel", "session-1", {
      expectedHash: DRAFT_HASH,
      expectedRevision: 2,
      operationKey: "renewal:session-1:one",
      originId: "tab:one",
      vibe64User
    }],
    ["confirm", "session-1", {
      assistantSelection: ASSISTANT_SELECTION,
    workflowEngineId: "codex",
      expectedHash: DRAFT_HASH,
      expectedRevision: 2,
      operationKey: "renewal:session-1:one",
      originId: "tab:one",
      vibe64User
    }],
    ["retry", "session-1", {
      operationKey: "renewal:session-1:one",
      originId: "tab:one",
      vibe64User
    }]
  ]);

  assert.equal(actionById(actions, ACTION_INSPECT_SESSION_RENEWAL).idempotency, "none");
  for (const actionId of RENEWAL_ACTION_IDS.slice(1)) {
    assert.equal(actionById(actions, actionId).idempotency, "domain_native");
  }
}));

test("renewal HTTP routes expose the six state transitions without accepting body actors", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(app.http, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });
      const calls = [];
      const executeAction = async (payload) => {
        calls.push(payload);
        return { ok: true };
      };
      const params = routeProjectParams({ sessionId: "session-1" });
      const routes = [
        {
          actionId: ACTION_INSPECT_SESSION_RENEWAL,
          body: {},
          bodyLimit: undefined,
          bodyValidator: undefined,
          method: "GET",
          suffix: "/renewal"
        },
        {
          actionId: ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
          body: {
            operationKey: "renewal:session-1:one",
            vibe64User: { username: "spoofed" }
          },
          bodyLimit: 32 * 1024,
          bodyValidator: sessionRenewalDraftRequestInputValidator,
          method: "POST",
          suffix: "/renewal/draft"
        },
        {
          actionId: ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
          body: {
            draft: "Reviewed handover",
            expectedHash: DRAFT_HASH,
            expectedRevision: 2,
            operationKey: "renewal:session-1:one",
            vibe64User: { username: "spoofed" }
          },
          bodyLimit: 256 * 1024,
          bodyValidator: sessionRenewalDraftUpdateInputValidator,
          method: "PATCH",
          suffix: "/renewal/draft"
        },
        {
          actionId: ACTION_CANCEL_SESSION_RENEWAL,
          body: {
            expectedHash: DRAFT_HASH,
            expectedRevision: 2,
            operationKey: "renewal:session-1:one",
            vibe64User: { username: "spoofed" }
          },
          bodyLimit: 32 * 1024,
          bodyValidator: sessionRenewalDraftGuardInputValidator,
          method: "POST",
          suffix: "/renewal/cancel"
        },
        {
          actionId: ACTION_CONFIRM_SESSION_RENEWAL,
          body: {
            assistantSelection: ASSISTANT_SELECTION,
    workflowEngineId: "codex",
            expectedHash: DRAFT_HASH,
            expectedRevision: 2,
            operationKey: "renewal:session-1:one",
            vibe64User: { username: "spoofed" }
          },
          bodyLimit: 32 * 1024,
          bodyValidator: sessionRenewalConfirmationInputValidator,
          method: "POST",
          suffix: "/renewal/confirm"
        },
        {
          actionId: ACTION_RETRY_SESSION_RENEWAL,
          body: {
            operationKey: "renewal:session-1:one",
            vibe64User: { username: "spoofed" }
          },
          bodyLimit: 32 * 1024,
          bodyValidator: sessionRenewalRetryInputValidator,
          method: "POST",
          suffix: "/renewal/retry"
        }
      ];

      for (const {
        actionId,
        body,
        bodyLimit,
        bodyValidator,
        method,
        suffix
      } of routes) {
        const route = findRegisteredRoute(app, {
          method,
          path: `${apiRouteBase}/vibe64/sessions/:sessionId${suffix}`
        });
        assert.ok(route, `Expected ${method} ${suffix}`);
        assert.equal(route.options.body, bodyValidator);
        assert.equal(route.options.bodyLimit, bodyLimit);
        await route.handler({
          executeAction,
          input: { body },
          params,
          vibe64User: { username: "server-actor" }
        }, testReply());
        assert.equal(calls.at(-1).actionId, actionId);
        assert.equal(calls.at(-1).input.sessionId, "session-1");
        assert.equal(Object.hasOwn(calls.at(-1).input, "vibe64User"), false);
      }
    });
  });
});
