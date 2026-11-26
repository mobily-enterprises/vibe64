import { randomInt } from "node:crypto";
import { createServer } from "node:net";

import { ephemeralPortRange } from "@local/vibe64-terminals/server/ephemeralPortRange";

const LOWEST = 24_000;

function free(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/**
 * A free localhost port for a server a test must name before it starts, because the server is told its port rather
 * than reporting the one it bound: a Preview's Stack names its preferred port, and the product hands its port to the
 * Run command. It is below the host's ephemeral range, where no outgoing connection takes it before the server binds
 * it (get-port's ports are in that range), and random, so files and runs on one host rarely pick the same one; each
 * is checked free, but a port another run's server binds after the check is still lost.
 */
export async function portBelowEphemeralRange() {
  const highest = Math.min(32_767, (await ephemeralPortRange()).first - 1);
  if (highest < LOWEST) throw new Error(`The host's ephemeral range starts below ${LOWEST + 1}: no test port is left below it.`);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const port = randomInt(LOWEST, highest + 1);
    if (await free(port)) return port;
  }
  throw new Error(`No free port found between ${LOWEST} and ${highest}.`);
}
