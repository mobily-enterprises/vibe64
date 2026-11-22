# Connected development proofs

Each directory proves one Vibe64 connected package type end to end: a small
application uses a connected checkout of a dependency instead of the published
package, through Vibe64's own adapter for that type, and no tracked file
changes. Each typed proof runs the adapter through `vibe64-adapter.mjs` (`apply`
and `proof` as workspace preparation runs them, `bump` as Save runs it), declares
only `- Default package type: <type>` in its `genesis/stack.md`, and shows the
check failing when the connection is not in effect. The custom CMake proof keeps
its project-declared script, as a custom connection does.

They are evidence for the adapters in
`packages/vibe64-project/src/server/connectedAdapters/` and for
`docs/colleague-usage/connected-projects.md`; they are not part of the
published packages. `tests/server/vibe64ConnectedAdapterProofs.unit.test.js`
runs them in the toolchain proof run (`VIBE64_CONNECTED_TOOLCHAIN_PROOFS=1`).

| Type | Mechanism | Tracked files left unchanged |
|---|---|---|
| `npm` | every installed copy replaced by the packlist of the connected package; missing dependencies `--no-save` | `package.json`, `package-lock.json` |
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
directory's README for what the adapter does, versions used and limitations.
Only the `dependency` relationship is proven here; a `composition` is assembled
by the project's own commands, and Save records its pin in
`vibe64.connections.lock.json`.
