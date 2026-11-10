# Configure connected repositories

A project can list other GitHub repositories it works with, such as a library it
uses. Every session then keeps its own copy of each listed repository, and
**Prepare workspace**, **Update this session (rebase)** and **Save** cover those
copies with the session's own repository; see
[Work in connected repositories](connected-repositories.md).

Open the intended project and session, then **Dashboard → Project settings →
Connected repositories**. On phones, use **Show project** and **Dashboard section**
to reach Project settings. The list belongs to the displayed source checkout.

`vibe64.connections.json` is the only repository connection list. If it does not
exist, use **Add repository**, then **Save connected repositories** to create it. You can
also edit this tracked source file directly. Stack contains technology and generic
placement/treatment instructions, never repository identities or initial lists.
Opening Settings and preparing a workspace do not create or import this file.

For each entry, provide a **Name**, a **GitHub repository URL**, and a
**Relationship**: Dependency for a library or tool; Composition for source
assembled into this project. Use an HTTPS URL without credentials. The same
repository cannot appear twice under different names. More repositories can
be added later, up to 64 entries within a 64 KiB file. Oversized saves preserve the
current list; shorten the entries before retrying.

**Package type** is separate from Relationship. Choose **Stack default** to
inherit the consuming project's `Default package type`, or override it for this
connection with **npm (Node.js)**, **Composer (PHP)**, **pip (Python)**,
**Bundler (Ruby)**, **Go modules**, **Cargo (Rust)**, **Maven**, **Gradle**,
**NuGet (.NET)** or **custom**. The file stores `npm`, `composer`, `pip`,
`bundler`, `gomod`, `cargo`, `maven`, `gradle`, `nuget` or `custom`. Stack
default leaves `type` out of the file, so a later Stack default change still
applies.

Each language's Stack proposes its default: Node `npm`, PHP/Laravel
`composer`, Python `pip`, Ruby `bundler`, Go `gomod`, Rust `cargo`, Java
`maven`, Kotlin `gradle` and C# `nuget`; C/C++ and shell projects use `custom`.
A multi-language project's own `Connected development` section chooses one
default; override other connections individually. A type other than custom is a
declared label, not an installer: Vibe64 never runs Composer, pip or any other
package manager because of it. The consuming project's declared Prepare and
Verify commands read the type from the prepared source map and give the source
that ecosystem's treatment. Every such type requires at least one Verify command.

For **custom**, provide **Preparation script (project-relative)**, for example
`tooling/prepare-native-worker.mjs`. The script lives in the consuming project;
use a relative path outside `.git`, without `..`, absolute paths or backslashes.
Stack declares the script runtime and runner, for example:

```markdown
- Custom runner with `nodejs` `cpp`: `node`
```

The existing preparer appends the absolute script path, then `--phase`
(`prepare` or `verify`), `--source-root`, `--project-root`, `--sources-file` and
`--repository` with their values. The script must remain inside the consuming
project; preparation rejects missing files and symlinks that escape that root.
Only custom connections have a script. Choosing any other type disables
**Preparation script (project-relative)** and removes the script from the draft. Stack default may retain a script for a custom default, and workspace
preparation checks the effective type before running anything. The script must
handle both phases: prepare makes the development artifact available; verify
checks that the consuming app uses the selected source and exits nonzero on
failure. Keep generated development artifacts ignored by Git and preserve
release manifests and lockfiles. Vibe64 provides execution and failure reporting;
it cannot infer what a custom artifact means or prove it from a zero-exit no-op.

Use **Save connected repositories** to write the complete list to
`vibe64.connections.json` in the selected source. You must be the project owner
and have write access to each listed repository through your connected GitHub
account. The file is ordinary project source and follows normal project Save.
Saving this configuration does not commit, push, merge or publish source.

In the standalone editor, the local project owner can use these controls without
signing in. A connected GitHub account still supplies repository access.

**Remove** removes an entry from the draft. Saving that removal deletes no work:
a session's next **Prepare workspace** removes its copy of that repository only
when the copy holds no unsaved work. An empty saved list remains authoritative.

If another edit changed the file, saving refuses to overwrite it. Review your
draft, use **Reload saved list**, and reapply the intended edits. A malformed
file needs repair by a coding agent or through Files; it is never silently
replaced. Missing GitHub write access requires the correct
connected account or repository permission. After an uncertain save, refresh and
inspect the current list before retrying.

