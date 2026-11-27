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
  `npm install --no-save`; an older version npm nested inside the published
  package for its own pin is put aside with that package. When no version
  satisfies it, or the swapped package would still load an incompatible one
  (another package's own pin beside it, for example; a connected package
  beside it counts as its connected version), preparation stops, names
  it and says to align the versions in the connected repository or the
  application. `package.json` and lockfiles stay unchanged. Vibe64 adds
  `node_modules` to the local Git exclude when the project does not ignore it,
  and refuses a project that tracks `node_modules`. While the session runs, a
  saved file in the connected copy reaches every installed copy within about a
  second; adding or removing a file, editing `package.json` or a save after
  an ordinary `npm install` put the published package back puts the
  connection in effect again. A development server that bundles packages ahead
  (Vite) keeps what it bundled until it restarts: Vibe64 clears Vite's
  dependency metadata, so restarting Preview shows client changes. A connected
  repository none of whose packages any tree installs is unused (see below),
  and a package marked `private` is never a candidate. On **Save**, once the registry has published the
  version the connected copy carries, Vibe64 moves the project's
  `package.json` and `package-lock.json` to it (`npm install
  --package-lock-only`, so the swap stays) and keeps the registry's copy of
  that version aside for a later disconnection; until then it changes nothing.
  While the copy carries another version than the project's pins, a check
  that compares the two refuses: in a JSKIT app, `jskit check`, the first step of
  `npm run verify`, says `JSKIT project graph is inconsistent`. There
  `npm run jskit:update` moves the pins, and the next Preview start puts the
  connected copy back in place of the published one the update installed.
  `npm install --no-save`, like any ordinary install, puts the published
  package back instead, so the checks then pass for code the session does not
  run.

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
- **maven**: Vibe64 installs each copy into the untracked
  `.development/maven-connected-repository`, chained in front of your own Maven
  repository (Maven 3.9.3 or later), and an untracked `.mvn/maven.config`
  selects it for every `mvn` in the session. On **Save** it changes the
  dependency's `<version>` (or the one property that holds it) in `pom.xml` once
  the project's repositories publish the version; a `-SNAPSHOT` never moves.
- **gradle**: the session gets its own Gradle user home,
  `.development/gradle-home` (untracked), whose `init.d` holds Vibe64's init
  script that includes each copy as a composite build. Vibe64 gives every
  command of the session that home as `GRADLE_USER_HOME`, so the project's
  ordinary Gradle commands use the copies with no flag. The home links your
  default Gradle home's `gradle.properties` and init scripts, and reads
  dependencies first from a read-only cache every session shares
  (`GRADLE_RO_DEP_CACHE`, a copy of the default home's dependency cache, renewed
  at most once a day), so a session does not download again what the machine
  already has. A terminal opened before **Prepare workspace** keeps its old
  environment: open a new one. On **Save** it changes the dependency's version
  in the build scripts once the build's repositories publish it, and rewrites
  `gradle.lockfile` when the build locks.

Every type except npm reads the session's copy in place, so a save takes effect
at the next build or run; Maven installs a jar, so Vibe64 installs it again on
save. The derived files stay out of Git, and a tracked file in their place is
refused.

Staging and Production never use a session's copy: they build from the saved
commit, so they install the published versions the project's tracked manifests
and lockfiles name. Vibe64 shows that gap instead of hiding it: the preparation's
check and **Save** print, for each package, for example `[Connected] Library:
this session runs the connected library; Staging and Production
use the published 1.0.0 until 1.1.0 is published, which Save then moves this
project to.`, and session status lists it under `published`. When the copy
carries the very version Staging and Production use but differs from what was
published at it, the line says `the connected copy has unreleased changes at the
same version: publish a new version, which Save then moves this project to.`
(status: `unreleased: true`). npm compares the files the session runs with the
published copy it keeps aside; Go modules and Composer ask Git whether the copy
differs from the published commit (the version's tag or pseudo-version commit,
or the commit `composer.lock` names). pip, Bundler, Cargo, Maven, Gradle and
NuGet cannot tell, because their registries publish built archives that name
no commit to compare with. A Composition
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
ordinary Workspace setup and any project Prepare commands, with one `Keep
connected <name> in effect (<type>)` step per typed Dependency after each of
those steps but the last, then runs in order one `Put connected <name> in effect
(<type>)` step per typed Dependency, any project Verify commands (custom scripts
included), and one `Check connected <name> is in effect (<type>)` step per typed
Dependency. A Keep step prints `[Connected] <name> is in effect.` when nothing
undid the connection, and puts it back when the step before it did (an install
puts the published package back), so a later step that runs the app, such as
preparing its database, always runs it with the connected copy. Success
requires every step. A failed check stops preparation with `Connected <name> is
not in effect: <reason>`, and Preview waits; Vibe64 never falls back to the
published package silently.

A connection that stops being in effect later (for example an ordinary
`npm install` put the published package back) makes the workspace unprepared:
the next Preview start or **Prepare workspace** shows `Workspace preparation
started again. Connected <name> is not in effect: <reason>` and puts it back.
The session status (`vibe64-helper session status --json`) shows each copy's
`inEffect` and `reason`.

A typed Dependency that nothing in the session installs is unused, and it never
fails preparation or Preview: its Put and Check steps print `[Connected] <name>
is connected, but nothing here installs it: remove it or install it.` followed
by why (its Keep steps print nothing, since a later step may install it), and
preparation goes on with the other steps. Session status and **Connected
repositories** say unused exactly when preparation does. Each type decides from
the project's own files and toolchain:

- **npm**: no tree installs any of the repository's packages;
- **composer**: no `composer.json`, or neither it nor `composer.lock` names the
  package;
- **bundler**: no `Gemfile`, or `Gemfile.lock` does not lock the gem;
- **gomod**: the session source has no `go.mod`, or its `go.mod` does not
  require the module. A module `go.mod` requires stays in effect, even when no
  package of this host's build or tests imports it (another platform's build may);
  preparation then says it saw no build of it;
- **cargo**: no package of the session declares the crate, so it gets no patch.
  A crate the session uses only through another crate (a path dependency outside
  the workspace, or a published crate) counts as unused until a package of the
  session declares it;
- **nuget**: MSBuild's evaluation finds no project referencing a package the copy
  builds, wherever the reference is (`Directory.Build.props` and imports
  included). Only preparation can evaluate, so it keeps its finding in
  `.development/nuget/unused.json`. Status shows unused only while the project
  files are as preparation read them; after a change, it asks to prepare again.
  A package the session gets only through another package counts as unused
  until a project references it;
- **maven** and **gradle**: the session source is not a Maven project
  (`pom.xml`) or a Gradle build.

Other connections of the same type still go into effect, and once none of a
type is used Vibe64 takes back what it derived for it (for example
`Gemfile.connected` or `composer.connected.json`), as when the connection is
removed. Session status shows the copy with `unused: true` and the same
sentence as its `reason`, and **Connected repositories** shows that sentence
under the entry. Remove the connection from the list, or declare and install
the package the project uses; the next preparation then puts it in effect.

A pip connection is never unused. Vibe64 installs the copy editable into the
session's `.venv` itself, so there is always something for the session to import,
whether or not `requirements.txt` names it. The other types only redirect a
package the project already installs, so for them nothing can be left to do.
When `requirements.txt` does not name the distribution, status shows no
published version beside it: what Staging and Production install comes from the
project's own requirements, so add it there if the app needs it, or remove the
connection.

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

Vibe64's own steps name their program in the preparation recipe
(`vibe64-connected <type> keep|apply|proof <repository>`), which a machine
holding the session's folders at the same paths runs as it is.

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
