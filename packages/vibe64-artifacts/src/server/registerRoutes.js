import {
  currentStepInputValidator
} from "./inputSchemas.js";
import {
  ACTION_READ_ARTIFACT_PREVIEW,
  ACTION_READ_ARTIFACT_READINESS,
  ACTION_SUBMIT_CURRENT_STEP_INPUT
} from "./actions.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import {
  isLocalStudioRequest
} from "@local/vibe64-core/server/localStudioRequest";
import {
  resolveProjectRequestContext,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";

const ARTIFACTS_SERVICE_ID = "feature.vibe64-artifacts.service";

function getArtifactsService(app) {
  return app.make(ARTIFACTS_SERVICE_ID);
}

function sendSocketJson(socket, payload) {
  if (socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

async function sendArtifactReadinessEventStream(reply, run) {
  if (!reply?.raw) {
    throw new Error("Artifact readiness streams require a Fastify reply with raw stream access.");
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
    emit("artifact-readiness.error", {
      error: String(error?.message || error || "Artifact readiness stream failed.")
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
    projectContext = null,
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 artifact routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-artifacts"]
  });

  routes.actionRoute("GET", "/sessions/:sessionId/artifact-preview", {
    actionId: ACTION_READ_ARTIFACT_PREVIEW,
    buildInput(request) {
      return {
        previewId: request.query?.previewId,
        sessionId: request.params.sessionId
      };
    },
    summary: "Read a server-owned Vibe64 artifact preview."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/artifact-readiness", {
    actionId: ACTION_READ_ARTIFACT_READINESS,
    buildInput(request) {
      return {
        sessionId: request.params.sessionId
      };
    },
    summary: "Read Vibe64 artifact readiness."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/current-step/input", {
    actionId: ACTION_SUBMIT_CURRENT_STEP_INPUT,
    body: currentStepInputValidator,
    buildInput(request) {
      return {
        ...routes.requestBody(request),
        sessionId: request.params.sessionId
      };
    },
    summary: "Submit input for the current Vibe64 workflow step."
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/artifact-readiness/stream", {
    summary: "Stream Vibe64 artifact readiness updates."
  }, async (request, reply) => {
    await sendArtifactReadinessEventStream(reply, ({ emit, isClosed, onClose }) => {
      return getArtifactsService(app).streamArtifactReadiness(request.params.sessionId, {
        emit,
        isClosed,
        onClose
      });
    });
  });

  registerArtifactReadinessWebSocketRoute(app, routes, {
    projectContext
  });
}

function registerArtifactReadinessWebSocketRoute(app, routes, {
  projectContext = null
} = {}) {
  const fastify = app.make("jskit.fastify");
  fastify.get(
    `${routes.routeBase}/sessions/:sessionId/artifact-readiness/ws`,
    { websocket: true },
    (socket, request) => {
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

      function closeWithError(code, error) {
        sendSocketJson(socket, {
          error,
          type: "artifact-readiness.error"
        });
        closeStream();
        socket.close(code, error);
      }

      if (!isLocalStudioRequest(request)) {
        closeWithError(1008, "Open Studio on localhost or 127.0.0.1.");
        return;
      }

      socket.on("close", closeStream);
      socket.on("error", closeStream);

      void (async () => {
        let projectContextValue;
        try {
          projectContextValue = await resolveProjectRequestContext({
            projectContext,
            request
          });
        } catch (error) {
          closeWithError(1008, String(error?.message || error || "Vibe64 project request failed."));
          return;
        }

        await runWithProjectRequestContext(projectContextValue, () => {
          return getArtifactsService(app).streamArtifactReadiness(request.params.sessionId, {
            emit(event, payload = {}) {
              sendSocketJson(socket, {
                ...payload,
                type: event
              });
            },
            isClosed: () => closed,
            onClose(handler) {
              if (closed) {
                handler();
                return;
              }
              closeHandlers.add(handler);
            }
          });
        });
        if (!closed) {
          closeStream();
          socket.close(1000, "Artifact readiness stream ended.");
        }
      })().catch((error) => {
        closeWithError(1011, String(error?.message || error || "Artifact readiness stream failed."));
      });
    }
  );
}

export { registerRoutes };
