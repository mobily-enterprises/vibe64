import assert from "node:assert/strict";
import test from "node:test";

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

test("renewal actions use server action context identity and domain-native idempotency", async () => {
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
});

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
