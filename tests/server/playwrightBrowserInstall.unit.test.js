import assert from "node:assert/strict";
import test from "node:test";

import {
  installPlaywrightBrowsers,
  installPlaywrightCommand,
  main
} from "../../bin/install-playwright-browsers.js";
import {
  PLAYWRIGHT_CHROMIUM_SYSTEM_PACKAGES,
  playwrightSystemDependencyInstallScript
} from "@local/vibe64-execution/server";

test("Playwright browser installer uses shared cache and runtime-pack CLI", () => {
  const script = installPlaywrightCommand();

  assert.match(script, /"\$\(id -u\)" -ne 0/u);
  assert.match(script, /apt-get update/u);
  assert.match(script, /apt-get install -y/u);
  assert.match(script, /libnss3/u);
  assert.match(script, /libgbm1/u);
  assert.match(script, /fonts-noto-color-emoji/u);
  assert.match(script, /install -d -o root -g vibe64 -m 2775 "\$PLAYWRIGHT_BROWSERS_PATH"/u);
  assert.match(script, /playwright install chromium/u);
  assert.match(script, /chgrp -R vibe64 "\$PLAYWRIGHT_BROWSERS_PATH"/u);
  assert.match(script, /find "\$PLAYWRIGHT_BROWSERS_PATH" -type d -exec chmod g\+rx,g\+s/u);
  assert.match(script, /find "\$PLAYWRIGHT_BROWSERS_PATH" -type f -exec chmod g\+rX/u);
  assert.match(script, /node -e/u);
  assert.match(script, /Playwright browser launched/u);
  assert.doesNotMatch(script, /\bnpx\s+playwright\s+install/u);
  assert.doesNotMatch(script, /\/home\/[^"']*\.cache/u);
});

test("Playwright Chromium system dependencies are installed by the shared bootstrap", () => {
  const script = playwrightSystemDependencyInstallScript();

  assert.ok(PLAYWRIGHT_CHROMIUM_SYSTEM_PACKAGES.length > 10);
  assert.ok(PLAYWRIGHT_CHROMIUM_SYSTEM_PACKAGES.includes("libnss3"));
  assert.ok(PLAYWRIGHT_CHROMIUM_SYSTEM_PACKAGES.includes("libgbm1"));
  assert.ok(PLAYWRIGHT_CHROMIUM_SYSTEM_PACKAGES.includes("fonts-noto-color-emoji"));
  assert.match(script, /command -v apt-get/u);
  assert.match(script, /export DEBIAN_FRONTEND=/u);
  assert.match(script, /apt-get update/u);
  assert.match(script, /apt-get install -y/u);
  assert.doesNotMatch(script, /\bnpx\b/u);
});

test("Playwright browser installer runs through the execution gateway", async () => {
  const calls = [];
  const result = await installPlaywrightBrowsers({
    runCommand: async (request) => {
      calls.push(request);
      return {
        exitCode: 0,
        ok: true,
        output: "",
        stderr: "",
        stdout: ""
      };
    },
    stdout: {
      write() {}
    },
    stderr: {
      write() {}
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "bash");
  assert.deepEqual(calls[0].args.slice(0, 1), ["-lc"]);
  assert.equal(calls[0].purpose, "setup");
  assert.equal(calls[0].envPolicy, "deployment");
  assert.deepEqual(calls[0].runtimes, ["node22", "playwright"]);
  assert.doesNotMatch(calls[0].args[1], /\bnpx\s+playwright\s+install/u);
});

test("Playwright browser installer dry-run prints the shared install script", async () => {
  let output = "";
  const exitCode = await main({
    argv: ["--dry-run"],
    stdout: {
      write(value) {
        output += value;
      }
    },
    stderr: {
      write() {}
    }
  });

  assert.equal(exitCode, 0);
  assert.match(output, /PLAYWRIGHT_BROWSERS_PATH="\$VIBE64_SHARED_CACHE_ROOT\/playwright"/u);
  assert.match(output, /playwright install chromium/u);
  assert.doesNotMatch(output, /\bnpx\s+playwright\s+install/u);
});
