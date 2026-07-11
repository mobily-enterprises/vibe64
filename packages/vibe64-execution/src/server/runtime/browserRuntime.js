import {
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  resolvePlaywrightBrowsersPath
} from "../env/sharedToolEnv.js";

const PLAYWRIGHT_BROWSER_LAUNCH_OK_PATTERN =
  /Playwright browser launched:\s+\/.*(?:\/chrome|\/chrome-headless-shell)\b/u;

function playwrightRuntimeEnv(options = {}) {
  return {
    [PLAYWRIGHT_BROWSERS_PATH_ENV]: resolvePlaywrightBrowsersPath(options)
  };
}

function playwrightBrowserLaunchCheckScript() {
  return [
    "set -euo pipefail",
    `: "\${${PLAYWRIGHT_BROWSERS_PATH_ENV}:?${PLAYWRIGHT_BROWSERS_PATH_ENV} is required}"`,
    `case "$${PLAYWRIGHT_BROWSERS_PATH_ENV}" in`,
    "  /home|/home/*)",
    `    echo "${PLAYWRIGHT_BROWSERS_PATH_ENV} must not resolve under /home: $${PLAYWRIGHT_BROWSERS_PATH_ENV}"`,
    "    exit 1",
    "    ;;",
    "esac",
    `if [ ! -d "$${PLAYWRIGHT_BROWSERS_PATH_ENV}" ]; then`,
    `  echo "Playwright browser runtime does not exist: $${PLAYWRIGHT_BROWSERS_PATH_ENV}"`,
    "  exit 1",
    "fi",
    "if ! command -v playwright >/dev/null 2>&1; then",
    "  echo 'The shared Playwright runtime pack is missing from PATH.'",
    "  exit 1",
    "fi",
    "install_plan=\"$(playwright install --dry-run chromium)\"",
    "expected_chromium=\"$(printf '%s\\n' \"$install_plan\" | sed -n 's/^[[:space:]]*Install location:[[:space:]]*//p' | sed -n '/\\/chromium-[0-9][0-9]*$/p' | head -n 1)\"",
    `case "$expected_chromium" in`,
    `  "$${PLAYWRIGHT_BROWSERS_PATH_ENV}"/chromium-[0-9]*)`,
    "    ;;",
    "  *)",
    `    echo "Playwright did not resolve an expected Chromium revision below $${PLAYWRIGHT_BROWSERS_PATH_ENV}."`,
    "    exit 1",
    "    ;;",
    "esac",
    "browser=\"$(find -H \"$expected_chromium\" -maxdepth 4 -type f -name chrome -print 2>/dev/null | sort | head -n 1 || true)\"",
    "if [ -z \"$browser\" ] || [ ! -x \"$browser\" ]; then",
    `  echo "The Playwright Chromium revision expected at $expected_chromium is not installed."`,
    "  exit 1",
    "fi",
    "missing_libraries=\"$(ldd \"$browser\" 2>/dev/null | grep \"not found\" || true)\"",
    "if [ -n \"$missing_libraries\" ]; then",
    "  printf '%s\\n' \"$missing_libraries\"",
    "  exit 1",
    "fi",
    "if ! browser_output=\"$(timeout 30s \"$browser\" --headless --disable-gpu --no-sandbox --dump-dom 'data:text/html,<title>vibe64-playwright</title><h1>vibe64-playwright-ok</h1>')\"; then",
    "  echo \"Playwright Chromium could not launch: $browser\"",
    "  exit 1",
    "fi",
    "if ! grep -q 'vibe64-playwright-ok' <<< \"$browser_output\"; then",
    "  echo \"Playwright Chromium returned unexpected output: $browser\"",
    "  exit 1",
    "fi",
    "printf 'Playwright browser launched: %s\\n' \"$browser\""
  ].join("\n");
}

function playwrightBrowserLaunchCommandArgs() {
  return [
    "bash",
    "-c",
    playwrightBrowserLaunchCheckScript()
  ];
}

function isValidPlaywrightBrowserLaunchOutput(output = "") {
  const text = String(output || "");
  return PLAYWRIGHT_BROWSER_LAUNCH_OK_PATTERN.test(text) && !/not found/u.test(text);
}

function summarizePlaywrightBrowserLaunchOutput(output = "") {
  const text = String(output || "");
  return text.match(PLAYWRIGHT_BROWSER_LAUNCH_OK_PATTERN)?.[0] || text.trim();
}

export {
  isValidPlaywrightBrowserLaunchOutput,
  playwrightBrowserLaunchCheckScript,
  playwrightBrowserLaunchCommandArgs,
  summarizePlaywrightBrowserLaunchOutput,
  playwrightRuntimeEnv
};
