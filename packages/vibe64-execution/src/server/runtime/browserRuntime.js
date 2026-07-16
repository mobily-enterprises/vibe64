import {
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV,
  resolvePlaywrightBrowsersPath
} from "../env/sharedToolEnv.js";

const PLAYWRIGHT_BROWSER_LAUNCH_OK_PATTERN =
  /Playwright browser launched:\s+\/.*(?:\/chrome|\/chrome-headless-shell)\b/u;

function playwrightRuntimeEnv(options = {}) {
  return {
    [PLAYWRIGHT_BROWSERS_PATH_ENV]: resolvePlaywrightBrowsersPath(options),
    [PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV]: "1"
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
    "expected_chromium_version=\"$(printf '%s\\n' \"$install_plan\" | sed -n 's/^browser:[[:space:]]*chromium[[:space:]]*version[[:space:]]*//p' | head -n 1)\"",
    `case "$expected_chromium" in`,
    `  "$${PLAYWRIGHT_BROWSERS_PATH_ENV}"/chromium-[0-9]*)`,
    "    ;;",
    "  *)",
    `    echo "Playwright did not resolve an expected Chromium revision below $${PLAYWRIGHT_BROWSERS_PATH_ENV}."`,
    "    exit 1",
    "    ;;",
    "esac",
    "if ! [[ \"$expected_chromium_version\" =~ ^[0-9]+(\\.[0-9]+){2,3}$ ]]; then",
    "  echo 'Playwright did not report its expected Chromium version.'",
    "  exit 1",
    "fi",
    "browser=\"$(find -H \"$expected_chromium\" -maxdepth 4 -type f -name chrome -print 2>/dev/null | sort | head -n 1 || true)\"",
    "if [ -z \"$browser\" ] || [ ! -x \"$browser\" ]; then",
    `  echo "The Playwright Chromium revision expected at $expected_chromium is not installed."`,
    "  exit 1",
    "fi",
    "chromium_revision=\"${expected_chromium##*-}\"",
    `headless_shell="$(find -H "$${PLAYWRIGHT_BROWSERS_PATH_ENV}/chromium_headless_shell-$chromium_revision" -maxdepth 4 -type f \\( -name headless_shell -o -name chrome-headless-shell \\) -print 2>/dev/null | sort | head -n 1 || true)"`,
    "if [ -z \"$headless_shell\" ] || [ ! -x \"$headless_shell\" ]; then",
    "  echo 'The matching Playwright Chromium headless shell is not installed.'",
    "  exit 1",
    "fi",
    "reported_chromium_version() {",
    "  local executable=\"$1\"",
    "  \"$executable\" --version 2>/dev/null | sed -n 's/^\\(Chromium\\|Google Chrome\\)[[:space:]]*//p' | sed 's/[[:space:]]*$//' | head -n 1",
    "}",
    "browser_version=\"$(reported_chromium_version \"$browser\")\"",
    "headless_shell_version=\"$(reported_chromium_version \"$headless_shell\")\"",
    "if [ \"$browser_version\" != \"$expected_chromium_version\" ]; then",
    "  printf 'Playwright Chromium version mismatch: expected %s, observed %s.\\n' \"$expected_chromium_version\" \"${browser_version:-missing}\"",
    "  exit 1",
    "fi",
    "if [ \"$headless_shell_version\" != \"$expected_chromium_version\" ]; then",
    "  printf 'Playwright Chromium headless-shell version mismatch: expected %s, observed %s.\\n' \"$expected_chromium_version\" \"${headless_shell_version:-missing}\"",
    "  exit 1",
    "fi",
    "missing_libraries=\"$(ldd \"$browser\" 2>/dev/null | grep \"not found\" || true)\"",
    "if [ -n \"$missing_libraries\" ]; then",
    "  printf '%s\\n' \"$missing_libraries\"",
    "  exit 1",
    "fi",
    "browser_log=\"$(mktemp \"${TMPDIR:-/tmp}/vibe64-playwright-launch.XXXXXX\")\"",
    "cleanup_browser_log() { rm -f \"$browser_log\"; }",
    "trap cleanup_browser_log EXIT",
    "if ! browser_output=\"$(timeout 30s \"$browser\" --headless --disable-gpu --no-sandbox --dump-dom 'data:text/html,<title>vibe64-playwright</title><h1>vibe64-playwright-ok</h1>' 2> \"$browser_log\")\"; then",
    "  sed 's/^/[chromium] /' \"$browser_log\" >&2",
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
