import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileExists, toPosixPath } from "./files.mjs";

// The test-run part of plain `jskit check`: every test run uses the machine's test budget, so a suite neither runs one
// file at a time nor overwhelms the machine. A package script runs node's test runner through `jskit test`, passes no
// fixed worker count, and the Playwright and Vitest configs its scripts use set their workers from testConcurrency().
// The one exception is a test file's own first line, `// jskit-test: alone - <reason>`, which `jskit test` honours.
// A Playwright config those scripts use bounds its whole run (globalTimeout) and, when it starts the app (webServer),
// does so through browserTestConfig(): the production build, and a server, port and database for each worker.

const GUIDE = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#test-files-run-in-parallel";
const BUDGET_MODULE = "@jskit-ai/jskit-catalog/test-budget";
const BROWSER_TESTS_MODULE = "@jskit-ai/jskit-catalog/browser-tests";
// `npm run develop`, `npm run dev[:surface]`, `node ./bin/develop.js`, `vite` and `vite dev`/`vite serve`: not
// `vite build` or `vite preview`.
const DEVELOPMENT_SERVER = /\bnpm\s+run\s+(?:develop|dev(?::[\w-]+)?)(?:\s|$)|\bbin\/develop\.js\b|(?:^|[\s/])vite(?:\s+(?:dev|serve)\b|\s+-|\s*$)/u;
const PINNED_BUDGET = /^(?:V64_TEST_CONCURRENCY|PLAYWRIGHT_WORKERS)=/u;
const CONFIG_EXTENSIONS = Object.freeze(["ts", "mts", "cts", "js", "mjs", "cjs"]);
const SCRIPT_FILE = /\.(?:[cm]?[jt]s|jsx|tsx)$/u;
const FIXED_PLAYWRIGHT_WORKERS = /^(?:--workers(?:=.*)?|-j.*)$/u;
const FIXED_VITEST_WORKERS = /^--(?:max-?[wW]orkers|min-?[wW]orkers|no-file-?[pP]arallelism|file-?[pP]arallelism)(?:=.*)?$/u;

