import { followHeldRequest } from "./vibe64HeldRequest.js";

const PULL_REQUEST_LOST_CONTACT =
  "Vibe64 could not be reached to follow this pull request. Check the session's pull request before creating it again.";
const PULL_REQUEST_NOT_CREATED = "Vibe64 could not create this pull request. Check the session's pull request and try again.";

/**
 * Creates a pull request through the dialog's request, `send(repeat)`, followed while the server answers that it is
 * creating (`followHeldRequest`).
 * @template T
 * @param {(repeat: boolean) => Promise<T>} send
 * @param {{ wait?: (ms: number) => Promise<unknown> }} [options]
 * @returns {Promise<T>}
 */
function createPullRequestFollowed(send, { wait } = {}) {
  return followHeldRequest(send, {
    lostContact: PULL_REQUEST_LOST_CONTACT,
    notWorded: PULL_REQUEST_NOT_CREATED,
    ...(wait ? { wait } : {})
  });
}

export { PULL_REQUEST_LOST_CONTACT, PULL_REQUEST_NOT_CREATED, createPullRequestFollowed };
