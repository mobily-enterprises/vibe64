import {
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV,
  resolvePlaywrightBrowsersPath
} from "../env/sharedToolEnv.js";

const PLAYWRIGHT_BROWSER_LAUNCH_OK_PATTERN =
  /Playwright browser launched:\s+\/.*(?:\/chrome|\/chrome-headless-shell)\b/u;
const PLAYWRIGHT_RUNTIME_OK_PATTERN =
  /Playwright runtime ready:\s+Version \d+\.\d+\.\d+;\s+manifest \/[^\r\n]+\/runtime\.env\b/u;

function playwrightRuntimeEnv(options = {}) {
  return {
    [PLAYWRIGHT_BROWSERS_PATH_ENV]: resolvePlaywrightBrowsersPath(options),
    [PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV]: "1"
  };
}

function playwrightRuntimeContractCheckLines() {
  return [
    "set -euo pipefail",
    `: "\${${PLAYWRIGHT_BROWSERS_PATH_ENV}:?${PLAYWRIGHT_BROWSERS_PATH_ENV} is required}"`,
    `case "$${PLAYWRIGHT_BROWSERS_PATH_ENV}" in`,
    "  /home|/home/*)",
    `    echo "${PLAYWRIGHT_BROWSERS_PATH_ENV} must not resolve under /home: $${PLAYWRIGHT_BROWSERS_PATH_ENV}"`,
    "    exit 1",
    "    ;;",
    "  */playwright/browsers)",
    "    ;;",
    "  *)",
    `    echo "${PLAYWRIGHT_BROWSERS_PATH_ENV} must identify the managed playwright/browsers path: $${PLAYWRIGHT_BROWSERS_PATH_ENV}"`,
    "    exit 1",
    "    ;;",
    "esac",
    `playwright_runtime="\${${PLAYWRIGHT_BROWSERS_PATH_ENV}%/browsers}"`,
    "runtime_manifest=\"$playwright_runtime/runtime.env\"",
    "if [ ! -f \"$runtime_manifest\" ]; then",
    "  echo \"Managed Playwright runtime manifest is missing: $runtime_manifest\"",
    "  exit 1",
    "fi",
    "manifest_value() {",
    "  local key=\"$1\"",
    "  local matches",
    "  matches=\"$(sed -n \"s/^${key}=//p\" \"$runtime_manifest\")\"",
    "  if [ -z \"$matches\" ] || [ \"$(printf '%s\\n' \"$matches\" | wc -l)\" -ne 1 ]; then",
    "    printf 'Managed Playwright runtime manifest must declare exactly one %s: %s\\n' \"$key\" \"$runtime_manifest\" >&2",
    "    exit 1",
    "  fi",
    "  printf '%s\\n' \"$matches\"",
    "}",
    "expected_playwright_version=\"$(manifest_value playwright_version)\"",
    "expected_chromium_revision=\"$(manifest_value chromium_revision)\"",
    "expected_chromium_version=\"$(manifest_value chromium_version)\"",
    "expected_ffmpeg_revision=\"$(manifest_value ffmpeg_revision)\"",
    "release_contract_sha256=\"$(manifest_value release_contract_sha256)\"",
    "runtime_store_path=\"$(manifest_value runtime_store_path)\"",
    "browsers_store_path=\"$(manifest_value browsers_store_path)\"",
    "if ! [[ \"$expected_playwright_version\" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then",
    "  echo \"Managed Playwright runtime manifest has an invalid Playwright version: $runtime_manifest\"",
    "  exit 1",
    "fi",
    "if ! [[ \"$expected_chromium_revision\" =~ ^[0-9]+$ ]]; then",
    "  echo \"Managed Playwright runtime manifest has an invalid Chromium revision: $runtime_manifest\"",
    "  exit 1",
    "fi",
    "if ! [[ \"$expected_chromium_version\" =~ ^[0-9]+(\\.[0-9]+){2,3}$ ]]; then",
    "  echo \"Managed Playwright runtime manifest has an invalid Chromium version: $runtime_manifest\"",
    "  exit 1",
    "fi",
    "if ! [[ \"$expected_ffmpeg_revision\" =~ ^[0-9]+$ ]]; then",
    "  echo \"Managed Playwright runtime manifest has an invalid ffmpeg revision: $runtime_manifest\"",
    "  exit 1",
    "fi",
    "if ! [[ \"$release_contract_sha256\" =~ ^[0-9a-f]{64}$ ]]; then",
    "  echo \"Managed Playwright runtime manifest has an invalid release contract hash: $runtime_manifest\"",
    "  exit 1",
    "fi",
    "case \"$runtime_store_path\" in /*) ;; *) echo \"Managed Playwright runtime store path is invalid: $runtime_store_path\"; exit 1 ;; esac",
    "case \"$browsers_store_path\" in /*) ;; *) echo \"Managed Playwright browser store path is invalid: $browsers_store_path\"; exit 1 ;; esac",
    "resolved_runtime_store=\"$(readlink -f \"$playwright_runtime/runtime\" 2>/dev/null || true)\"",
    "resolved_browsers_store=\"$(readlink -f \"$PLAYWRIGHT_BROWSERS_PATH\" 2>/dev/null || true)\"",
    "if [ \"$resolved_runtime_store\" != \"$runtime_store_path\" ]; then",
    "  printf 'Managed Playwright runtime store mismatch: expected %s, observed %s.\\n' \"$runtime_store_path\" \"${resolved_runtime_store:-missing}\"",
    "  exit 1",
    "fi",
    "if [ \"$resolved_browsers_store\" != \"$browsers_store_path\" ]; then",
    "  printf 'Managed Playwright browser store mismatch: expected %s, observed %s.\\n' \"$browsers_store_path\" \"${resolved_browsers_store:-missing}\"",
    "  exit 1",
    "fi",
    "managed_playwright=\"$playwright_runtime/bin/playwright\"",
    "if [ ! -x \"$managed_playwright\" ]; then",
    "  echo \"Managed Playwright CLI is missing: $managed_playwright\"",
    "  exit 1",
    "fi",
    "playwright_output=\"$(\"$managed_playwright\" --version 2>&1 || true)\"",
    "observed_playwright_version=\"$(printf '%s\\n' \"$playwright_output\" | sed -n 's/^Version[[:space:]]*//p' | sed 's/[[:space:]]*$//' | head -n 1)\"",
    "if [ \"$observed_playwright_version\" != \"$expected_playwright_version\" ]; then",
    "  printf 'Managed Playwright version mismatch: expected %s, observed %s.\\n' \"$expected_playwright_version\" \"${observed_playwright_version:-missing}\"",
    "  exit 1",
    "fi"
  ];
}

