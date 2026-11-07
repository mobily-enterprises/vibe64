import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { E2E_SERVERS_READY, e2eServerPorts } from "./e2e-servers.mjs";

const HARNESS = fileURLToPath(new URL("./start-web-server.mjs", import.meta.url));
const STOP_SIGNALS = ["SIGINT", "SIGTERM"];

function portAnswers(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function healthy(port) {
  return fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.ok, () => false);
}

// Starts one app server per Playwright worker, each with the single-server
// harness's own throwaway state, after the build the config's command just
// made. Playwright waits for the ready line, then stops this launcher and its
// servers together with SIGTERM to their process group; each server runs its
// own shutdown, and this launcher exits once they all have. If Playwright dies
// without stopping it, its stdin pipe closes and it stops them the same way.
async function main() {
  const ports = e2eServerPorts();
  const busy = [];
  for (const port of ports) {
    if (await portAnswers(port)) busy.push(port);
  }
  if (busy.length > 0) {
    // As reuseExistingServer: false: a server already there may serve an older build.
    console.error(`Port ${busy.join(", ")} is already in use. Stop that server, or choose another PLAYWRIGHT_PORT.`);
    process.exitCode = 1;
    return;
  }

  const servers = ports.map((port) => {
    const child = spawn(process.execPath, [HARNESS], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["pipe", "inherit", "inherit"]
    });
    return { child, exited: once(child, "exit"), port };
  });
  let stopping = false;
  // Closing a server's stdin stops it as Playwright's own SIGTERM does; a
  // server that already has that signal ignores the second request.
  async function stop(exitCode) {
    if (stopping) return;
    stopping = true;
    for (const { child } of servers) child.stdin.end();
    await Promise.all(servers.map(({ exited }) => exited));
    process.exit(exitCode);
  }
  for (const signal of STOP_SIGNALS) process.once(signal, () => stop(128 + os.constants.signals[signal]));
  process.stdin.once("end", () => stop(0));
  process.stdin.resume();
  for (const { child, port } of servers) {
    child.once("exit", (code, signal) => {
      if (stopping) return;
      console.error(`The Vibe64 test server on port ${port} stopped (${signal || code}).`);
      void stop(1);
    });
  }

  // Playwright's webServer timeout bounds this wait.
  const waiting = new Set(ports);
  while (waiting.size > 0 && !stopping) {
    for (const port of waiting) {
      if (await healthy(port)) waiting.delete(port);
    }
    if (waiting.size > 0) await delay(100);
  }
  if (!stopping) console.log(`${E2E_SERVERS_READY} on ${ports.join(", ")}`);
}

main().catch((error) => {
  console.error("Failed to start the Vibe64 Playwright servers:", error);
  process.exitCode = 1;
});
