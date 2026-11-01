/**
 * The fields every vibe64 action shares, spread first into each action literal. An action writes a field
 * itself only where it differs (its own channels, idempotency, output or events).
 */
const VIBE64_ACTION_CHANNELS = Object.freeze(["api", "automation", "internal"]);
const VIBE64_ACTION_SURFACES = Object.freeze(["app"]);

const VIBE64_QUERY = Object.freeze({
  version: 1,
  kind: "query",
  output: null,
  idempotency: "none",
  channels: VIBE64_ACTION_CHANNELS,
  surfaces: VIBE64_ACTION_SURFACES
});

const VIBE64_COMMAND = Object.freeze({
  version: 1,
  kind: "command",
  output: null,
  idempotency: "optional",
  channels: VIBE64_ACTION_CHANNELS,
  surfaces: VIBE64_ACTION_SURFACES
});

export {
  VIBE64_COMMAND,
  VIBE64_QUERY
};
