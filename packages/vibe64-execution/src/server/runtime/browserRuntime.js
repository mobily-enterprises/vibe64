import {
  sharedToolEnvShellExportLines,
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  resolvePlaywrightBrowsersPath
} from "../env/sharedToolEnv.js";

const PLAYWRIGHT_BROWSER_LAUNCH_OK_PATTERN =
  /Playwright browser launched:\s+\/.*(?:\/chrome|\/chrome-headless-shell)\b/u;
const PLAYWRIGHT_CHROMIUM_SYSTEM_PACKAGES = Object.freeze([
  "fonts-liberation",
  "fonts-noto-color-emoji",
  "libasound2t64",
  "libatk-bridge2.0-0",
  "libatk1.0-0",
  "libatspi2.0-0",
  "libcairo2",
  "libcups2",
  "libdrm2",
  "libfontconfig1",
  "libgbm1",
  "libnspr4",
  "libnss3",
  "libpango-1.0-0",
  "libx11-xcb1",
  "libxcb1",
  "libxcomposite1",
  "libxdamage1",
  "libxext6",
  "libxfixes3",
  "libxkbcommon0",
  "libxrandr2",
  "libxshmfence1"
]);

function playwrightRuntimeEnv(options = {}) {
  return {
    [PLAYWRIGHT_BROWSERS_PATH_ENV]: resolvePlaywrightBrowsersPath(options)
  };
}

function playwrightExecutableCheckScript() {
  return "const packageName = 'play' + 'wright'; const { chromium } = require(packageName); console.log(chromium.executablePath());";
}

function playwrightSystemDependencyInstallScript() {
  return [
    "if ! command -v apt-get >/dev/null 2>&1; then",
    "  echo 'apt-get is required to install Playwright Chromium system dependencies on this host.' >&2",
    "  exit 1",
    "fi",
    "export DEBIAN_FRONTEND=\"${DEBIAN_FRONTEND:-noninteractive}\"",
    "apt-get update",
    `apt-get install -y ${PLAYWRIGHT_CHROMIUM_SYSTEM_PACKAGES.join(" ")}`
  ].join("\n");
}

function playwrightBrowserInstallScript() {
  return [
    "set -euo pipefail",
    "if [ \"$(id -u)\" -ne 0 ]; then",
    "  echo 'Run the shared Playwright browser installer as root.' >&2",
    "  exit 1",
    "fi",
    ...sharedToolEnvShellExportLines(),
    `case "$${PLAYWRIGHT_BROWSERS_PATH_ENV}" in`,
    "  /home|/home/*)",
    `    echo "${PLAYWRIGHT_BROWSERS_PATH_ENV} must not resolve under /home: $${PLAYWRIGHT_BROWSERS_PATH_ENV}"`,
    "    exit 1",
    "    ;;",
    "esac",
    playwrightSystemDependencyInstallScript(),
    `install -d -o root -g vibe64 -m 2775 "$${PLAYWRIGHT_BROWSERS_PATH_ENV}"`,
    "if ! command -v playwright >/dev/null 2>&1; then",
    "  echo 'The shared Playwright runtime pack is required on PATH.'",
    "  exit 1",
    "fi",
    "playwright install chromium",
    `chgrp -R vibe64 "$${PLAYWRIGHT_BROWSERS_PATH_ENV}"`,
    `find "$${PLAYWRIGHT_BROWSERS_PATH_ENV}" -type d -exec chmod g+rx,g+s {} +`,
    `find "$${PLAYWRIGHT_BROWSERS_PATH_ENV}" -type f -exec chmod g+rX {} +`,
    `node -e ${JSON.stringify(playwrightExecutableCheckScript())}`,
    playwrightBrowserLaunchCheckScript()
  ].join("\n");
}

function playwrightBrowserInstallCommandArgs() {
  return [
    "bash",
    "-lc",
    playwrightBrowserInstallScript()
  ];
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
    `  echo "Playwright browser cache does not exist: $${PLAYWRIGHT_BROWSERS_PATH_ENV}"`,
    "  exit 1",
    "fi",
    "browser=\"$(find \"$PLAYWRIGHT_BROWSERS_PATH\" -maxdepth 5 -type f \\( -name chrome-headless-shell -o -name chrome \\) -print 2>/dev/null | sort | head -n 1 || true)\"",
    "if [ -z \"$browser\" ]; then",
    `  echo "No Playwright Chromium browser was found below $${PLAYWRIGHT_BROWSERS_PATH_ENV}."`,
    "  exit 1",
    "fi",
    "if ldd \"$browser\" 2>/dev/null | grep -q \"not found\"; then",
    "  ldd \"$browser\" | grep \"not found\"",
    "  exit 1",
    "fi",
    "\"$browser\" --headless --disable-gpu --no-sandbox --dump-dom 'data:text/html,<title>vibe64-playwright</title><h1>vibe64-playwright-ok</h1>' | grep -q 'vibe64-playwright-ok'",
    "printf 'Playwright browser launched: %s\\n' \"$browser\""
  ].join("\n");
}

function playwrightBrowserLaunchCommandArgs() {
  return [
    "bash",
    "-lc",
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
  PLAYWRIGHT_CHROMIUM_SYSTEM_PACKAGES,
  playwrightBrowserInstallCommandArgs,
  playwrightBrowserInstallScript,
  playwrightBrowserLaunchCheckScript,
  playwrightBrowserLaunchCommandArgs,
  playwrightExecutableCheckScript,
  summarizePlaywrightBrowserLaunchOutput,
  playwrightSystemDependencyInstallScript,
  playwrightRuntimeEnv
};
