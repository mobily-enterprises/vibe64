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
JSKIT, Vue, Laravel, Django, Rails, Spring Boot, Express and Next.js use the
tools specified by their project commands rather than a separate framework
runtime: Django uses `python`, Rails uses `ruby` with `cpp` for native gems (and
`nodejs` when the app has a `package.json`), Spring Boot uses `java` through the
project's Maven wrapper, and Express and Next.js use `nodejs`. New-project
onboarding does not offer PostgreSQL variants yet (for example
`django-postgresql`); it offers the MySQL or SQLite variant instead.

If **Preparing workspace** fails, expand its output, correct the reported cause
and choose **Retry**. On your own computer, the panel also lists the tools that
step uses: each one that runs shows its version and where it was found; one that
is missing or didn't start shows one sentence, the install command for this
computer with a copy button, **Check again** and **Other ways**. Language
runtimes install with mise (`mise use -g ruby@3.4`, `mise use -g python@3.13`,
`mise use -g java@temurin-25`), which needs no administrator password; build
tools and libraries for native packages (`cpp`) use `sudo apt install …` on
Debian/Ubuntu or `brew install …` on macOS. Coming back to the tab checks again. If Preview cannot start, use **Show run output**. On mobile,
open **Show project** first. A missing runtime needs installation by the host
administrator; changing the declaration to `shell` does not supply the missing
tool. Standalone users install/configure the missing tool in their own environment
and retry the project command.

Connected development uses the same runtime requirements. Having a compiler or
interpreter installed does not prove that the project consumes the selected
library: the project's declared verification must demonstrate that. Normal
release inputs and unrelated sessions keep their own source selection.

When a runtime is missing, the coding agent stops and says which one, pointing
to the tool row's command. It never runs `sudo` and never installs a runtime into
the project folder (for example with `mise use` without `-g`).

Colleague can explain preparation errors and offer its supported status/retry
actions. These instructions do not give it shell access or permission to install
host software. The coding agent can repair project commands after being asked.
