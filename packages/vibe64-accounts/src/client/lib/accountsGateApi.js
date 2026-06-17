import {
  resolveWebSocketUrl,
  studioApiPath
} from "/src/lib/studioUrls.js";
import {
  vibe64ProjectQueryScope
} from "/src/lib/vibe64ProjectScope.js";

const VIBE64_ACCOUNTS_AUTH_API_SUFFIX = "/vibe64/accounts/auth";
const VIBE64_ACCOUNTS_CHANGED_EVENT = "vibe64.accounts.changed";

const ACCOUNTS_ENDPOINT = studioApiPath("vibe64/accounts");
const ACCOUNTS_AUTH_ENDPOINT = `${ACCOUNTS_ENDPOINT}/auth`;
const ACCOUNTS_LOGOUT_ENDPOINT = `${ACCOUNTS_ENDPOINT}/logout`;

function accountsQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "accounts"];
}

function accountAuthTerminalWebSocketUrl(sessionId = "") {
  return resolveWebSocketUrl(`${ACCOUNTS_AUTH_ENDPOINT}/${encodeURIComponent(String(sessionId || ""))}/ws`);
}

export {
  ACCOUNTS_AUTH_ENDPOINT,
  ACCOUNTS_ENDPOINT,
  ACCOUNTS_LOGOUT_ENDPOINT,
  VIBE64_ACCOUNTS_AUTH_API_SUFFIX,
  VIBE64_ACCOUNTS_CHANGED_EVENT,
  accountAuthTerminalWebSocketUrl,
  accountsQueryKey
};
