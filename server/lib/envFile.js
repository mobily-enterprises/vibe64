import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", ".env");

// The app root's .env is loaded into process.env, which every caller shares, at most once per process.
let loaded = false;

/**
 * Loads the app root's .env into process.env once per process; a missing file
 * is not an error.
 */
function loadEnvFile() {
  if (loaded) return;
  try {
    process.loadEnvFile(APP_ENV_FILE);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  loaded = true;
}

export { loadEnvFile };
