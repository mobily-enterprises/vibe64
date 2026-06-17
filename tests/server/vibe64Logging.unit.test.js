import assert from "node:assert/strict";
import test from "node:test";

import {
  createVibe64FastifyLoggerOptions
} from "../../packages/vibe64-core/src/server/logging.js";
import {
  isVibe64DebugLoggingEnabled,
  isVibe64LogLevelEnabled,
  resolveVibe64LogLevel
} from "../../packages/vibe64-core/src/shared/logging.js";
import {
  vibe64SessionDebugLog
} from "../../packages/vibe64-runtime/src/server/sessionDebugLogCore.js";

test("Vibe64 log level defaults to warnings and honors env overrides", () => {
  assert.deepEqual(resolveVibe64LogLevel({
    env: {}
  }), {
    defaultLevel: "warn",
    level: "warn",
    requestedLevel: "",
    source: "default",
    valid: true
  });

  assert.equal(resolveVibe64LogLevel({
    env: {
      VIBE64_LOG_LEVEL: "info"
    }
  }).level, "info");
  assert.equal(resolveVibe64LogLevel({
    env: {
      LOG_LEVEL: "error"
    }
  }).level, "error");
  assert.equal(resolveVibe64LogLevel({
    env: {
      VIBE64_LOG_LEVEL: "error"
    },
    level: "debug"
  }).level, "debug");
});

test("Vibe64 Fastify logger options disable noisy request logs by default", () => {
  const defaults = createVibe64FastifyLoggerOptions({
    env: {}
  });
  assert.equal(defaults.level, "warn");
  assert.equal(defaults.logger.level, "warn");
  assert.deepEqual(defaults.warnings, []);
  assert.equal(isVibe64LogLevelEnabled("info", defaults.level), false);
  assert.equal(isVibe64LogLevelEnabled("warn", defaults.level), true);

  const silent = createVibe64FastifyLoggerOptions({
    env: {
      VIBE64_LOG_LEVEL: "silent"
    }
  });
  assert.equal(silent.level, "silent");
  assert.equal(silent.logger, false);
});

test("Vibe64 logging reports invalid configured log levels", () => {
  const options = createVibe64FastifyLoggerOptions({
    env: {
      VIBE64_LOG_LEVEL: "verbose"
    }
  });
  assert.equal(options.level, "warn");
  assert.equal(options.logger.level, "warn");
  assert.deepEqual(options.warnings, [
    {
      defaultLevel: "warn",
      requestedLevel: "verbose",
      source: "VIBE64_LOG_LEVEL"
    }
  ]);
});

test("Vibe64 debug streams are opt-in", () => {
  assert.equal(isVibe64DebugLoggingEnabled({
    env: {}
  }), false);
  assert.equal(isVibe64DebugLoggingEnabled({
    env: {
      VIBE64_LOG_LEVEL: "debug"
    }
  }), true);
  assert.equal(isVibe64DebugLoggingEnabled({
    env: {
      VIBE64_SESSION_DEBUG: "1"
    },
    flagName: "VIBE64_SESSION_DEBUG"
  }), true);

  const lines = [];
  const originalInfo = console.info;
  console.info = (...args) => {
    lines.push(args.map((part) => String(part)).join(" "));
  };
  try {
    vibe64SessionDebugLog("test.off", {}, {
      env: {}
    });
    vibe64SessionDebugLog("test.on", {}, {
      env: {
        VIBE64_SESSION_DEBUG: "1"
      }
    });
  } finally {
    console.info = originalInfo;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /test\.on/u);
});
