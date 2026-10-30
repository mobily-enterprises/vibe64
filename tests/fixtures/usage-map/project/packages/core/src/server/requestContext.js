import { createLogger } from "./logger.js";
import * as metrics from "./metrics.js";

const logger = createLogger("http");

export function withRequestContext(handler) {
  return async function handleWithContext(request) {
    const context = readContext(request);
    metrics.info(request.method);
    logger.info(`${request.method} ${request.url}`);
    return handler(request, context);
  };
}

function readContext(request) {
  return { projectSlug: request.headers["x-project"] || "" };
}
