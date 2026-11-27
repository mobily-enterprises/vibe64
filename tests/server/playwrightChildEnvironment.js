// Playwright's and JSKIT's browser-test settings: whatever a test host's lane or an outer suite exported, such as
// PLAYWRIGHT_PORT or PLAYWRIGHT_WORKER_TARGETS, which JSKIT's harness (0.2.113 and later) reads as the managed run's own.
const PLAYWRIGHT_SETTING = /^(?:PLAYWRIGHT_|JSKIT_BROWSER_)/u;

/**
 * The environment of a child a test starts that runs Playwright, or a wrapper or fixture that does: this process's
 * without any Playwright or JSKIT browser-test setting, except the browsers it may use, and then the child's own.
 * @param {Record<string, string>} [own] what the child needs, such as a prepared command's env with its own
 *   PLAYWRIGHT_BASE_URL or PLAYWRIGHT_STORAGE_STATE; it wins over everything else
 * @param {Record<string, string | undefined>} [parent] the environment it starts from: this process's
 * @returns {Record<string, string | undefined>}
 */
function playwrightChildEnvironment(own = {}, parent = process.env) {
  const kept = Object.fromEntries(Object.entries(parent).filter(([name]) => !PLAYWRIGHT_SETTING.test(name)));
  return {
    ...kept,
    ...(parent.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: parent.PLAYWRIGHT_BROWSERS_PATH } : {}),
    ...own
  };
}

export { playwrightChildEnvironment };
