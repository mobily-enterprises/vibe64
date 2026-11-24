// The real editor server in a process of its own, run as a host runs it: composed, on TCP, with an asynchronous
// sign-in check in front of every WebSocket upgrade, as a host's is (it waits on its store), held here until the test
// releases it. It also serves a Preview of a WebSocket app. It tells its parent what it serves and answers its
// messages over IPC; its roots are below the folder its first argument names. A peer's reset that this process does
// not handle ends it, which is what the test looks for.
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";

import { createLaunchPreviewProxyRegistry } from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";
import { createServer } from "../../server.js";

const [root] = process.argv.slice(2);
const held = new Set();

const app = await createServer({
  browserLifecycleShutdownDelayMs: 0,
  logLevel: "warn",
  projectsRoot: path.join(root, "projects"),
  runtimeProfile: Object.freeze({
    authRequired: false,
    local: false,
    mode: "composed",
    projectCatalogEnabled: true,
    singleTargetRoot: ""
  }),
  systemRoot: path.join(root, "system")
});
app.addHook("preHandler", async (request) => {
  // Socket.IO answers its own upgrades outside Fastify's hooks.
  if (!request.ws || String(request.url).startsWith("/socket.io/")) return;
  const release = Promise.withResolvers();
  held.add(release.resolve);
  process.send({ type: "held", path: String(request.url).split("?")[0] });
  await release.promise;
});
await app.listen({ host: "127.0.0.1", port: 0 });

// The Preview's app: each WebSocket echoes what it is sent.
const appSockets = new Set();
const target = createHttpServer((_request, response) => response.writeHead(404).end());
const targetWebSockets = new WebSocketServer({ noServer: true });
targetWebSockets.on("connection", (socket) => socket.on("message", (message) => socket.send(`echo:${message}`)));
target.on("upgrade", (request, socket, head) => {
  targetWebSockets.handleUpgrade(request, socket, head, (webSocket) => targetWebSockets.emit("connection", webSocket, request));
});
target.on("connection", (socket) => {
  appSockets.add(socket);
  socket.once("close", () => appSockets.delete(socket));
});
await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
const previews = createLaunchPreviewProxyRegistry({ env: process.env });
const preview = await previews.ensure({
  sessionId: "session-peer-reset",
  targetHref: `http://127.0.0.1:${target.address().port}/hmr`,
  terminalSessionId: "terminal-peer-reset"
});

const answers = {
  release() {
    for (const resolve of held) resolve();
    held.clear();
    return { type: "released" };
  },
  state() {
    return { type: "state", appSockets: appSockets.size, editorWebSockets: app.websocketServer.clients.size };
  },
  "reset-app"() {
    // The app's side of each connection sends a reset, as an app that crashes or restarts does.
    for (const socket of appSockets) socket.resetAndDestroy();
    return { type: "app-reset" };
  },
  async exit() {
    await previews.closeAll();
    targetWebSockets.close();
    for (const socket of appSockets) socket.destroy();
    await new Promise((resolve) => target.close(resolve));
    await app.close();
    process.exit(0);
  }
};
process.on("message", async (message) => process.send(await answers[message]()));
process.send({ type: "ready", port: app.server.address().port, previewHref: preview.href });
