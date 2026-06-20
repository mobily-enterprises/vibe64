import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";

import {
  studioApiPath
} from "/src/lib/studioUrls.js";
import {
  vibe64ProjectQueryScope
} from "/src/lib/vibe64ProjectScope.js";

const VIBE64_MANAGED_APP_AUTH_CHANGED_EVENT = "vibe64.managed-app-auth.changed";
const MANAGED_APP_AUTH_ENDPOINT = studioApiPath("vibe64/managed-app-auth");
const MANAGED_APP_AUTH_CONNECT_ENDPOINT = `${MANAGED_APP_AUTH_ENDPOINT}/connect`;
const MANAGED_APP_AUTH_SETUP_ENDPOINT = `${MANAGED_APP_AUTH_ENDPOINT}/setup`;
const MANAGED_APP_AUTH_SYNC_ENDPOINT = `${MANAGED_APP_AUTH_ENDPOINT}/sync`;
const MANAGED_APP_AUTH_SMTP_LOGIN_ENDPOINT = `${MANAGED_APP_AUTH_ENDPOINT}/smtp-login`;
const MANAGED_APP_AUTH_SMTP_LOGIN_DISCONNECT_ENDPOINT = `${MANAGED_APP_AUTH_SMTP_LOGIN_ENDPOINT}/disconnect`;
const MANAGED_APP_AUTH_DISCONNECT_ENDPOINT = `${MANAGED_APP_AUTH_ENDPOINT}/disconnect`;

function managedAppAuthQueryKey(surfaceId, ownershipFilter = ROUTE_VISIBILITY_PUBLIC, projectSlug = "") {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "managed-app-auth"];
}

export {
  MANAGED_APP_AUTH_CONNECT_ENDPOINT,
  MANAGED_APP_AUTH_DISCONNECT_ENDPOINT,
  MANAGED_APP_AUTH_ENDPOINT,
  MANAGED_APP_AUTH_SETUP_ENDPOINT,
  MANAGED_APP_AUTH_SMTP_LOGIN_DISCONNECT_ENDPOINT,
  MANAGED_APP_AUTH_SMTP_LOGIN_ENDPOINT,
  MANAGED_APP_AUTH_SYNC_ENDPOINT,
  VIBE64_MANAGED_APP_AUTH_CHANGED_EVENT,
  managedAppAuthQueryKey
};
