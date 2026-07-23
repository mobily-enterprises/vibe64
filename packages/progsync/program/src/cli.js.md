# ProgSync command-line interface

Turns command arguments into the public ProgSync library operations and renders
their results for people or tools.

## Uses

- [`synchronizeFile()`](@/src/index.js.md#synchronizefile)
- [`syncChanged()`](@/src/index.js.md#syncchanged)
- [`statusFile()`](@/src/index.js.md#statusfile)
- [`checkProgram()`](@/src/index.js.md#checkprogram)
- [`readProgramAuthorPrompt()`](@/src/index.js.md#readprogramauthorprompt)
- [`process`](package:npm/node:process#default) supplies default arguments, current directory, output streams, and the process environment.

## Provides

### `runCli()`

#### Parameters

* `argv`: an optional ordered list of command arguments defaulting to the current process arguments after the executable and script

#### What it does

1. With no arguments, `help`, `--help`, or `-h`, it writes usage whose bare-path
   form is exactly `progsync <program-or-implementation>` and which also covers
   `status`; compatibility commands `import`, `compile`, and `sync`; `sync
   --changed`; `check`; `author-prompt`; and the supported options. It then
   succeeds without requiring a project.
2. It accepts at most one module path and recognizes `--project-root <path>`,
   defaulting to the current directory; `--base <revision>`; `--dry-run`;
   `--write`; `--json`; and `--changed`. Missing option values, unknown options,
   extra paths, `--write` combined with `--dry-run`, a path combined with
   `--changed`, and options inapplicable to a command fail with stable
   diagnostics that identify the offending argument.
3. A bare path or `sync <path>` calls `synchronizeFile()` with operation `sync`;
   `import <implementation>` calls it with operation `import` and writes only
   when `--write` is present; `compile <Program>` calls it with operation
   `compile`; `sync --changed` calls `syncChanged()`; `status <path>` calls
   `statusFile()`; `check` calls `checkProgram()`; and `author-prompt` calls
   `readProgramAuthorPrompt()`. It passes the exact root, base, and write choice
   derived from arguments.
4. Unless JSON output was requested, it writes discovery and Codex lifecycle
   progress to standard error; candidate diffs, summaries, diagnostics, skipped
   counts, Program-check results, and final pair status to standard output. JSON
   mode emits the complete result on standard output or one structured
   diagnostic on standard error without interleaved prose.
5. It reports success for valid completed and unchanged operations, status `2`
   for blocked synchronization or invalid Program checks, and status `1` for
   argument, environment, or execution failure. It does not throw an expected
   CLI diagnostic past the process boundary.

#### Returns

The numeric process status `0`, `1`, or `2` after all selected output has been
written.