Colleague can read this list or save explicitly requested changes
through the same actions. It preserves unrelated entries and uses the read
source session and revision. A how-to question does not authorize changes.
Account login and repository permission grants remain human-controlled steps.

The configuration controls only declare the connections. Saving the list does
not prepare any session: configuration success alone does not establish that the
copies are ready or used by Preview. For how each session copies, updates and
saves them, see [Work in connected repositories](connected-repositories.md).

Development consumption belongs to the project's Stack declarations. Those
declarations must identify the connected source, where the task exposes it, how
the selected toolchain builds/uses it, and how to verify that selection. This
applies to mixed-language connections too: a Node application can use a connected
C executable or library. Choose **custom** for that connection's **Package type**. Package type is
independent of the consuming project's language and of relationship. **Stack
default** omits `type` in the repository file. The prepared source map records
the effective type of every entry. A project's commands decide how to treat each
type; for example, Node treatment requires a package manifest and excludes
custom entries even if they contain one.
Custom sources remain available to the project's build and execution commands. For a C program those commands must build it, expose its development
executable or library to the app, and verify the app uses that build. It need
not appear in `node_modules`. A cloned repository alone does not establish that
Preview or tests use its changes.
Use the existing **Prepare workspace** action (or its **Retry** action after a
failure). When Stack declares `Connected development`, preparation makes this
session's missing copies, writes the declared source map pointing at them, runs
ordinary Workspace setup, then runs the connected Prepare and Verify commands in
order. Success requires those commands to succeed. If a non-custom
connection exists without a Verify command, preparation is blocked with
`vibe64_connected_verification_required` ("Declare a Verify command for the
connected pip packages."); add a Verify entry to Stack and use **Retry**. The preparation
identity includes both recipes and this session's copies; changing the list
requires preparation again. The copies are checked again before each command and
when checking whether preparation remains current.

If a command reports that it requires an undeclared runtime, add that runtime
to the affected command in Stack and prepare again. Vibe64's own Node
composition checks declare both `nodejs` and `git`: Genesis inspects the
Git worktree while verifying the composed application. Do not bypass the managed
runtime restriction by adding host executables to PATH.

The initial consumption proof covers Node.js packages through `node_modules`:
two tasks use distinct sources, source edits reach only the intended task, and
an ordinary release installation retains its published dependency. PHP, Python,
Ruby, C/C++, C#, Go, Java, Kotlin, Rust and framework-specific consumption still
need their own declared commands and end-to-end proof; choosing their package
type only records intent. Installed language runtimes alone
do not establish connected-source support. A declaration alone does not prove
that Preview or tests consume the dependency.

`examples/connected-development/` holds a runnable reference proof for every
package type (npm, composer, pip, bundler, gomod, cargo, maven, gradle, nuget
and a custom CMake connection). Each one declares its own Prepare and Verify
commands, leaves tracked files unchanged and shows Verify failing without the
connection; `examples/connected-development/run-all.sh` runs every proof whose
toolchain is installed. A proof shows the recipe works; each project still
declares and verifies its own commands.

The `Sources file` is JSON with schema `vibe64.connected-sources.v2`:

```json
{
  "schema": "vibe64.connected-sources.v2",
  "sessionId": "<this session>",
  "repositories": [
    {
      "name": "Library",
      "repository": "https://github.com/example/library",
      "relationship": "dependency",
      "type": "npm",
      "sourceRoot": "<this session's copy of the repository>"
    }
  ]
}
```

Each entry is the listed connection with its effective package type, its
`script` for a custom type, and `sourceRoot`, the absolute path of this session's
copy. Vibe64 excludes this generated file from Git locally; the portable
connection list remains unchanged. The consuming project's commands read this
map, and **Prepare workspace** executes and verifies the complete recipe.

The source-map location must be a development-only, project-relative file.
Vibe64 refuses to overwrite tracked files, symbolic links, unrelated content or
another session's map. If this check fails, preserve the file, choose another
`Sources file` location in Stack and retry. A missing or invalid Connected
development declaration also requires correcting Stack before retrying; the
copies already made stay in place. If a copy is missing when the map is written
or checked, preparation stops with `vibe64_connected_copy_missing`; see
[Work in connected repositories](connected-repositories.md). Colleague can
explain the process and offer supported preparation actions; it must not claim
successful preparation from a declaration alone.
