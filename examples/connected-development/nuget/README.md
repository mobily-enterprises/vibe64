# Connected development: NuGet (`nuget`)

Proves Vibe64's own `nuget` treatment: a .NET consumer builds against a
connected checkout of a NuGet library without editing any tracked file and
without putting a shadow package into any NuGet cache; and on Save the
project and its lock file move to the checkout's new version only once the
feed has it.

## Recipe

`app/genesis/stack.md` declares only the default package type:

```
## Connected development

- Default package type: `nuget`
```

`app/vibe64.connections.json` lists the library without `type`, so the Stack
default `nuget` applies. The project declares no Prepare or Verify command.

### Mechanism: generated `Directory.Build.targets`, PackageReference -> ProjectReference

For every `nuget` `dependency` connection, workspace preparation runs Vibe64's
adapter (`packages/vibe64-project/src/server/connectedAdapters/nuget.js`).
**Apply**:

1. Evaluates every `.csproj` of each connected checkout with
   `dotnet msbuild -getProperty:PackageId -getProperty:IsPackable` to learn
   which package ids it builds.
2. Evaluates each `.csproj` of the session source with
   `-getItem:PackageReference` and `-p:Vibe64ConnectedDisabled=true`, so a
   repeated apply still sees the original references.
3. Writes `Directory.Build.targets` beside each project that references a
   connected package id. MSBuild imports that file automatically, during
   restore as well as build. The file:
   - chains to any `Directory.Build.targets` further up the tree with
     `GetPathOfFileAbove`, the documented multi-level pattern;
   - acts only on that exact project (`MSBuildProjectFullPath`), and only
     when `Vibe64ConnectedDisabled` is not `true`;
   - removes `<PackageReference Include="Example.Library">` and adds
     `<ProjectReference Include="/abs/connected/Example.Library.csproj">`;
   - sets `NuGetLockFilePath` to `obj/vibe64-connected.packages.lock.json` and
     `RestoreLockedMode=false`, because the connected graph differs from the
     tracked lock file.
4. Keeps the generated files out of Git through Vibe64's own block in
   `.git/info/exclude`, and refuses a tracked one or one it did not write
   (move such a file to a parent folder: the import chains to it). When the
   connected checkout does not ignore its `bin/` and `obj/`, it excludes them
   there too, so the session's restores never add build output to a Save.
5. Runs `dotnet restore` on each affected project, with no MSBuild or compiler
   server left running.

**Proof** checks the generated files are the ones apply would write now,
restores, and requires `obj/project.assets.json` to resolve each connected
package id as `"type": "project"` at the connected `.csproj`. Session status
runs the same check from the files alone. A build that succeeds while still
using the published package fails the proof; `prove.sh` checks this by
deactivating the generated file.

Edits in the connected checkout appear on the next `dotnet build` or
`dotnet run`: a ProjectReference builds the source in place, so no watcher is
needed. When no NuGet package is connected any more, Vibe64 removes its
imports, and the next restore goes back to the published package.

**Save** (`bump`): Staging and Production restore from the tracked project
files and lock files. `locked` reports the version the tracked
`packages.lock.json` resolves (else the exact `PackageReference` version,
from the project or the nearest `Directory.Packages.props`) beside the version
the connected `.csproj` declares (`PackageVersion`, `Version` or
`VersionPrefix`/`VersionSuffix`). When the declared version is newer, bump
sets Vibe64's import aside and runs
`dotnet add <project> package <id> --version <declared>` (and `dotnet restore`
when the project has a lock file), which restores from the project's own feeds
and fails when they lack that version. A failure puts every tracked file back
and says why; the import is back, in effect, either way.

### Why tracked files stay untouched

`App.csproj`, `nuget.config` and `packages.lock.json` are never written by the
session's connection. The swap happens in an MSBuild import that is untracked
and Git-excluded. Restore writes its connected lock file under `obj/`, which is
ignored. No package is packed, so nothing reaches `NUGET_PACKAGES`: the cached
`example.library/1.0.0` stays byte-identical, and no shadow version can leak
into other projects. Only Save's bump changes the project and its lock, to a
version the feed publishes.

### Alternatives considered

- **Project-extension imports** (`obj/<Project>.csproj.*.targets`/`.props`):
  rejected. Since MSBuild 17.10, `Microsoft.Common.props` and
  `Microsoft.Common.targets` skip these imports while restoring
  (`MSBuildIsRestoring`). Restore would not see the swap, and the build failed
  with NETSDK1004.
- **Local feed plus derived `NuGet.Config`** (`dotnet pack` into an untracked
  folder, then `restore --configfile` with an isolated `NUGET_PACKAGES`):
  workable, but weaker:
  - the version must equal the locked 1.0.0, or the tracked lock file changes;
  - the same version with different bytes fails `--locked-mode` with NU1403
    (content hash);
  - the isolated cache has to be cleared on every prepare;
  - every library edit needs a new pack;
  - a later plain `dotnet build` restores again without the derived config and
    silently reverts.

