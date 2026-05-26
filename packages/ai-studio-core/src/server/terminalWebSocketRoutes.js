import {
  isLocalStudioRequest
} from "./localStudioRequest.js";

function sendSocketJson(socket, payload) {
  if (socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function publicTerminalSnapshot(session = {}) {
  const {
    unsubscribe,
    ...publicSession
  } = session || {};
  void unsubscribe;
  return publicSession;
}

function resolveFastify(app) {
  if (app && typeof app.get === "function") {
    return app;
  }
  if (app && typeof app.make === "function") {
    return app.make("jskit.fastify");
  }
  return null;
}

function registerTerminalWebSocketRoute(
  app,
  {
    routePath,
    resize,
    serviceId,
    serviceUnavailableMessage,
    subscribe,
    write
  } = {}
) {
  const fastify = resolveFastify(app);
  if (!fastify || typeof fastify.get !== "function") {
    throw new Error("registerTerminalWebSocketRoute requires Fastify get().");
  }
  if (!app || typeof app.make !== "function") {
    throw new Error("registerTerminalWebSocketRoute requires application make().");
  }

  fastify.get(
    routePath,
    { websocket: true },
    (socket, request) => {
      let subscription = null;
      let closed = false;

      const closeSubscription = () => {
        if (closed) {
          return;
        }
        closed = true;
        subscription?.unsubscribe?.();
        subscription = null;
      };

      const closeWithError = (code, error) => {
        sendSocketJson(socket, {
          error,
          type: "error"
        });
        socket.close(code, error);
      };

      if (!isLocalStudioRequest(request)) {
        closeWithError(1008, "Open Studio on localhost or 127.0.0.1.");
        return;
      }

      let service;
      try {
        service = app.make(serviceId);
      } catch (error) {
        closeWithError(1011, String(error?.message || error || serviceUnavailableMessage));
        return;
      }
      const sessionId = String(request.params?.sessionId || "");
      const terminalSessionId = String(request.params?.terminalSessionId || "");

      socket.on("message", async (rawMessage) => {
        try {
          const message = JSON.parse(rawMessage.toString());
          if (message?.type === "input") {
            const response = await write(service, {
              data: message.data,
              sessionId,
              terminalSessionId
            });
            if (response?.ok === false) {
              sendSocketJson(socket, {
                error: response.error || "Terminal input failed.",
                type: "error"
              });
            }
            return;
          }
          if (message?.type === "resize") {
            const response = await resize?.(service, {
              cols: message.cols,
              rows: message.rows,
              sessionId,
              terminalSessionId
            });
            if (response?.ok === false) {
              sendSocketJson(socket, {
                error: response.error || "Terminal resize failed.",
                type: "resize.error"
              });
            }
          }
        } catch (error) {
          sendSocketJson(socket, {
            error: String(error?.message || error || "Terminal socket message failed."),
            type: "error"
          });
        }
      });

      socket.on("close", closeSubscription);
      socket.on("error", closeSubscription);

      void Promise.resolve(subscribe(service, {
        sessionId,
        subscriber: (message) => {
          sendSocketJson(socket, message);
        },
        terminalSessionId
      })).then((result) => {
        if (result?.ok === false) {
          closeWithError(1008, result.error || "Terminal session not found.");
          return;
        }
        subscription = result;
        sendSocketJson(socket, {
          session: publicTerminalSnapshot(result),
          type: "snapshot"
        });
      }).catch((error) => {
        closeWithError(1011, String(error?.message || error || "Terminal stream failed."));
      });
    }
  );
}

export {
  publicTerminalSnapshot,
  registerTerminalWebSocketRoute,
  sendSocketJson
};
