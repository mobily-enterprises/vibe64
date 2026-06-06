import { createClient } from "@supabase/supabase-js";
import {
  readSupabaseConfig
} from "@/lib/vibe64AuthApi.js";

let clientPromise = null;

async function vibe64SupabaseClient() {
  if (!clientPromise) {
    clientPromise = createVibe64SupabaseClient();
  }
  return clientPromise;
}

async function createVibe64SupabaseClient() {
  const response = await readSupabaseConfig();
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
  emailRedirectTo,
  passwordResetRedirectTo,
  vibe64SupabaseClient
};
