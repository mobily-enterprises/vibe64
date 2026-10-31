import { currentProjectVibe64User } from "@local/vibe64-core/server/projectRequestContext";

/**
 * The person an assistant operation acts for: the request's authenticated
 * user, else the one an internal caller names in its input.
 * @param {{ vibe64User?: object | null }} input
 */
function trustedAssistantUser(input) {
  return currentProjectVibe64User() || input.vibe64User || null;
}

export { trustedAssistantUser };
