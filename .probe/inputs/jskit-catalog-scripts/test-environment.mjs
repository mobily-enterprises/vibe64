// Tests run as APP_ENV=test: `jskit test` and the browser test servers set it, whatever the shell says, so a test
// never sends real email or payments and the test databases may be prepared. A shell whose APP_ENV is staging or
// production belongs to a staging or production server, and no test runs there.

const STAGING_AND_PRODUCTION = Object.freeze(["staging", "production"]);

/**
 * Sets `env.APP_ENV` to test, or throws, naming the fix, when it says staging or production.
 * @param {Record<string, string | undefined>} env The process environment, changed in place.
 * @param {string} command The command that runs the tests, for the refusal.
 */
function useTestAppEnvironment(env, command) {
  const appEnv = String(env.APP_ENV ?? "").trim();
  if (STAGING_AND_PRODUCTION.includes(appEnv)) {
    throw new Error(
      `${command} runs tests with APP_ENV=test, and APP_ENV is ${appEnv} here: tests never run on a staging or ` +
        "production server. Run them where APP_ENV is unset, development or test."
    );
  }
  env.APP_ENV = "test";
}

export { useTestAppEnvironment };
