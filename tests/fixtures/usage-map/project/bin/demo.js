#!/usr/bin/env node
import { createLogger } from "../packages/core/src/server/logger.js";
import { listSessions } from "../packages/sessions/src/server/service.js";

const logger = createLogger("cli");

async function main(argv) {
  const sessions = await listSessions({ limit: Number(argv[2] || 10) });
  for (const session of sessions) logger.info(session.title);
}

await main(process.argv);
