import process from "node:process";

import { asDiagnostic, ProgSyncError } from "./errors.js";
import {
  checkProgram,
  compileProgram,
  importProgram,
  syncChanged,
  syncFile,
  statusFile
} from "./service.js";

const HELP = `ProgSync keeps Program and managed implementation synchronized.

Usage:
  progsync <program-or-implementation> [--dry-run]
  progsync status <program-or-implementation>
  progsync import <implementation> [--write]
  progsync compile <program> [--dry-run]
  progsync sync <program-or-implementation> [--dry-run]
  progsync sync --changed [--dry-run]
  progsync check

Options:
  --project-root <path>  Project root (defaults to current directory)
  --base <revision>      Explicit Git baseline (normally private accepted state, then HEAD)
  --write                Apply an import proposal
  --dry-run              Produce a candidate diff without applying it
  --json                 Emit machine-readable JSON
  --help                 Show this help
`;

const COMMANDS = new Set(["check", "compile", "help", "import", "status", "sync"]);

function optionValue(option, args) {
  const value = args.shift();
  if (!value || value.startsWith("--")) {
    throw new ProgSyncError(
      "OPTION_VALUE_REQUIRED",
      `${option} requires a value.`
    );
  }
  return value;
}

function rejectOption(condition, option, command) {
  if (condition) {
    throw new ProgSyncError(
      "OPTION_NOT_APPLICABLE",
      `${option} is not valid with ${command}.`
    );
  }
}

function validateCommandOptions(command, options) {
  if (command === "help") {
    rejectOption(Boolean(options.path), "a path", command);
    rejectOption(options.changed, "--changed", command);
    return;
  }
  if (command === "check") {
    rejectOption(Boolean(options.path), "a path", command);
    rejectOption(options.changed, "--changed", command);
    rejectOption(options.dryRun, "--dry-run", command);
    rejectOption(options.write, "--write", command);
    rejectOption(Boolean(options.base), "--base", command);
    return;
  }
  if (command === "status") {
    rejectOption(options.changed, "--changed", command);
    rejectOption(options.dryRun, "--dry-run", command);
    rejectOption(options.write, "--write", command);
    return;
  }
  if (command === "import") {
    rejectOption(options.changed, "--changed", command);
    return;
  }
  if (command === "compile") {
    rejectOption(options.changed, "--changed", command);
    rejectOption(options.write, "--write", command);
    return;
  }
  rejectOption(options.write, "--write", command);
  if (options.changed && options.path) {
    throw new ProgSyncError(
      "CONFLICTING_TARGETS",
      "sync accepts either one module path or --changed, not both."
    );
  }
}

function parseArguments(argv) {
  const args = [...argv];
  const first = args[0] || "help";
  let command = "sync";
  if (first === "--help" || first === "-h") {
    args.shift();
    command = "help";
  } else if (COMMANDS.has(first)) {
    args.shift();
    command = first;
  } else if (argv.length === 0) {
    args.shift();
    command = "help";
  }
  const options = {
    base: undefined,
    changed: false,
    dryRun: false,
    help: command === "help",
    json: false,
    path: null,
    projectRoot: process.cwd(),
    write: false
  };
  while (args.length > 0) {
    const argument = args.shift();
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--write") {
      options.write = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--changed") {
      options.changed = true;
    } else if (argument === "--project-root") {
      options.projectRoot = optionValue(argument, args);
    } else if (argument === "--base") {
      options.base = optionValue(argument, args);
    } else if (argument?.startsWith("-")) {
      throw new ProgSyncError("UNKNOWN_OPTION", `Unknown option: ${argument}`);
    } else if (!options.path) {
      options.path = argument;
    } else {
      throw new ProgSyncError("TOO_MANY_PATHS", "ProgSync accepts one module path at a time.");
    }
  }
  if (options.write && options.dryRun) {
    throw new ProgSyncError("CONFLICTING_OPTIONS", "--write and --dry-run cannot be combined.");
  }
  validateCommandOptions(command, options);
  return { command, options };
}

function eventReporter(json) {
  if (json) {
    return undefined;
  }
  return (event) => {
    if (event.type === "progsync.discovery") {
      process.stderr.write(`ProgSync: ${event.message}\n`);
      return;
    }
    if (event.type === "runner.stderr") {
      return;
    }
    if (event.type === "turn.started") {
      process.stderr.write("ProgSync: Codex synchronization started.\n");
    }
    if (event.type === "turn.completed") {
      process.stderr.write("ProgSync: Codex synchronization completed.\n");
      return;
    }
    if (event.type === "progsync.candidate_rejected") {
      process.stderr.write(
        `ProgSync: candidate ${event.attempt} rejected (${event.diagnostic.code}); retrying once.\n`
      );
    }
  };
}

