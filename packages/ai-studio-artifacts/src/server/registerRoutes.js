import {
  artifactsInputValidator,
  issueArtifactsInputValidator
} from "./inputSchemas.js";
import {
  ACTION_CLEAR_AUTOPILOT_ARTIFACTS,
  ACTION_CLEAR_ISSUE_ARTIFACTS,
  ACTION_READ_ARTIFACTS,
  ACTION_READ_AUTOPILOT_ARTIFACTS,
  ACTION_SAVE_ARTIFACTS,
  ACTION_SAVE_ISSUE_ARTIFACTS
} from "./actions.js";
import { createAiStudioFeatureRoutes } from "../../../../server/lib/aiStudio/featureRoutes.js";

function getArtifactsService(app) {
  return app.make("feature.ai-studio-artifacts.service");
}

async function sendAutopilotArtifactsEventStream(reply, run) {
  if (!reply?.raw) {
    throw new Error("Autopilot artifact streams require a Fastify reply with raw stream access.");
  }

  reply.hijack?.();

  const rawReply = reply.raw;
  const closeHandlers = new Set();
  let closed = false;

  function closeStream() {
    if (closed) {
      return;
    }
    closed = true;
    for (const handler of [...closeHandlers]) {
      handler();
    }
    closeHandlers.clear();
  }

  rawReply.on?.("close", closeStream);
  rawReply.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no"
  });
  rawReply.write("retry: 3000\n");
  rawReply.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    if (!closed) {
      rawReply.write(": heartbeat\n\n");
    }
  }, 15000);
  heartbeat.unref?.();

  const emit = (event, payload = {}) => {
    if (closed) {
      return;
    }
    rawReply.write(`event: ${event}\n`);
    rawReply.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    await run({
      emit,
      isClosed: () => closed,
      onClose(handler) {
        if (closed) {
          handler();
          return;
        }
        closeHandlers.add(handler);
      }
    });
  } catch (error) {
    emit("autopilot-artifacts.error", {
      error: String(error?.message || error || "Autopilot artifact stream failed.")
    });
  } finally {
    clearInterval(heartbeat);
    rawReply.off?.("close", closeStream);
    closeStream();
    if (!rawReply.destroyed) {
      rawReply.end();
    }
  }
}

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createAiStudioFeatureRoutes(app, {
    localRequestMessage: "AI Studio artifact routes only accept loopback Studio requests.",
    routeRelativePath,
    routeSurface,
    tags: ["studio", "ai-studio-artifacts"]
  });

  routes.actionRoute("GET", "/sessions/:sessionId/artifacts", {
    actionId: ACTION_READ_ARTIFACTS,
    buildInput(request) {
      return {
        actionId: request.query?.actionId,
        sessionId: request.params.sessionId
      };
    },
    summary: "Read editable AI Studio artifacts."
  });

  routes.actionRoute("PUT", "/sessions/:sessionId/artifacts", {
    actionId: ACTION_SAVE_ARTIFACTS,
    body: artifactsInputValidator,
    buildInput(request) {
      return {
        ...routes.requestBody(request),
        sessionId: request.params.sessionId
      };
    },
    summary: "Save editable AI Studio artifacts."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/autopilot-artifacts", {
    actionId: ACTION_READ_AUTOPILOT_ARTIFACTS,
    buildInput(request) {
      return {
        sessionId: request.params.sessionId
      };
    },
    summary: "Read AI Studio Autopilot files."
  });

  routes.actionRoute("DELETE", "/sessions/:sessionId/autopilot-artifacts", {
    actionId: ACTION_CLEAR_AUTOPILOT_ARTIFACTS,
    buildInput(request) {
      return {
        sessionId: request.params.sessionId
      };
    },
    summary: "Clear AI Studio Autopilot files."
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/autopilot-artifacts/stream", {
    summary: "Stream AI Studio Autopilot file updates."
  }, async (request, reply) => {
    await sendAutopilotArtifactsEventStream(reply, ({ emit, isClosed, onClose }) => {
      return getArtifactsService(app).streamAutopilotArtifacts(request.params.sessionId, {
        emit,
        isClosed,
        onClose
      });
    });
  });

  routes.actionRoute("PUT", "/sessions/:sessionId/issue-artifacts", {
    actionId: ACTION_SAVE_ISSUE_ARTIFACTS,
    body: issueArtifactsInputValidator,
    buildInput(request) {
      return {
        ...routes.requestBody(request),
        sessionId: request.params.sessionId
      };
    },
    summary: "Save AI Studio issue title and body artifacts."
  });

  routes.actionRoute("DELETE", "/sessions/:sessionId/issue-artifacts", {
    actionId: ACTION_CLEAR_ISSUE_ARTIFACTS,
    buildInput(request) {
      return {
        sessionId: request.params.sessionId
      };
    },
    summary: "Clear AI Studio issue title and body artifacts."
  });
}

export { registerRoutes };
