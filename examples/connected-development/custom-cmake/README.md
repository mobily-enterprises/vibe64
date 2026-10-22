# Connected development: C/C++ with CMake (`custom`)

Proves that a CMake consumer can build against a connected checkout of a CMake
library through Vibe64's `custom` connection type. No tracked file is edited
and nothing is downloaded.

## Recipe

`app/genesis/stack.md` declares one Custom runner and no package commands:

```
## Connected development

- Default package type: `custom`
- Sources file: `.development/connected.json`
- Custom runner with `cpp` `shell`: `bash`
```

`app/vibe64.connections.json` names the script for this connection:

```json
{"projects":[{"name":"Example Library","repository":"https://github.com/acme/example-library",
  "relationship":"dependency","type":"custom","script":"tooling/connected-cmake.sh"}]}
```

For each phase, Vibe64 runs:

```
bash /abs/app/tooling/connected-cmake.sh --phase prepare|verify \
  --source-root <connected checkout> --project-root <consumer checkout> \
  --sources-file <abs .development/connected.json> --repository <repository URL>
```

### Mechanism: `FETCHCONTENT_SOURCE_DIR_<UPPERNAME>`

In the normal build, `app/CMakeLists.txt` uses
`FetchContent_Declare(example_library GIT_REPOSITORY … GIT_TAG v1.0.0)` and
`FetchContent_MakeAvailable`. CMake documents
`FETCHCONTENT_SOURCE_DIR_<uppercaseName>` as the developer override: when it
is set, FetchContent uses that directory as the dependency's source and skips
the download.

`prepare`:

1. Maps the `--repository` to its FetchContent name through an explicit table
   in the script. An unmapped repository fails, because the script never
   guesses.
2. Configures the untracked build tree `.development/connected/build` with:
   - `-DFETCHCONTENT_SOURCE_DIR_EXAMPLE_LIBRARY=<source root>`;
   - `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`.

Re-running prepare reconfigures the same tree, so it is idempotent. Cache
entries accumulate, so several custom connections can share one build tree.

`verify`:

1. Checks that the build tree's cache holds exactly this source root.
2. Builds the tree.
3. Reads CMake's `compile_commands.json` and requires both of these:
   - at least one translation unit compiled from inside the connected checkout;
   - no translation unit compiled from a downloaded `_deps/example_library-src`
     copy.
4. Requires `git status --porcelain --untracked-files=no` in the consumer to
   be empty.

A configure that silently uses the pinned download fails these checks.

### Why tracked files stay untouched

The override is a CMake cache variable. It exists only in the untracked,
`.gitignore`d `.development/connected/build` tree, and `CMakeLists.txt` is
never edited. The sources file is also under `.development/`. Because
FetchContent builds the connected sources in place, an edit in the connected
checkout is picked up by the next `cmake --build` without re-prepare. To
disconnect, delete `.development/connected/build`; the normal `build/` trees
never saw the override.

### Alternative considered

`find_package(ExampleLibrary)` with `CMAKE_PREFIX_PATH` pointing at an install
of the connected checkout would also work. Every library edit would then need
a re-install, and the library must export a package config. The FetchContent
override needs neither.

## Commands

```
bash prove.sh
```

`prove.sh` copies the fixtures to a fresh temporary directory and then:

1. Publishes the original library as a local Git repository tagged `v1.0.0`.
2. Commits the app.
3. Runs a baseline configure with
   `-DEXAMPLE_LIBRARY_GIT_REPOSITORY=file://…`, a cache variable that keeps
   the proof offline; the baseline build prints the original marker.
4. Edits the connected checkout's marker.
5. Writes the sources map.
6. Runs the script exactly as Vibe64 would: prepare twice, then verify.
7. Checks that verify rejects a wrong `--source-root`.
8. Builds and runs the app, which must print the modified marker.
9. Makes a live edit and checks that it is picked up without re-prepare.
10. Asserts that `git status --porcelain` is clean.
11. Cleans up.

The proof runs fully offline: the connected configure never contacts the
`https://github.com/acme/…` URL.

## Tool versions

- cmake 3.28.3 (the fixture requires 3.24 or later)
- g++ 13.3.0
- git 2.43.0
- python3 3.12.3, used by verify to read `compile_commands.json`
- bash; Linux x86_64

## Limitations

- The dependency must be consumed through `FetchContent_Declare` and
  `FetchContent_MakeAvailable`, or the deprecated `FetchContent_Populate`.
  The connected source must build as a subproject.
- If the dependency is declared with `FIND_PACKAGE_ARGS`, or
  `FETCHCONTENT_TRY_FIND_PACKAGE_MODE=ALWAYS` is set, an installed package can
  win before the override applies. Verify catches this, because nothing would
  be compiled from the connected root. In that case, prepare should also pass
  `-DFETCHCONTENT_TRY_FIND_PACKAGE_MODE=NEVER`.
- The repository-to-FetchContent-name table is project-owned and must be
  extended for each new connection.
- The connected build tree is separate from the developer's usual `build/`.
  IDEs must be pointed at `.development/connected/build`, or given the same
  `-D` option.
- `ExternalProject`, Conan and vcpkg consumption are not covered. Each has its
  own native override mechanism, such as vcpkg overlay ports and Conan
  `editable`.

## `composition` relationship

`composition` is wired identically. The relationship changes how Vibe64
presents and publishes the pair, not how CMake consumes the source.

## Passing transcript (excerpt)

```
== baseline build uses the pinned tag
baseline prints: example-library-marker:original
== prepare (1st)
connected-cmake: example_library -> /tmp/connected-cmake-proof.P0VGSj/library (build tree /tmp/connected-cmake-proof.P0VGSj/app/.development/connected/build)
== prepare (2nd, idempotent)
connected-cmake: example_library -> /tmp/connected-cmake-proof.P0VGSj/library (build tree /tmp/connected-cmake-proof.P0VGSj/app/.development/connected/build)
== verify
connected-cmake: compiled from connected checkout: /tmp/connected-cmake-proof.P0VGSj/library/src/library.cpp
connected-cmake: verified https://github.com/acme/example-library
== verify must reject a build tree that is not using the claimed checkout
connected-cmake: build tree uses '/tmp/connected-cmake-proof.P0VGSj/library', expected /tmp/connected-cmake-proof.P0VGSj/library-origin
verify correctly refused the wrong source root
== connected build prints the modified marker
connected prints: example-library-marker:connected-256749-26401
== live edit in the connected checkout is picked up without re-prepare
connected prints: example-library-marker:connected-256749-26401-live
== tracked files of the consuming app are untouched
git status --porcelain: clean

PROOF PASSED: custom-cmake connected development
```
