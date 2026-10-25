// What identifies a saved AI connection on both sides of the wire: the
// OpenCode provider id and the sha256 revision of its catalogue definition.
const AI_CONNECTION_PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const AI_CONNECTION_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export {
  AI_CONNECTION_PROVIDER_PATTERN,
  AI_CONNECTION_REVISION_PATTERN
};
