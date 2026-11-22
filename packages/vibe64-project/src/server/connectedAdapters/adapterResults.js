// What an adapter answers when a connection is not in effect, or refuses one.
import { vibe64Error } from "@local/vibe64-core/server/core";

/** A proof's answer when the connection is not in effect, with the one-sentence reason. */
function notInEffect(reason) {
  return { inEffect: false, reason };
}

/** A refusal naming the connection, with its repository in the error's params. */
function connectionError(connection, message, code) {
  return vibe64Error(`Connected ${connection.name}: ${message}`, code, { params: { repository: connection.repository } });
}

export { connectionError, notInEffect };
