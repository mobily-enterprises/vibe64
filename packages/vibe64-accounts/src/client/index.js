import AccountsSetup from "./studio/AccountsSetup.vue";
import AIAccountsSetup from "./studio/AIAccountsSetup.vue";
import ManagedAppAuthSetup from "./studio/ManagedAppAuthSetup.vue";
import ManagedAppAuthSetupView from "./studio/ManagedAppAuthSetupView.vue";
import ProviderAccountsSetup from "./studio/ProviderAccountsSetup.vue";
import SmtpLoginSetup from "./studio/SmtpLoginSetup.vue";

export {
  AIAccountsSetup,
  AccountsSetup,
  ManagedAppAuthSetup,
  ManagedAppAuthSetupView,
  ProviderAccountsSetup,
  SmtpLoginSetup
};

export {
  accountRowsForStatus,
  accountsSetupEmits,
  accountsSetupProps,
  useAccountsSetup
} from "./composables/useAccountsSetup.js";
export {
  codexAuthSessionNeedsTerminalAttention,
  useAccountAuthSessions
} from "./composables/useAccountAuthSessions.js";
export {
  useProviderAccountsSetup
} from "./composables/useProviderAccountsSetup.js";
export {
  useManagedAppAuth
} from "./composables/useManagedAppAuth.js";
export {
  useVibe64Accounts
} from "./composables/useVibe64Accounts.js";
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
} from "./lib/managedAppAuthApi.js";
export {
  ACCOUNTS_AUTH_ENDPOINT,
  ACCOUNTS_ENDPOINT,
  ACCOUNTS_GIT_IDENTITY_ENDPOINT,
  ACCOUNTS_LOGOUT_ENDPOINT,
  VIBE64_ACCOUNTS_AUTH_API_SUFFIX,
  VIBE64_ACCOUNTS_GIT_IDENTITY_API_SUFFIX,
  VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT,
  VIBE64_ACCOUNTS_CHANGED_EVENT,
  accountAuthTerminalWebSocketUrl,
  accountsQueryKey
} from "./lib/accountsGateApi.js";
