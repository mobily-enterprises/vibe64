// What an adapter answers when a connection is not in effect, or refuses one.
import { vibe64Error } from "@local/vibe64-core/server/core";

/** A proof's answer when the connection is not in effect, with the one-sentence reason. */
function notInEffect(reason) {
  return { inEffect: false, reason };
}

/**
 * The answer for a connection nothing in the session installs, with why: apply returns
 * { lines, unused } and proof { inEffect: false, unused: true, reason }. It is not a failure;
 * preparation goes on and says so.
 */
function notUsed(reason) {
  return { inEffect: false, unused: true, reason };
}

/** A refusal naming the connection, with its repository in the error's params. */
function connectionError(connection, message, code) {
  return vibe64Error(`Connected ${connection.name}: ${message}`, code, { params: { repository: connection.repository } });
}

export { connectionError, notInEffect, notUsed };