## Commands

```
export PATH=/path/to/dotnet:$PATH          # or DOTNET_ROOT=/path/to/dotnet
bash prove.sh
```

`prove.sh` needs `git` and `node` with this repository's packages installed
(it runs the adapter from `packages/vibe64-project`). It copies the fixtures to
a fresh temporary directory and then:

1. Packs the original library into `published-feed/` as a stand-in for
   nuget.org, and makes the connected copy a Git checkout.
2. Restores the app, which creates `packages.lock.json`, and commits the app.
3. Checks the baseline with `--locked-mode`; the app prints the original
   marker.
4. Edits the connected checkout's marker and writes the sources map.
5. Runs the adapter's apply twice (the import must be identical), then its
   proof.
6. Checks that the proof rejects a deactivated generated file.
7. Runs the app, which must print the modified marker, then makes a live edit
   and checks that it is picked up without another apply.
8. Asserts that the app's `git status` is clean, the connected checkout shows
   only its edit (no build output), and the cached package is unchanged.
9. Save: the checkout declares 1.1.0, which the feed lacks; bump reports it is
   not published and changes nothing. After packing a published 1.1.0, bump
   moves `App.csproj` and `packages.lock.json` to it (and nothing else), the
   proof still passes, and the app still prints the connected live edit. A
   second bump changes nothing.
10. Disconnects through Vibe64's restore, which removes the import; a
    `--locked-mode` restore then gives Staging's view, the published 1.1.0.
11. Cleans up.

The proof runs offline. `nuget.config` clears all sources and lists only the
fixture feed. `NUGET_PACKAGES` is per run, and build servers are disabled and
shut down.

## Limitations

- A tracked `Directory.Build.targets` in the same directory as a consuming
  `.csproj` cannot be shadowed. Apply refuses with a message. Moving that
  file to a parent directory works, because the generated file chains upward.
- Two consuming projects in one folder are refused; give each its own folder.
- The connected checkout must contain a buildable `.csproj` producing the
  package id. A package produced only by a `.nuspec` or by custom packing is
  not covered.
- A ProjectReference has no version constraint: the connected source is used
  even if its `<Version>` is lower than the reference.
- Central Package Management (`Directory.Packages.props`) works for the swap,
  because `PackageReference Remove` still applies, and bump reads and updates
  its version; neither is exercised by this fixture.
- `locked` and bump read versions from the project files alone: a version
  MSBuild computes (`$(...)`, `Directory.Build.props`) counts as none.
- Restoring the consumer also restores and builds the connected checkout, so
  `bin/` and `obj/` appear inside it (ignored or excluded, see above).
- Do not pass `--locked-mode` while connected. It is a global property and
  overrides the generated `RestoreLockedMode=false`.

## Evidence

Run `cad-godotnet-r2` on usone (Linux x86_64), offline apart from fetching the
toolchain from nixpkgs: .NET SDK 10.0.404 (nixpkgs `dotnet-sdk_10`), git
2.53.0, Node v26.5.0. The proof took 76 s. Excerpt:

```
== apply (1st)
[Connected] Example Library: src/App/App.csproj uses Example.Library from /tmp/…/library/Example.Library.csproj.
== proof
[Connected] Example Library is in effect.
== the proof must reject a checkout that is not wired to the connected source
connected proof: Connected Example Library is not in effect: src/App/Directory.Build.targets no longer swaps this session's connected packages; prepare the workspace again.
== connected run prints the modified marker
connected prints: example-library-marker:connected-1002259-24842
== live edit in the connected checkout is picked up without another apply
connected prints: example-library-marker:connected-1002259-24842-live
== tracked files are untouched, build output stays out of Git, and the package cache did not change
git status --porcelain: clean; connected checkout: only Marker.cs; cache: only the published 1.0.0, unchanged
== Save: the checkout declares 1.1.0, which the feed does not have yet, so nothing moves
locked: [{"package":"Example.Library","connected":"1.1.0","locked":"1.0.0"}]
[Connected] Example Library: Example.Library 1.1.0 is not published, so src/App/App.csproj keeps 1.0.0.
bumped: []
== Save once 1.1.0 is published: the project and its lock move to it, and the connection stays in effect
[Connected] Example Library: Staging and Production now use the published Example.Library 1.1.0.
bumped: [{"package":"Example.Library","from":"1.0.0","to":"1.1.0"}]
[Connected] Example Library is in effect.
connected prints: example-library-marker:connected-1002259-24842-live
== disconnect: Vibe64's restore removes its import; a locked restore gives Staging's view
[Connected] No NuGet package is connected any more: removed src/App/Directory.Build.targets.
disconnected prints: example-library-marker:published-1.1.0
PASS nuget connected development
```
