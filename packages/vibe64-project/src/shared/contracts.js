// Project contracts that the server enforces and the client mirrors.

// The source a host gives Env records whose value it supplies from a saved value.
const SAVED_ENV_VALUE_SOURCE = "vibe64-host:saved-value";
// The most entries vibe64.connections.json may hold.
const CONNECTED_PROJECTS_LIMIT = 64;

/**
 * An Env value without its one final line ending ("\n" or "\r\n"). `echo`,
 * `openssl rand` and heredocs end what they pipe with one, and a single-line
 * field cannot mean one, so neither keeps it; every other character, any
 * other whitespace included, stays exact. A value that really ends with a line
 * break arrives with two and keeps one.
 * @param {string} value
 * @returns {string}
 */
function envValueWithoutFinalLineEnding(value = "") {
  const text = String(value ?? "");
  if (text.endsWith("\r\n")) {
    return text.slice(0, -2);
  }
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export {
  CONNECTED_PROJECTS_LIMIT,
  envValueWithoutFinalLineEnding,
  SAVED_ENV_VALUE_SOURCE
};
