import { isLocalStudioRequest } from "@local/vibe64-core/server/localStudioRequest";
import { currentOsUser } from "@local/vibe64-core/server/osUserIdentity";

/**
 * The learner of a request from this computer: its OS user, as the workspace owner. A browser-supplied actor is never
 * local authority, so the request is checked as a local Studio request without any signed-in user it carries.
 * @param {object | null} request
 */
function localLearnerActor(request) {
  if (!request || !isLocalStudioRequest(Object.assign(Object.create(request), { vibe64User: null }))) return null;
  const actor = currentOsUser();
  return Number.isSafeInteger(actor.uid) && actor.uid >= 0 && actor.username ? { ...actor, role: "owner" } : null;
}

export { localLearnerActor };
