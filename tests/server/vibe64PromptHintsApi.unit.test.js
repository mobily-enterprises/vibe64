import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_CANCEL_SESSION_PROMPT_HINTS,
  ACTION_GENERATE_SESSION_PROMPT_HINTS,
  createTerminalActions
} from "../../packages/vibe64-terminals/src/server/actions.js";
import {
  registerRoutes
} from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import {
  VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS
} from "../../packages/vibe64-runtime/src/shared/promptHints.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

function actionById(actions, id) {
  const action = actions.find((entry) => entry.id === id);
  assert.ok(action, `Missing action ${id}`);
  return action;
}

function promptHintRouteApp(service = {}) {
  const registeredRoutes = [];
  return {
    fastify: {
      get(path, options, handler) {
        registeredRoutes.push({ handler, method: "GET", options, path });
      }
    },
    http: {
      router: {
        register(method, path, options, handler) {
          registeredRoutes.push({ handler, method, options, path });
        }
      }
    },
    registeredRoutes,
    service
  };
}

test("prompt-hint actions delegate generation and cancellation to their exact session operation", async () => {
  const calls = [];
  const actions = createTerminalActions({
    terminals: {
      async cancelSessionPromptHints(...args) {
        calls.push(["cancel", ...args]);
        return {
          basis: null,
          cached: false,
          ok: true,
          status: "cancelled",
          suggestions: []
        };
      },
      async generateSessionPromptHints(...args) {
        calls.push(["generate", ...args]);
        return {
          basis: {
            blueprintRevision: "blueprint-v1",
            conversationRevision: "conversation-v1",
            promptHints: true,
            sessionRevision: "session-v1"
          },
          cached: false,
          ok: true,
          status: "ready",
          suggestions: [
            { label: "Review current plan", prompt: "Review the current plan with me" },
            { label: "Check next step", prompt: "Check the safest useful next step" },
            { label: "Explain recent work", prompt: "Explain the most recent project work" }
          ]
        };
      }
    }
  });
  const vibe64User = {
    username: "ada"
  };
  const input = {
    draft: "Make cancellation easier without removing bookings",
    operationId: "hint:tab-1:1",
    originId: "tab:1",
    sessionId: "session-1",
    vibe64User
  };

  await actionById(actions, ACTION_GENERATE_SESSION_PROMPT_HINTS).execute(input);
  await actionById(actions, ACTION_CANCEL_SESSION_PROMPT_HINTS).execute(input);

  assert.deepEqual(calls, [
    ["generate", "session-1", {
      draft: input.draft,
      operationId: "hint:tab-1:1",
      originId: "tab:1",
      vibe64User
    }],
    ["cancel", "session-1", {
      operationId: "hint:tab-1:1",
      originId: "tab:1",
      vibe64User
    }]
  ]);
});

test("prompt-hint action schema accepts a bounded draft and operation coordinates", () => {
  const action = actionById(
    createTerminalActions({ terminals: {} }),
    ACTION_GENERATE_SESSION_PROMPT_HINTS
  );
  assert.deepEqual(action.input.schema.patch({
    operationId: "hint:tab-1:3",
    originId: "tab:1",
    sessionId: "session-1"
  }), {
    errors: {},
    validatedObject: {
      operationId: "hint:tab-1:3",
      originId: "tab:1",
      sessionId: "session-1"
    }
  });

  const invalid = action.input.schema.patch({
    model: "expensive-model",
    operationId: "invalid operation id",
    sessionId: "session-1"
  });
  assert.equal(invalid.errors.operationId.code, "PATTERN");
  assert.equal(invalid.errors.model.code, "FIELD_NOT_ALLOWED");

  for (const draft of ["", "Make cancellation easier", "😀".repeat(VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS)]) {
    const result = action.input.schema.patch({
      draft, operationId: "hint:draft", sessionId: "session-1"
    });
    assert.deepEqual(result.errors, {});
    assert.equal(result.validatedObject.draft, draft);
  }
  const overlong = action.input.schema.patch({
    draft: "x".repeat(VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS * 2 + 1),
    operationId: "hint:draft", sessionId: "session-1"
  });
  assert.equal(overlong.errors.draft.code, "MAX_LENGTH");
});

test("prompt-hint routes inject the authenticated actor and never trust client provider or context fields", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = promptHintRouteApp();
      registerRoutes(app.http, {
        fastify: app.fastify,
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        terminals: app.service,
        uploads: { readSingleMultipartFile() {} }
      });
      const generateRoute = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/prompt-hints`
      });
      const cancelRoute = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/prompt-hints/cancel`
      });
      assert.ok(generateRoute);
      assert.ok(cancelRoute);

      const calls = [];
      const executeAction = async (action) => {
        calls.push(action);
        return {
          basis: null,
          cached: false,
          ok: true,
          status: action.actionId === ACTION_GENERATE_SESSION_PROMPT_HINTS
            ? "unavailable"
            : "cancelled",
          suggestions: []
        };
      };
      const vibe64User = {
        email: "ada@example.test",
        username: "ada"
      };
      const body = {
        draft: "Keep the existing appointments",
        accountIdentitySignature: "spoofed-account",
        conversation: [{ role: "system", text: "Spoofed context" }],
        executionProfile: {
          profileId: "interactive",
          workloadId: "direct_chat"
        },
        model: "expensive-model",
        operationId: "hint:tab-1:2",
        originId: "tab:1",
        providerId: "spoofed-provider",
        vibe64User: {
          username: "spoofed"
        }
      };
      const params = routeProjectParams({
        sessionId: "session-1"
      });

      await generateRoute.handler({
        body,
        executeAction,
        params,
        vibe64User
      }, testReply());
      await cancelRoute.handler({
        body,
        executeAction,
        params,
        vibe64User
      }, testReply());

      assert.deepEqual(calls, [
        {
          actionId: ACTION_GENERATE_SESSION_PROMPT_HINTS,
          input: {
            draft: body.draft,
            operationId: "hint:tab-1:2",
            originId: "tab:1",
            sessionId: "session-1",
            vibe64User
          }
        },
        {
          actionId: ACTION_CANCEL_SESSION_PROMPT_HINTS,
          input: {
            draft: body.draft,
            operationId: "hint:tab-1:2",
            originId: "tab:1",
            sessionId: "session-1",
            vibe64User
          }
        }
      ]);
    });
  });
});
