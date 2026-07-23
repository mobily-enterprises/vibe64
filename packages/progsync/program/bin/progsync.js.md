# ProgSync executable

Exposes the ProgSync command-line interface as the package's executable.

## Uses

- [`runCli()`](@/src/cli.js.md#runcli)
- [`process`](package:npm/node:process#default) supplies the process exit status.

## Provides

### `progsync`

#### Parameters

No parameters.

#### What it does

It passes the current process command arguments to `runCli()` and, after that
operation finishes, assigns its returned numeric status to the process exit
status. A rejected unexpected failure terminates the command unsuccessfully.

#### Returns

No direct value; the process exits with the status returned by `runCli()`.
