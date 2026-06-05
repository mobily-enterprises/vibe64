import { inject } from "vue";

const VIBE64_APP_AUTH_KEY = Symbol("vibe64-app-auth");

function useVibe64AppAuth() {
  return inject(VIBE64_APP_AUTH_KEY, null);
}

export {
  VIBE64_APP_AUTH_KEY,
  useVibe64AppAuth
};
