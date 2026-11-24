import { prepareTestDatabases } from "@jskit-ai/database-runtime/server/testDatabases";
import knexConfig from "../../knexfile.js";

// The browser run's `prepare` module: `browserTestConfig({ prepare: "tests/e2e/databases.js" })` in
// playwright.config.mjs runs it once, before the servers start. Every Playwright worker gets its own copy of
// BROWSER_TEST_DB_NAME (`<name>`, `<name>_1`, ...), restored from the schema snapshot of the current migrations, then
// seeded; the normal and disposable TEST_DB_NAME databases are refused. It is also given each worker's `baseUrls`,
// for a server setting that names its own address.

/** The fixtures the specs rely on, including any migration-owned baseline rows the app needs. */
async function seed(transaction) {
  await transaction("fixtures").insert({ id: 1, label: "Browser fixture" });
}

export default async function prepareBrowserDatabases({ workers }) {
  const { databases, summary } = await prepareTestDatabases({
    knexConfig,
    environment: process.env,
    variable: "BROWSER_TEST_DB_NAME",
    count: workers,
    seed
  });
  console.log(`[browser-tests] ${summary}.`);
  return databases.map((database) => ({ DB_NAME: database }));
}
