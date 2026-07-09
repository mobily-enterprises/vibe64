import {
  firstText,
  normalizeText
} from "../normalize.js";
import {
  currentActorUser,
  resolvedActorUser
} from "./userIdentity.js";

function actorUsernameFromRequest(request = {}) {
  return firstText(
    request.userKey,
    request.project?.ownerUserKey,
    request.project?.ownerUsername,
    request.project?.ownerUser?.username,
    request.session?.metadata?.workflow_driver_username,
    request.session?.metadata?.session_git_command_actor_user_key
  );
}

async function resolveVibe64CommandActor(request = {}) {
  const actor = normalizeText(request.actor) || "daemon";
  if (actor === "daemon" || actor === "app") {
    return {
      actor,
      credentialScope: actor,
      requiresRealUser: false,
      user: currentActorUser()
    };
  }
  const username = actorUsernameFromRequest(request);
  if (!username) {
    const error = new Error("A user key is required for real-user command execution.");
    error.code = "vibe64_command_actor_user_required";
    throw error;
  }
  return {
    actor,
    credentialScope: "user",
    requiresRealUser: true,
    user: await resolvedActorUser(username)
  };
}

export {
  actorUsernameFromRequest,
  resolveVibe64CommandActor
};
