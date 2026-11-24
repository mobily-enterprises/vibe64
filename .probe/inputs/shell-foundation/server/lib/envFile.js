// .env is loaded into process.env, which every caller shares, at most once per process.
let loaded = false;

/** Loads .env into process.env once per process; a missing file is not an error. */
function loadEnvFile() {
  if (loaded) {
    return;
  }
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  loaded = true;
}

export { loadEnvFile };