function commandsOf(script) {
  return String(script || "")
    .split(/&&|\|\||[;|\n]/u)
    .map((command) => command.trim().split(/\s+/u).map((token) => token.replace(/^['"(]+|['")]+$/gu, "")).filter(Boolean))
    .filter((tokens) => tokens.length > 0);
}

const isProgram = (token, name) => token === name || token.endsWith(`/${name}`);

// node's own options come before its script; --test among them runs the test runner.
function runsNodeTest(tokens) {
  return tokens.some((token, index) => {
    if (!isProgram(token, "node")) return false;
    for (const option of tokens.slice(index + 1)) {
      if (option === "--test") return true;
      if (SCRIPT_FILE.test(option)) return false;
    }
    return false;
  });
}

function runnerArguments(tokens, runner) {
  const index = tokens.findIndex((token, position) => isProgram(token, runner) &&
    (runner !== "playwright" || tokens[position + 1] === "test"));
  return index < 0 ? null : tokens.slice(index + 1);
}

function configOption(args) {
  const index = args.findIndex((token) => token === "--config" || token === "-c" || token.startsWith("--config="));
  if (index < 0) return "";
  return args[index].startsWith("--config=") ? args[index].slice("--config=".length) : args[index + 1] || "";
}

function lineOf(contents, needle, after = "") {
  const text = String(contents);
  const offset = text.indexOf(needle, after ? Math.max(0, text.indexOf(after)) : 0);
  return offset < 0 ? 1 : text.slice(0, offset).split("\n").length;
}

async function findConfig(directory, explicit, names) {
  if (explicit) return path.resolve(directory, explicit);
  for (const name of names) {
    for (const extension of CONFIG_EXTENSIONS) {
      const candidate = path.join(directory, `${name}.config.${extension}`);
      if (await fileExists(candidate)) return candidate;
    }
  }
  return "";
}

const RUNNERS = Object.freeze({
  playwright: {
    rule: "test/playwright-workers",
    configNames: ["playwright"],
    setting: "workers",
    fixedArgument: FIXED_PLAYWRIGHT_WORKERS
  },
  vitest: {
    rule: "test/vitest-workers",
    configNames: ["vitest", "vite"],
    setting: "maxWorkers",
    fixedArgument: FIXED_VITEST_WORKERS
  }
});

// The browser-test harness: one production-build server, port and database per Playwright worker, its workers from the
// budget and a globalTimeout.
const usesBrowserHarness = (source) => source.includes(BROWSER_TESTS_MODULE) && /\bbrowserTestConfig\s*\(/u.test(source);

// A webServer command that runs the development server instead of the production build.
function developmentServerCommand(source) {
  for (const [, , command] of String(source).matchAll(/\bcommand\s*:\s*(["'`])(.*?)\1/gu)) {
    if (DEVELOPMENT_SERVER.test(command)) return command;
  }
  return "";
}

// A Playwright config tests the production build, gives each worker its own server and data, and bounds the whole run.
function checkPlaywrightIsolation({ file, source, report }) {
  const harness = `use browserTestConfig() from ${BROWSER_TESTS_MODULE}`;
  const command = developmentServerCommand(source);
  if (command) {
    report({ file, line: lineOf(source, command), rule: "test/playwright-dev-server",
      message: `webServer runs the development server (${command}); ${harness}, which serves the production build.` });
  }
  if (usesBrowserHarness(source)) {
    if (/\bglobalTimeout\s*:\s*0\b/u.test(source)) {
      report({ file, line: lineOf(source, "globalTimeout"), rule: "test/playwright-global-timeout",
        message: "globalTimeout: 0 lets a run go on for hours; keep the harness's bound." });
    }
    return;
  }
  if (/\bwebServer\b/u.test(source) && !/\bworkers\s*:\s*1\b/u.test(source)) {
    report({ file, line: lineOf(source, "webServer"), rule: "test/playwright-isolation",
      message: `Playwright workers share one webServer and its database; ${harness}, which gives each worker its own.` });
  }
  if (!/\bglobalTimeout\s*:\s*[1-9]/u.test(source)) {
    report({ file, line: lineOf(source, "globalTimeout"), rule: "test/playwright-global-timeout",
      message: `nothing bounds the whole run; ${harness}, or set a globalTimeout.` });
  }
}

// A config sets the runner's workers from the budget, and Vitest's never turns file parallelism off.
async function checkRunnerConfig({ root, configPath, directory, runner, report }) {
  const { rule, setting, configNames } = RUNNERS[runner];
  const wanted = `set \`${setting}: testConcurrency()\` from ${BUDGET_MODULE}`;
  if (!configPath || !(await fileExists(configPath))) {
    const missing = configPath || path.join(directory, `${configNames[0]}.config.*`);
    report({ file: toPosixPath(path.relative(root, missing)), line: 1, rule,
      message: `A script runs ${runner} without this config: add it and ${wanted}.` });
    return;
  }
  const file = toPosixPath(path.relative(root, configPath));
  const source = await readFile(configPath, "utf8");
  if (runner === "playwright" && usesBrowserHarness(source)) {
    // The harness takes its workers from the budget; a config that sets them itself overrides it.
    if (/\bworkers\s*:/u.test(source)) {
      report({ file, line: lineOf(source, "workers:"), rule,
        message: "playwright's workers are set over browserTestConfig()'s; drop them, so the machine's test budget sets them." });
    }
  } else if (!source.includes(BUDGET_MODULE) || !new RegExp(`\\b${setting}\\s*:\\s*testConcurrency\\(\\s*\\)`, "u").test(source)) {
    report({ file, line: lineOf(source, `${setting}:`), rule, message: `${runner} runs at a fixed or default worker count; ${wanted}.` });
  }
  if (runner === "playwright") checkPlaywrightIsolation({ file, source, report });
  if (runner === "vitest" && /\bfileParallelism\s*:\s*false\b/u.test(source)) {
    report({ file, line: lineOf(source, "fileParallelism"), rule,
      message: "Vitest runs one file at a time; remove fileParallelism: false and isolate the files instead." });
  }
}

/**
 * @param {{ projectRoot: string, manifests: ReadonlyArray<{ absolutePath: string, contents: string, value: object }> }} input
 */
async function checkTestRuns({ projectRoot, manifests }) {
  const root = path.resolve(projectRoot);
  const findings = [];
  const report = (finding) => findings.push(finding);
  const configs = new Map();
  for (const manifest of manifests) {
    const file = toPosixPath(path.relative(root, manifest.absolutePath)) || "package.json";
    const directory = path.dirname(manifest.absolutePath);
    for (const [name, script] of Object.entries(manifest.value?.scripts || {})) {
      const line = lineOf(manifest.contents, `"${name}"`, '"scripts"');
      const at = (rule, message) => report({ file, line, rule, message: `scripts.${name} ${message}` });
      for (const tokens of commandsOf(script)) {
        if (runsNodeTest(tokens)) at("test/node-test", "runs node --test directly; use `jskit test`, which runs test files in parallel within the machine's test budget.");
        if (tokens.some((token) => /^--test-concurrency(?:=|$)/u.test(token))) {
          at("test/fixed-concurrency", "sets --test-concurrency; drop it, so `jskit test` takes the concurrency from the machine's test budget.");
        }
        const pinned = tokens.find((token) => PINNED_BUDGET.test(token));
        if (pinned) {
          at("test/fixed-concurrency", `pins ${pinned.split("=")[0]}; drop it, so the test runner or the machine sets the budget.`);
        }
        for (const runner of Object.keys(RUNNERS)) {
          const args = runnerArguments(tokens, runner);
          if (!args) continue;
          if (args.some((token) => RUNNERS[runner].fixedArgument.test(token))) {
            at(RUNNERS[runner].rule, `passes ${runner} a fixed worker count; drop it, so the config's testConcurrency() sets it.`);
          }
          const configPath = await findConfig(directory, configOption(args), RUNNERS[runner].configNames);
          configs.set(`${runner}\0${configPath || directory}`, { runner, configPath, directory });
        }
      }
    }
  }
  for (const config of configs.values()) await checkRunnerConfig({ root, report, ...config });
  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  return { ok: findings.length < 1, findings, manifests: manifests.length };
}

function formatTestRunsReport(result) {
  const lines = result.findings.flatMap(({ file, line, rule, message }) => [`${file}:${line}  ${rule}  ${message}`, `  ${GUIDE}`]);
  lines.push(result.ok
    ? `JSKIT test runs use the machine's test budget in ${result.manifests} manifest(s).`
    : `JSKIT test runs: ${result.findings.length} error(s). Each test run takes its concurrency from the machine's test budget; ` +
      "a file that must run alone says why on its first line (`// jskit-test: alone - <reason>`).");
  return lines.join("\n");
}

export { checkTestRuns, formatTestRunsReport };
