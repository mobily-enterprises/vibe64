# Project language tools

Preparation and Preview run the commands declared by the project. Those commands
name their required runtimes: `nodejs`, `php`, `composer`, `python`, `ruby`, `go`,
`java`, `kotlin`, `csharp`, `rust`, `cpp` or `shell`. Database CLI requirements
use `mysql`/`mariadb`, `postgresql` or `sqlite`; selecting a CLI does not create a
database or run a migration.

Managed hosts supply the selected pinned runtime packs. Standalone Vibe64 can
use the developer's installed tools through its ordinary PATH and does not
require a hosted Nix installation. Kotlin includes the Java toolchain on managed
hosts; Rust includes the native linker tools. Projects needing native
extensions or Go C integration also declare their required build toolchain.
JSKIT, Vue and Laravel use the tools specified by their project commands rather
than a separate framework runtime.

If **Preparing workspace** fails, expand its output, correct the reported cause
and choose **Retry**. If Preview cannot start, use **Show run output**. On mobile,
open **Show project** first. A missing runtime needs installation by the host
administrator; changing the declaration to `shell` does not supply the missing
tool. Standalone users install/configure the missing tool in their own environment
and retry the project command.

Connected development uses the same runtime requirements. Having a compiler or
interpreter installed does not prove that the project consumes the selected
library: the project's declared verification must demonstrate that. Normal
release inputs and unrelated sessions keep their own source selection.

Colleague can explain preparation errors and offer its supported status/retry
actions. These instructions do not give it shell access or permission to install
host software. The coding agent can repair project commands after being asked.
