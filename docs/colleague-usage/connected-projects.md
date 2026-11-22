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
default; override other connections individually. For every type but custom,
Vibe64 itself makes a Dependency connection take effect: **Prepare workspace**
puts the session's copy in place of the published package and proves it, with
no project command. `- Default package type: \`npm\`` alone is a complete
`Connected development` section; see
[What Vibe64 does for each type](#what-vibe64-does-for-each-type).

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
Replacing an entry with another repository of the same name leaves a session's
copy alone too: its next preparation stops until that copy is moved away; see
[Work in connected repositories](connected-repositories.md#prepare-workspace-makes-the-missing-copies).

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

## What Vibe64 does for each type

Vibe64 treats each typed Dependency connection in the session's own source and
never changes a tracked file: what it generates is kept out of Git, so **Save**
commits none of it, and anything built from a saved commit, such as a
deployment, uses the published packages.

- **npm**: every installed copy of the connected package, in the session's
  `node_modules` and in each connected copy's (nested duplicates included),
  becomes exactly the files `npm pack` would publish from the session's copy.
  The copy's own `node_modules` is not used, so the app and the connected
  package share one instance of each dependency. A dependency the connected
  copy needs that is missing or of an incompatible version is installed with
  `npm install --no-save`; when no version satisfies it, preparation stops and
  names it. `package.json` and lockfiles stay unchanged. Vibe64 adds
  `node_modules` to the local Git exclude when the project does not ignore it,
  and refuses a project that tracks `node_modules`. While the session runs, a
  saved file in the connected copy reaches every installed copy within about a
  second; adding or removing a file or editing `package.json` puts the
  connection in effect again. A development server that bundles packages ahead
  (Vite) keeps what it bundled until it restarts: Vibe64 clears Vite's
  dependency metadata, so restarting Preview shows client changes. A connected
  package no tree installs is refused by name, and a package marked `private`
  is never a candidate. On **Save**, once the registry has published the
  version the connected copy carries, Vibe64 moves the project's
  `package.json` and `package-lock.json` to it (`npm install
  --package-lock-only`, so the swap stays); until then it changes nothing.

- **composer**: Vibe64 writes `composer.connected.json` and
  `composer.connected.lock` (the tracked manifest with a first `path`
  repository, symlinked to the session's copy) and runs `composer update` for
  the connected packages with `COMPOSER` pointing at them; `vendor/<package>`
  then links to the copy. On **Save** it moves `composer.json` and
  `composer.lock` with `composer require <package>:<version> --no-install` once
  the version is published.
- **pip**: Vibe64 installs the session's copy editable into the project's
  `.venv` in one resolution with `requirements.connected.txt` (the tracked
  `requirements.txt` with the connected `==` pins left out). On **Save** it
  edits the `==` pin once `pip download` finds the version.
- **bundler**: Vibe64 writes `Gemfile.connected` (the tracked Gemfile with
  `path:` gems) and its lock, selects it with `bundle config set --local
  gemfile`, and installs. Launch through `bundle exec`. On **Save** it runs
  `bundle lock --update <gem>` on the tracked Gemfile once the version is
  published.
- **gomod**: Vibe64 writes an untracked `go.work` (`use . <copy>`). On **Save**
  it runs `GOWORK=off go get <module>@<tag>` for the copy's newest `v*` tag once
  the module proxy has it.
- **cargo**: Vibe64 writes an untracked `.cargo/config.toml` patch and a
  derived lockfile (Cargo 1.97 or later). On **Save** it runs `cargo update -p
  <crate> --precise <version>` without the patch once the version is published.
- **nuget**: Vibe64 writes a `Directory.Build.targets` beside each consuming
  project that turns the connected `PackageReference` into a `ProjectReference`
  and restores. On **Save** it runs `dotnet add package <id> --version <version>`
  once the version is published.
JVM_TYPES_PLACEHOLDER

Every type except npm reads the session's copy in place, so a save takes effect
at the next build or run; Maven installs a jar, so Vibe64 installs it again on
save. The derived files stay out of Git, and a tracked file in their place is
refused.

Staging and Production never use a session's copy: they build from the saved
commit, so they install the published versions the project's tracked manifests
and lockfiles name. Vibe64 shows that gap instead of hiding it: the preparation's
check and **Save** print, for each package, for example `[Connected] Library:
this session runs the connected library at 4f2a9c1e7b30; Staging and Production
use the published 1.0.0 until 1.1.0 is published, which Save then moves this
project to.`, and session status lists it under `published`. A Composition
connection is not a package: **Save** records the commit it saved in
`vibe64.connections.lock.json`, and the project's build reads that pin.

When a connection is removed from the list, the next preparation gives the
published package back (npm restores the installed copies; the other types
remove what they generated).

Use **Custom** for anything else, including mixed-language connections: a Node
application can use a connected C executable or library. Package type is
independent of the consuming project's language and of relationship. **Stack
default** omits `type` in the repository file, and the prepared source map
records the effective type of every entry. A custom connection's commands must
build it, expose its development executable or library to the app, and verify
the app uses that build; Vibe64 runs them but cannot judge what they produce. A
cloned repository alone does not establish that Preview or tests use its
changes.

## Prepare workspace puts connections in effect

Use the existing **Prepare workspace** action (or its **Retry** action after a
failure). When Stack declares `Connected development`, preparation makes this
session's missing copies, writes the `Sources file` when Stack names one, runs
ordinary Workspace setup, then runs in order any project Prepare commands, one
`Put connected <name> in effect (<type>)` step per typed Dependency, any project
Verify commands (custom scripts included), and one `Check connected <name> is in
effect (<type>)` step per typed Dependency. Success requires every step. A failed
check stops preparation with `Connected <name> is not in effect: <reason>`, and
Preview waits; Vibe64 never falls back to the published package silently.

A connection that stops being in effect later (for example an ordinary
`npm install` put the published package back) makes the workspace unprepared:
the next Preview start or **Prepare workspace** shows `Workspace preparation
started again. Connected <name> is not in effect: <reason>` and puts it back.
The session status (`vibe64-helper session status --json`) shows each copy's
`inEffect` and `reason`.

A Composition connection is assembled by the project itself, so a non-custom
composition still needs a project Verify command: without one, preparation is
blocked with `vibe64_connected_verification_required` ("Declare a Verify
command for the connected npm composition."); add a Verify entry to Stack and
use **Retry**. Its dependencies installed inside the composed tree are still
swapped like any other installed copy. Project Prepare and Verify entries and a
Custom runner read the `Sources file`, so Stack must name one when it declares
them. The preparation identity includes both recipes and this session's copies;
changing the list requires preparation again. The copies are checked again
before each command and when checking whether preparation remains current.

If a command reports that it requires an undeclared runtime, add that runtime
to the affected command in Stack and prepare again. Vibe64's own steps declare
the runtimes their toolchain needs (npm: `nodejs` and `git`). Do not bypass the
managed runtime restriction by adding host executables to PATH.

`examples/connected-development/` holds a runnable proof for every package type
(npm, composer, pip, bundler, gomod, cargo, maven, gradle, nuget and a custom
CMake connection). Each typed proof runs Vibe64's own adapter through
`examples/connected-development/vibe64-adapter.mjs`, leaves tracked files
unchanged and shows the check failing once the connection is undone;
`examples/connected-development/run-all.sh` runs every proof whose toolchain is
installed.

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

## Save records what main was saved with

Save covers the copies first; see
[Save saves the copies first](connected-repositories.md#save-saves-the-copies-first).
For a **Composition**, Save pins the saved commit in the tracked
`vibe64.connections.lock.json`, in the same commit as the project's own work:

```json
{
  "schema": "vibe64.connections-lock.v1",
  "repositories": [
    {
      "name": "Library",
      "repository": "https://github.com/example/library",
      "commit": "<the copy's saved commit>",
      "tree": "<that commit's tree>"
    }
  ]
}
```

Have the project's composer, what Staging and Production build with, read the
pin there: whatever is built from a saved commit then assembles exactly that
commit of the composition. A session's own copy still takes its place while you
work, through the Sources file. A
**Dependency** gets no pin: Staging and Production install the published version
the project's manifest and lock name, and Save moves them to a newer published
version when the connected copy declares one (never to an unpublished commit).

For anything else a project must record when it saves, declare **Save** entries
after the Prepare and Verify entries (they need the `Sources file`):

```markdown
- Save `Record release state` with `nodejs`: `node` `tooling/record-release.mjs` `.development/connected.json`
```

They run after the copies are saved and pinned, before the project's own
commit, which takes what they change; one that fails stops that commit. A Custom
runner script is not called by Save.
