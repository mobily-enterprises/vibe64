import pino from "pino";

/**
 * The Fastify logger's options. Fastify's logger serializes only the `err` key, so the same serializer under `error`
 * keeps the message and stack of `logger.error({ error }, "...")`.
 */
function buildLoggerOptions() {
  return {
    serializers: {
      error: pino.stdSerializers.err
    }
  };
}

export { buildLoggerOptions };
