import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import {
  codexAttachmentInputValidator,
  codexPromptHandoffInputValidator,
  codexThreadInputValidator,
  launchTargetInputValidator
} from "./inputSchemas.js";
import {
  ACTION_OPEN_LAUNCH_TARGET,
  ACTION_SAVE_CODEX_PROMPT_HANDOFF,
  ACTION_SAVE_CODEX_THREAD,
  ACTION_START_LAUNCH_TARGET_TERMINAL,
  ACTION_UPLOAD_CODEX_ATTACHMENT
} from "./actions.js";
import {
  requireLocalStudioRequest
} from "../../../../server/lib/localStudioRequest.js";
import {
  aiStudioStatusCode,
  requestBodyObject
} from "../../../../server/lib/aiStudio/serverResponses.js";

function getTerminalService(app) {
  return app.make("feature.ai-studio-terminals.service");
}

function requireLocalAiStudioRequest(request, reply) {
  return requireLocalStudioRequest(request, reply, {
    message: "AI Studio terminal routes only accept loopback Studio requests."
  });
}

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveScopedApiBasePath({
    routeBase: "/",
    relativePath: routeRelativePath,
    strictParams: false
  });

  router.register(
    "GET",
    `${routeBase}/sessions/:sessionId/launch-targets`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Read AI Studio launch target status."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getTerminalService(app).launchTargetStatus(request.params.sessionId);
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/launch-terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Start an AI Studio launch target terminal."
      },
      body: launchTargetInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_START_LAUNCH_TARGET_TERMINAL,
        input: {
          ...requestBodyObject(request),
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/launch-target/open`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Open the latest AI Studio launch target."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_OPEN_LAUNCH_TARGET,
        input: {
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/command-terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Start an AI Studio command terminal."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getTerminalService(app).startCommandTerminal(
        request.params.sessionId,
        requestBodyObject(request)
      );
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/codex-terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Start an AI Studio Codex terminal."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getTerminalService(app).startCodexTerminal(request.params.sessionId);
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/codex-attachments`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Upload a temporary Codex attachment for an AI Studio session."
      },
      body: codexAttachmentInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_UPLOAD_CODEX_ATTACHMENT,
        input: {
          ...requestBodyObject(request),
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/codex-thread`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Persist the active Codex thread for an AI Studio session."
      },
      body: codexThreadInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_SAVE_CODEX_THREAD,
        input: {
          ...requestBodyObject(request),
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/codex-prompt-handoff`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Persist the active Codex prompt handoff for an AI Studio session."
      },
      body: codexPromptHandoffInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_SAVE_CODEX_PROMPT_HANDOFF,
        input: {
          ...requestBodyObject(request),
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/sessions/:sessionId/launch-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Read an AI Studio launch target terminal snapshot."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getTerminalService(app).readLaunchTargetTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(response?.ok === false ? 404 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/sessions/:sessionId/launch-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Close an AI Studio launch target terminal."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getTerminalService(app).closeLaunchTargetTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/sessions/:sessionId/codex-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Read an AI Studio Codex terminal snapshot."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getTerminalService(app).readCodexTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(response?.ok === false ? 404 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/sessions/:sessionId/codex-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Close an AI Studio Codex terminal."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getTerminalService(app).closeCodexTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/sessions/:sessionId/command-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Read an AI Studio command terminal snapshot."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getTerminalService(app).readCommandTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(response?.ok === false ? 404 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/sessions/:sessionId/command-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-terminals"],
        summary: "Close an AI Studio command terminal."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getTerminalService(app).closeCommandTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
