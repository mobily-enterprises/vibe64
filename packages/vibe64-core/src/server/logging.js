import {
  DEFAULT_VIBE64_LOG_LEVEL,
  resolveVibe64LogLevel
} from "../shared/logging.js";

const VIBE64_LOG_REDACT_PATHS = Object.freeze([
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['set-cookie']",
  "res.headers['set-cookie']",
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.token",
  "*.apiKey",
  "*.api_key"
]);

function createVibe64FastifyLoggerOptions({
  defaultLevel = DEFAULT_VIBE64_LOG_LEVEL,
  env = globalThis?.process?.env || {},
  level = ""
} = {}) {
  const resolved = resolveVibe64LogLevel({
    defaultLevel,
    env,
    level
  });
  const warnings = resolved.valid
    ? []
    : [
        {
          defaultLevel: resolved.defaultLevel,
          requestedLevel: resolved.requestedLevel,
          source: resolved.source
        }
      ];
  const logger = resolved.level === "silent"
    ? false
    : {
        level: resolved.level,
        redact: {
          censor: "[redacted]",
          paths: [...VIBE64_LOG_REDACT_PATHS]
        }
      };

  return {
    level: resolved.level,
    logger,
    warnings
  };
}

export {
  createVibe64FastifyLoggerOptions,
  DEFAULT_VIBE64_LOG_LEVEL,
  VIBE64_LOG_REDACT_PATHS
};
