# Connected development: Composer (PHP)

Proves Vibe64's own `composer` treatment: a consuming PHP app uses an
unpublished local checkout of a Composer library during connected development,
without touching its tracked `composer.json` or `composer.lock`; and on Save the
project moves to the version the checkout declares only once a registry
publishes it.

## Layout

- `library/` — `acme/library` 1.0.0; `Acme\Library\Marker::value()` returns the
  marker string `library 1.0.0`.
- `app/` — `acme/app`, requiring `acme/library: ^1.0`. Its tracked
  `composer.lock` is the published-style lock (locked `acme/library` 1.0.0 from
  a zip dist URL on a registry). `bin/app.php` prints the marker.
  - `genesis/stack.md` — `## Connected development` with only
    `- Default package type: composer`. No project commands: Vibe64 prepares
    and proves the connection itself.
  - `.gitignore` — `vendor/`, `.development/`, `composer.connected.json`,
    `composer.connected.lock`.
- `prove.sh` — the reproducible acceptance run. It calls Vibe64's adapter
  through `../vibe64-adapter.mjs` (`apply`, `proof`) and Save's version move
  through `../vibe64-adapter.mjs bump`, as workspace preparation and Save do.

## Vibe64's treatment

`packages/vibe64-project/src/server/connectedAdapters/composer.js`, through
Composer's [`path` repository](https://getcomposer.org/doc/05-repositories.md#path)
and the [`COMPOSER` environment variable](https://getcomposer.org/doc/03-cli.md#composer).

Apply (after the project's own Workspace setup):

1. Reads each connected copy's `composer.json` for its package name, and refuses
   a package the session's `composer.json` and `composer.lock` do not use.
2. Writes the untracked derived manifest `composer.connected.json`: the tracked
   `composer.json` plus, first in `repositories`, one entry per connected copy:
   ```json
   {"type": "path", "url": "<connected copy>",
    "options": {"symlink": true, "versions": {"acme/library": "1.0.0"}}}
   ```
   `symlink: true` makes `vendor/acme/library` a link to the copy, so saved
   files are live without a watcher. `versions` presents the copy under the
   version the app has locked (a checkout on a branch would otherwise be
   `dev-<branch>`). Path repositories listed first win over Packagist.
3. Copies the tracked `composer.lock` to `composer.connected.lock`, then runs
   `COMPOSER=composer.connected.json composer update --no-interaction --no-progress acme/library`,
   a partial update: every other dependency keeps its locked version.
4. Refuses a derived file or `vendor/<package>` that Git tracks, and keeps
   `composer.connected.json`, `composer.connected.lock` and `vendor` out of Git
   (`.git/info/exclude`).

Proof (after the project's own Verify steps, and in session status from files
alone): the derived manifest matches `composer.json` and the copies now, the
derived lock locks each package to its copy with `dist.type = path`,
`vendor/<package>` is a link to the copy, and (in preparation)
`Composer\InstalledVersions::getInstallPath()` resolves there. Each failure says
which, for example after an ordinary `composer install`:
`vendor/acme/library is not a link to the connected copy (an ordinary composer install puts the published package back); prepare the workspace again.`

Save (`bump`): when the copy's `composer.json` declares a `version` that
differs from the tracked lock's, `composer show --all --format=json` (with the
tracked `composer.json`, never the derived one) checks the registries it names.
Once that version is published, `composer require acme/library:<version> --no-install`
moves `composer.json` and `composer.lock` to exactly it, and the connection is
applied again on top. An unpublished version moves nothing; a registry that
cannot be checked is reported. Staging and Production install from the tracked
files only.

When the connection goes, Vibe64 removes the derived files and the
`vendor/<package>` links; the project's next `composer install` puts the
published packages back.

## Commands

```
node ../vibe64-adapter.mjs apply .development/connected.json
node ../vibe64-adapter.mjs proof .development/connected.json
node ../vibe64-adapter.mjs bump .development/connected.json
php bin/app.php
```

`./prove.sh` copies `library/` and `app/` to a fresh temporary directory,
gives the app an artifact repository (a folder of package zips) holding the
published 1.0.0 in place of Packagist, commits the app, changes the library
copy's marker, writes the sources map, applies twice, proves, runs the app
(asserting the changed marker), checks the tracked hashes and
`git status --porcelain`; then declares 1.1.0 in the copy and runs Save's
bump (nothing moves), publishes 1.1.0 to the artifact repository and runs it
again (the tracked files name exactly the published 1.1.0, the proof still
passes and the app still prints the connected marker); finally replaces the
link as `composer install` would and shows the proof refusing.

## Network

None. `prove.sh` sets `COMPOSER_DISABLE_NETWORK=1`, `COMPOSER_NO_AUDIT=1`,
`COMPOSER_HOME` and `COMPOSER_CACHE_DIR` inside the temporary directory, and
disables Packagist in the app copy's manifest. In a real app the partial update
keeps the other dependencies at their locked versions; they still need
Composer's normal download or cache to be installed in the first place.

## Evidence

Run `cad-phpruby-3` on usone (2026-11-23), through Nix: PHP 8.5.13 (zip
extension), Composer 2.11.2, Git 2.53.0, Node v26.5.0. 3 s.

```
[Connected] Library: acme/library 1.0.0 in effect from its connected copy.
[Connected] Library: acme/library 1.0.0 in effect from its connected copy.
[Connected] Library is in effect.
app prints: library 1.0.0 + local change
[Connected] Library: Staging and Production now use the published acme/library 1.1.0.
[Connected] Library: acme/library 1.1.0 in effect from its connected copy.
tracked: requires 1.1.0, locks 1.1.0 from the zip registry
[Connected] Library is in effect.
proof refused: connected proof: Connected Library is not in effect: vendor/acme/library is not a link to the connected copy (an ordinary composer install puts the published package back); prepare the workspace again.
PASS composer
```

The first bump (1.1.0 declared, not yet in the registry) printed nothing and
left `composer.json` and `composer.lock` byte for byte as committed.

## Limitations

- `composer.json` usually omits `version` (Composer reads it from VCS tags).
  A copy that declares none has no version for Save to move to.
- The bump pins `composer.json` to exactly the published version
  (`composer require <package>:<version>`). A package required only through
  another package is reported and left at its locked version.
- `vendor/` is shared between normal and connected installs; an ordinary
  `composer install` replaces the link (the proof reports it).
- If the connected checkout's own requirements conflict with the app's lock,
  the partial update fails and preparation says so.
