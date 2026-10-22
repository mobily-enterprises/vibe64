# Connected development: NuGet (`nuget`)

Proves that a .NET consumer can build against a connected checkout of a NuGet
library without editing any tracked file and without putting a shadow package
into any NuGet cache.

## Recipe

`app/genesis/stack.md` declares the project's own commands (Vibe64 runs them
from the consumer checkout root):

```
## Connected development

- Default package type: `nuget`
- Sources file: `.development/connected.json`
- Prepare `Use connected NuGet packages` with `csharp`: `dotnet` `run` `--project` `tooling/Connected` `--` `prepare` `.development/connected.json`
- Verify `Prove connected NuGet packages` with `csharp`: `dotnet` `run` `--project` `tooling/Connected` `--` `verify` `.development/connected.json`
```

`app/vibe64.connections.json` lists the library without `type`, so the Stack
default `nuget` applies.

### Mechanism: generated `Directory.Build.targets`, PackageReference -> ProjectReference

`prepare` (`app/tooling/Connected/Program.cs`):

1. Reads the `vibe64.connected-sources.v1` map and, for each `nuget` project,
   evaluates every `.csproj` under its `sourceRoot` with
   `dotnet msbuild -getProperty:PackageId -getProperty:IsPackable` to learn
   which package ids that checkout produces.
2. Evaluates each consuming `.csproj` (excluding `tooling/` and connected
   roots) with `-getItem:PackageReference` and `-p:Vibe64ConnectedDisabled=true`,
   so a repeated prepare still sees the original references.
3. Writes `Directory.Build.targets` beside each consuming `.csproj` that
   references a connected package id. MSBuild imports that file automatically,
   during restore as well as build. The file:
   - chains to any `Directory.Build.targets` further up the tree with
     `GetPathOfFileAbove`, the documented multi-level pattern;
   - acts only on that exact project (`MSBuildProjectFullPath`), only while the
     sources file exists, and only when `Vibe64ConnectedDisabled` is not `true`;
   - removes `<PackageReference Include="Example.Library">` and adds
     `<ProjectReference Include="/abs/connected/Example.Library.csproj">`;
   - sets `NuGetLockFilePath` to `obj/vibe64-connected.packages.lock.json` and
     `RestoreLockedMode=false`, because the connected graph differs from the
     tracked lock file.
4. Adds the generated path to Git's untracked exclude list
   (`git rev-parse --git-path info/exclude`), so it never appears in
   `git status`. Running prepare twice produces the same file and the same
   exclude entry.

`verify` runs `dotnet build` on each affected project and then requires all of
the following to be true:

- `obj/project.assets.json` resolves the package id as `"type": "project"`,
  and its path points to the connected `.csproj`;
- the `Example.Library.dll` in the consumer's output is byte-identical
  (SHA-256) to the `TargetPath` built inside the connected checkout;
- `git status --porcelain --untracked-files=no` is empty.

A build that succeeds while still using the published package fails verify.
`prove.sh` checks this by deactivating the generated file.

### Why tracked files stay untouched

`App.csproj`, `nuget.config` and `packages.lock.json` are never written. The
swap happens in an MSBuild import that is untracked and Git-excluded. Restore
writes its connected lock file under `obj/`, which is ignored. No package is
packed, so nothing reaches `NUGET_PACKAGES`: the cached
`example.library/1.0.0` stays byte-identical, and no shadow version can leak
into other projects. Edits in the connected checkout appear on the next
`dotnet build` or `dotnet run`, with no re-prepare. When the sources file is
removed, the generated file becomes inert, and the next restore goes back to
the published package. `dotnet restore --locked-mode` against the tracked lock
file succeeds again.

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

`prove.sh` copies the fixtures to a fresh temporary directory and then:

1. Packs the original library into `published-feed/` as a stand-in for
   nuget.org.
2. Restores the app, which creates `packages.lock.json`, and commits the app.
3. Checks the baseline with `--locked-mode`; the app prints the original
   marker.
4. Edits the connected checkout's marker.
5. Writes the sources map.
6. Runs the Stack prepare command twice, then verify.
7. Checks that verify rejects a deactivated generated file.
8. Runs the app, which must print the modified marker.
9. Makes a live edit and checks that it is picked up without re-prepare.
10. Asserts that `git status --porcelain` is clean and the cached package is
    unchanged.
11. Disconnects by removing the sources file, restores with `--locked-mode`,
    and checks that the original marker comes back.
12. Cleans up.

The proof runs offline. `nuget.config` clears all sources and lists only the
fixture feed. `NUGET_PACKAGES` is per run, and build servers are disabled and
shut down.

## Tool versions

- .NET SDK 10.0.402 (current LTS), installed with the official `dotnet-install.sh --channel LTS --no-path`
- git 2.43.0
- Linux x86_64

## Limitations

- A tracked `Directory.Build.targets` in the same directory as a consuming
  `.csproj` cannot be shadowed. Prepare refuses with a message. Moving that
  file to a parent directory works, because the generated file chains upward.
  A file in a parent directory is fine.
- The connected checkout must contain a buildable `.csproj` producing the
  package id. A package produced only by a `.nuspec` or by custom packing is
  not covered.
- A ProjectReference has no version constraint: the connected source is used
  even if its `<Version>` is lower than the reference.
- Central Package Management (`Directory.Packages.props`) works, because
  `PackageReference Remove` still applies. This fixture does not exercise it.
- Restoring the consumer also restores and builds the connected checkout, so
  `bin/` and `obj/` appear inside it. The library's own `.gitignore` should
  cover them.
- Do not pass `--locked-mode` while connected. It is a global property and
  overrides the generated `RestoreLockedMode=false`.
- The tool needs `dotnet` and `git` on `PATH`.

## `composition` relationship

The mechanism treats `composition` exactly like `dependency`: the
relationship affects how Vibe64 presents and publishes the pair, not how the
build is wired. A composed .NET component referenced as a package is swapped
for a ProjectReference in the same way.

## Passing transcript (excerpt)

```
10.0.402
== baseline (locked mode) prints the published marker
baseline prints: example-library-marker:original
== prepare (1st)
connected: src/App/App.csproj uses Example.Library -> /tmp/connected-nuget-proof.prk9DF/library/Example.Library.csproj
== prepare (2nd, idempotent)
connected: src/App/App.csproj uses Example.Library -> /tmp/connected-nuget-proof.prk9DF/library/Example.Library.csproj
== verify
connected: src/App/App.csproj built Example.Library from /tmp/connected-nuget-proof.prk9DF/library/Example.Library.csproj
connected: verified
== verify must reject a checkout that is not wired to the connected source
connected: src/App/App.csproj: Example.Library resolved as package example.library/1.0.0, not /tmp/connected-nuget-proof.prk9DF/library/Example.Library.csproj
verify correctly refused the unwired checkout
== connected run prints the modified marker
connected prints: example-library-marker:connected-255006-16967
== live edit in the connected checkout is picked up without re-prepare
connected prints: example-library-marker:connected-255006-16967-live
== tracked files are untouched and the package cache did not change
git status --porcelain: clean; cache: only the published 1.0.0, unchanged
== disconnect: removing the sources file restores the published package
disconnected prints: example-library-marker:original

PROOF PASSED: nuget connected development
```
