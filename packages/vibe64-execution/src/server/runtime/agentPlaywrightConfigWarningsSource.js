// The managed Playwright wrapper's checks of a project's Playwright config, as script source for
// agentPlaywrightCommandSource.js (its escapes are the script's own; it uses that script's configCode, existsSync,
// readFileSync and path): its warnings about a config that never reads what the host supplies, and the JSKIT harness
// version that gives each worker its own database.
const CONFIG_WARNINGS_SOURCE = `// A run with several app servers needs a config that gives each Playwright worker its own: JSKIT's
// browserTestConfig() does, from PLAYWRIGHT_WORKER_TARGETS. Any other config sends every worker to the first server
// and its database, so they overwrite each other's data.
function warnWhenConfigIgnoresWorkers(applicationRoot = "", workerCount = 1) {
  const configName = ["playwright.config.mjs", "playwright.config.js", "playwright.config.ts", "playwright.config.cjs"]
    .find((name) => existsSync(path.join(applicationRoot, name)));
  if (!configName) {
    return;
  }
  const source = readFileSync(path.join(applicationRoot, configName), "utf8");
  const code = configCode(source);
  const jskitHarness = source.includes("@jskit-ai/jskit-catalog/browser-tests") &&
    /(?<![\\w$.])browserTestConfig\\s*\\(/u.test(code);
  if (!jskitHarness && !/(?<![\\w$])PLAYWRIGHT_WORKER_TARGETS(?![\\w$])/u.test(code)) {
    process.stderr.write(
      "Vibe64 serves " + workerCount + " app servers for this run in PLAYWRIGHT_WORKER_TARGETS, but " + configName +
      " never reads it, so every worker uses the first server and its database. Build the config with JSKIT's " +
      "browserTestConfig(), or run with --workers 1.\\n"
    );
  }
}

// JSKIT's browserTestConfig() gives each Playwright worker of a managed run its own server's environment (its copy of
// the test database) from @jskit-ai/jskit-catalog 0.2.113; an older one gives every worker the first server's, so their
// data would mix. The version that harness has, when it is older, else "".
function jskitHarnessWithoutWorkerDatabases(applicationRoot = "") {
  const configName = ["playwright.config.mjs", "playwright.config.js", "playwright.config.ts", "playwright.config.cjs"]
    .find((name) => existsSync(path.join(applicationRoot, name)));
  if (!configName) {
    return "";
  }
  const source = readFileSync(path.join(applicationRoot, configName), "utf8");
  if (!source.includes("@jskit-ai/jskit-catalog/browser-tests") ||
    !/(?<![\\w$.])browserTestConfig\\s*\\(/u.test(configCode(source))) {
    return "";
  }
  // Node's resolution from the application: its own node_modules, else a parent's.
  for (let directory = path.resolve(applicationRoot); ; directory = path.dirname(directory)) {
    const manifest = path.join(directory, "node_modules", "@jskit-ai", "jskit-catalog", "package.json");
    if (existsSync(manifest)) {
      const version = String(JSON.parse(readFileSync(manifest, "utf8")).version || "");
      const parts = version.split(".").map((part) => Number.parseInt(part, 10));
      const first = [0, 2, 113].findIndex((minimum, index) => parts[index] !== minimum);
      return first >= 0 && parts[first] < [0, 2, 113][first] ? version : "";
    }
    if (path.dirname(directory) === directory) {
      return "";
    }
  }
}

// A config that never reads the supplied login runs every test signed out, which looks like broken
// sign-in; saying which variable to read points at the one-line fix. A config reads it when its code, not a
// comment, names PLAYWRIGHT_STORAGE_STATE, or when JSKIT's browserTestConfig() builds it: that harness passes
// the supplied login to use.storageState itself.
function warnWhenConfigIgnoresLogin(applicationRoot = "") {
  const configName = ["playwright.config.mjs", "playwright.config.js", "playwright.config.ts", "playwright.config.cjs"]
    .find((name) => existsSync(path.join(applicationRoot, name)));
  if (!configName) {
    return;
  }
  const source = readFileSync(path.join(applicationRoot, configName), "utf8");
  const code = configCode(source);
  const namesLogin = /(?<![\\w$])PLAYWRIGHT_STORAGE_STATE(?![\\w$])/u.test(code);
  const jskitHarness = source.includes("@jskit-ai/jskit-catalog/browser-tests") &&
    /(?<![\\w$.])browserTestConfig\\s*\\(/u.test(code);
  if (!namesLogin && !jskitHarness) {
    process.stderr.write(
      "Vibe64 supplies the signed-in browser state in PLAYWRIGHT_STORAGE_STATE, but " + configName +
      " never reads it, so these tests run signed out. Pass process.env.PLAYWRIGHT_STORAGE_STATE to use.storageState there.\\n"
    );
  }
}
`;

export { CONFIG_WARNINGS_SOURCE };
