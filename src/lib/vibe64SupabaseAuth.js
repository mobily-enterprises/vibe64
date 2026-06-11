import { createClient } from "@supabase/supabase-js";

function createVibe64SupabaseClient(response = {}) {
  const config = response.supabase || {};
  if (response.ok === false || config.configured !== true || !config.url || !config.publishableKey) {
    throw new Error(response.error || "Supabase auth is not configured.");
  }
  return createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true
    }
  });
}

function passwordResetRedirectTo(browserWindow = window) {
  return `${browserWindow.location.origin}/account?mode=reset-password`;
}

function emailRedirectTo(browserWindow = window) {
  return browserWindow.location.origin;
}

export {
  createVibe64SupabaseClient,
  emailRedirectTo,
  passwordResetRedirectTo
};