function playwrightRuntimeVersionCheckScript() {
  return [
    ...playwrightRuntimeContractCheckLines(),
    "printf 'Playwright runtime ready: Version %s; manifest %s\\n' \"$expected_playwright_version\" \"$runtime_manifest\""
  ].join("\n");
}

function playwrightRuntimeVersionCommandArgs() {
  return [
    "bash",
    "-c",
    playwrightRuntimeVersionCheckScript()
  ];
}

function playwrightBrowserLaunchCheckScript() {
  return [
    ...playwrightRuntimeContractCheckLines(),
    `expected_chromium="$${PLAYWRIGHT_BROWSERS_PATH_ENV}/chromium-$expected_chromium_revision"`,
    "browser=\"$(find -H \"$expected_chromium\" -maxdepth 4 -type f -name chrome -print 2>/dev/null | sort | head -n 1 || true)\"",
    "if [ -z \"$browser\" ] || [ ! -x \"$browser\" ]; then",
    `  echo "The Playwright Chromium revision expected at $expected_chromium is not installed."`,
    "  exit 1",
    "fi",
    `headless_shell="$(find -H "$${PLAYWRIGHT_BROWSERS_PATH_ENV}/chromium_headless_shell-$expected_chromium_revision" -maxdepth 4 -type f \\( -name headless_shell -o -name chrome-headless-shell \\) -print 2>/dev/null | sort | head -n 1 || true)"`,
    "if [ -z \"$headless_shell\" ] || [ ! -x \"$headless_shell\" ]; then",
    "  echo 'The matching Playwright Chromium headless shell is not installed.'",
    "  exit 1",
    "fi",
    `expected_ffmpeg="$${PLAYWRIGHT_BROWSERS_PATH_ENV}/ffmpeg-$expected_ffmpeg_revision"`,
    "if [ ! -e \"$expected_ffmpeg\" ]; then",
    "  echo \"The matching Playwright ffmpeg revision is not installed: $expected_ffmpeg\"",
    "  exit 1",
    "fi",
    "reported_chromium_version() {",
    "  local executable=\"$1\"",
    "  local output",
    "  output=\"$(\"$executable\" --version 2>/dev/null || true)\"",
    "  awk '/^(Chromium|Google Chrome)[[:space:]]+/ && !version { version = $NF } END { if (version) print version }' <<< \"$output\"",
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

function isValidPlaywrightRuntimeOutput(output = "") {
  const text = String(output || "");
  return PLAYWRIGHT_RUNTIME_OK_PATTERN.test(text) && !/\b(?:invalid|mismatch|missing|not found)\b/iu.test(text);
}

function summarizePlaywrightBrowserLaunchOutput(output = "") {
  const text = String(output || "");
  return text.match(PLAYWRIGHT_BROWSER_LAUNCH_OK_PATTERN)?.[0] || text.trim();
}

function summarizePlaywrightRuntimeOutput(output = "") {
  const text = String(output || "");
  return text.match(PLAYWRIGHT_RUNTIME_OK_PATTERN)?.[0] || text.trim();
}

export {
  isValidPlaywrightBrowserLaunchOutput,
  isValidPlaywrightRuntimeOutput,
  playwrightBrowserLaunchCheckScript,
  playwrightBrowserLaunchCommandArgs,
  playwrightRuntimeVersionCheckScript,
  playwrightRuntimeVersionCommandArgs,
  summarizePlaywrightBrowserLaunchOutput,
  summarizePlaywrightRuntimeOutput,
  playwrightRuntimeEnv
};
