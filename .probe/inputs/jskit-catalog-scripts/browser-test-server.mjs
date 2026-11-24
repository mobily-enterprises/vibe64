// `jskit browser-test-server [host] [port]`: the app as a host serves it for a browser test run, such as a Vibe64 Outputs
// target with `Data: test`. It is one worker of a local run (browser-tests.mjs, browser-test-servers.mjs), read from the
// app's own playwright.config.mjs: the production build, the database the app's `prepare` module gives that worker (its
// own copy of BROWSER_TEST_DB_NAME in the database patterns), the test-only `env` and APP_ENV=test, on the host's address
// in place of the run's own port. The host's suite then runs against it as a managed target (PLAYWRIGHT_BASE_URL),
// signed in with the login state its host supplies, so this server signs nothing in. The host and port come from the
// arguments, else HOST and PORT. The app server's output also reaches this command's own; stopping the command stops it.
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { SETTINGS_VARIABLE } from "./browser-tests.mjs";

const CONFIG_FILES = Object.freeze(["playwright.config.mjs", "playwright.config.js"]);

/**
 * Serves the app in `appRoot` as one browser test server, until it is stopped.
 * @param {string[]} args `[host, port]`, either of which may be left to HOST and PORT.
 * @param {Record<string, string | undefined>} [environment] This process's environment, given the run's settings.
 * @param {string} [appRoot]
 */
async function serveBrowserTestTarget(args = [], environment = process.env, appRoot = process.cwd()) {
  if (args.length > 2) throw new Error("Usage: jskit browser-test-server [host] [port]");
  const host = String(args[0] || environment.HOST || "").trim() || "127.0.0.1";
  const port = String(args[1] || environment.PORT || "").trim();
  if (!/^[1-9]\d{0,4}$/u.test(port) || Number(port) > 65_535) {
    throw new Error(`jskit browser-test-server needs the port to serve on, as its second argument or PORT, not ${port || "nothing"}.`);
  }
  // What a local run's config reads for one worker on this port. A suite runner's settings left in a host's environment
  // (its managed target, login state, worker count or index) are not this server's.
  for (const name of ["PLAYWRIGHT_BASE_URL", "PLAYWRIGHT_STORAGE_STATE", "TEST_PARALLEL_INDEX"]) delete environment[name];
  Object.assign(environment, { PLAYWRIGHT_PORT: port, PLAYWRIGHT_WORKERS: "1" });
  const config = CONFIG_FILES.map((name) => path.join(appRoot, name)).find((file) => existsSync(file));
  const loaded = config ? (await import(pathToFileURL(config).href)).default : null;
  const settings = loaded?.webServer?.env?.[SETTINGS_VARIABLE];
  if (!settings) {
    throw new Error(`jskit browser-test-server serves the app as its Playwright config's browserTestConfig() describes, and ` +
      `${config ? path.basename(config) : "playwright.config.mjs"} ${config ? "does not use it" : "is missing"}: export ` +
      "defineConfig(browserTestConfig({ ... })) from @jskit-ai/jskit-catalog/browser-tests there.");
  }
  const served = { ...JSON.parse(settings), host, terminal: true };
  delete served.signIn;
  delete served.signedInStates;
  environment[SETTINGS_VARIABLE] = JSON.stringify(served);
  await import("./browser-test-servers.mjs");
}

export { serveBrowserTestTarget };
