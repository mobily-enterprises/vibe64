# Connected development proofs

Each directory proves one Vibe64 connected package type end to end: a small
application uses a connected checkout of a dependency instead of the published
package, through the project's own Prepare and Verify commands declared in its
`genesis/stack.md`, and no tracked file changes. Every proof also shows Verify
failing when the connection is not in effect.

Neither Genesis nor Vibe64 runs or infers these commands; they are reference
implementations behind the recipes summarised in the Genesis Stack catalog
pieces' Guidance and in `docs/colleague-usage/connected-projects.md`. They are
not part of the published packages.

| Type | Mechanism | Tracked files left unchanged |
|---|---|---|
| `npm` | `npm install --no-save --install-links=false <source>` | `package.json`, `package-lock.json` |
| `composer` | derived `composer.connected.json` with first `path` repositories | `composer.json`, `composer.lock` |
| `pip` | editable install into an untracked virtual environment (pip or uv) | requirements |
| `bundler` | derived `Gemfile.connected` with `path:` gems | `Gemfile`, `Gemfile.lock` |
| `gomod` | untracked `go.work` | `go.mod`, `go.sum` |
| `cargo` | untracked `.cargo/config.toml` patch and derived lockfile (Cargo 1.97+) | `Cargo.toml`, `Cargo.lock` |
| `maven` | install into an untracked chained local repository (`maven.repo.local.tail`) | `pom.xml` |
| `gradle` | init script with `includeBuild` (composite build) | build scripts, lockfiles |
| `nuget` | untracked `Directory.Build.targets` swapping in a `ProjectReference` | project files, `packages.lock.json` |
| `custom` (CMake) | `FETCHCONTENT_SOURCE_DIR_<NAME>` in an untracked build tree | `CMakeLists.txt` |

Run every proof whose toolchain is installed:

```sh
examples/connected-development/run-all.sh          # or: run-all.sh gomod cargo
```

Each `prove.sh` works offline in a temporary directory and removes it. See each
directory's README for the exact recipe, versions used and limitations. Only the
`dependency` relationship is proven; a `composition` of raw source into the
application tree needs project-specific treatment.