function printStatusResult(result) {
  for (const record of result.discovery) {
    process.stdout.write(`ProgSync: ${record.message}\n`);
  }
  process.stdout.write(
    result.reconciled
      ? "ProgSync status: synchronized; no translation is required.\n"
      : `ProgSync status: pending ${result.mode}.\n`
  );
}

function printSingleResult(result) {
  if (result.diff) {
    process.stdout.write(result.diff);
    if (!result.diff.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  process.stdout.write(
    `ProgSync ${result.status}: ${result.pair.programPath} ↔ ${result.pair.implementationPath}\n`
  );
  if (result.report.summary) {
    process.stdout.write(`${result.report.summary}\n`);
  }
  for (const diagnostic of result.report.diagnostics || []) {
    process.stdout.write(`- ${diagnostic}\n`);
  }
  if (!result.applied && result.status === "updated") {
    process.stdout.write("Dry run: no project files were changed.\n");
  }
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (Array.isArray(result.results)) {
    for (const item of result.results) {
      printSingleResult(item);
    }
    if (result.results.length === 0) {
      process.stdout.write("ProgSync unchanged: no changed supported module pairs.\n");
    }
    if (result.skippedPaths.length > 0) {
      process.stdout.write(`Skipped ${result.skippedPaths.length} unrelated or unsupported changed paths.\n`);
    }
    return;
  }
  if (Array.isArray(result.files)) {
    for (const file of result.files) {
      for (const diagnostic of file.diagnostics) {
        process.stdout.write(`${file.programPath}: ${diagnostic.message || diagnostic.code}\n`);
      }
    }
    process.stdout.write(`Program check: ${result.status} (${result.files.length} files).\n`);
    return;
  }
  if (Object.hasOwn(result, "reconciled")) {
    printStatusResult(result);
    return;
  }
  printSingleResult(result);
}

async function runCli(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArguments(argv);
    const { command, options } = parsed;
    if (options.help) {
      process.stdout.write(HELP);
      return 0;
    }
    const shared = {
      base: options.base,
      onEvent: eventReporter(options.json),
      projectRoot: options.projectRoot
    };
    let result;
    if (command === "import") {
      if (!options.path) {
        throw new ProgSyncError("PATH_REQUIRED", "import requires an implementation path.");
      }
      result = await importProgram({
        ...shared,
        inputPath: options.path,
        write: options.write
      });
    } else if (command === "compile") {
      if (!options.path) {
        throw new ProgSyncError("PATH_REQUIRED", "compile requires a Program path.");
      }
      result = await compileProgram({
        ...shared,
        inputPath: options.path,
        write: !options.dryRun
      });
    } else if (command === "sync") {
      if (options.changed) {
        result = await syncChanged({
          ...shared,
          write: !options.dryRun
        });
      } else {
        if (!options.path) {
          throw new ProgSyncError("PATH_REQUIRED", "sync requires a path or --changed.");
        }
        result = await syncFile({
          ...shared,
          inputPath: options.path,
          write: !options.dryRun
        });
      }
    } else if (command === "check") {
      result = await checkProgram({ projectRoot: options.projectRoot });
    } else if (command === "status") {
      if (!options.path) {
        throw new ProgSyncError("PATH_REQUIRED", "status requires a module path.");
      }
      result = await statusFile({
        base: options.base,
        inputPath: options.path,
        projectRoot: options.projectRoot
      });
    } else {
      throw new ProgSyncError("UNKNOWN_COMMAND", `Unknown command: ${command}`);
    }
    printResult(result, options.json);
    return result.status === "blocked" || result.status === "invalid" ? 2 : 0;
  } catch (error) {
    const diagnostic = asDiagnostic(error);
    if (parsed?.options?.json) {
      process.stderr.write(`${JSON.stringify({ status: "error", diagnostic }, null, 2)}\n`);
    } else {
      process.stderr.write(`ProgSync error [${diagnostic.code}]: ${diagnostic.message}\n`);
      if (diagnostic.details?.diagnostics) {
        for (const item of diagnostic.details.diagnostics) {
          process.stderr.write(`- line ${item.line || "?"}: ${item.message}\n`);
        }
      }
    }
    return 1;
  }
}

export {
  HELP,
  parseArguments,
  runCli
};
