# Connected development: Composer (PHP)

Proves that a consuming PHP app can use an unpublished local checkout of a
Composer library during connected development, without touching its tracked
`composer.json` or `composer.lock`.

## Layout

- `library/` — `acme/library` 1.0.0; `Acme\Library\Marker::value()` returns the
  marker string `library 1.0.0`.
- `app/` — `acme/app`, requiring `acme/library: ^1.0`. Its tracked
  `composer.lock` is the published-style lock (locked `acme/library` 1.0.0 from
  a zip dist URL on a registry; the URL is `.invalid` because this fixture
  never installs the published copy). `bin/app.php` prints the marker.
  - `tooling/connected.php` — `prepare <sourcesFile>` / `verify <sourcesFile>`
    in plain PHP, no Node.
  - `genesis/stack.md` — the `## Connected development` section.
  - `.gitignore` — `vendor/`, `.development/`, `composer.connected.json`,
    `composer.connected.lock`.
- `prove.sh` — the reproducible acceptance run.

## Native mechanism

Composer's [`path` repository](https://getcomposer.org/doc/05-repositories.md#path)
combined with the [`COMPOSER` environment variable](https://getcomposer.org/doc/03-cli.md#composer).

`prepare`:

1. Reads the sources map and, for each `type: composer` project, its
   `sourceRoot/composer.json` (for the package name).
2. Writes the untracked derived manifest `composer.connected.json`: the
   tracked `composer.json` plus, first in `repositories`, one entry per source:
   ```json
   {"type": "path", "url": "<sourceRoot>",
    "options": {"symlink": true, "versions": {"acme/library": "1.0.0"}}}
   ```
   `symlink: true` makes `vendor/acme/library` a symlink to the checkout, so
   edits are live without reinstalling. `versions` presents the checkout under
   the version the app has locked (or the library's declared `version`):
   a real checkout on a branch would otherwise appear as `dev-<branch>` and not
   satisfy `^1.0`. Path repositories are canonical, so they win over Packagist.
3. Copies the tracked `composer.lock` to `composer.connected.lock`, then runs
   `COMPOSER=composer.connected.json composer update --no-interaction --no-progress acme/library`
   — a partial update, so every other dependency keeps its tracked locked
   version and only the connected packages are re-resolved. (Without a
   tracked lock it runs a full `composer update`.)

Composer names the lock file after the manifest (`composer.connected.lock`),
so the tracked `composer.json` and `composer.lock` are never written. The
derived files and `vendor/` are git-ignored.

`verify` loads `vendor/autoload.php` and proves for each connected package:
`Composer\InstalledVersions::getInstallPath()` resolves to `sourceRoot`,
`vendor/<name>` is a symlink to `sourceRoot`, the derived lock locks it with
`dist.type = path` and `url = sourceRoot`, and `git status` reports the tracked
`composer.json`/`composer.lock` unmodified. It fails if any of these is false,
including when the sources map points at a different checkout than the one
prepared.

The app runs exactly as normal (`php bin/app.php`): it uses the shared
`vendor/` directory prepared from the derived manifest.

## Commands

```
php tooling/connected.php prepare .development/connected.json
php tooling/connected.php verify  .development/connected.json
php bin/app.php
```

`./prove.sh` copies `library/` and `app/` to a fresh temporary directory,
commits the app, changes the library copy's marker, writes the sources map,
runs prepare twice, verify, the app (asserting the changed marker), checks
that `composer.json`/`composer.lock` hashes are unchanged and
`git status --porcelain` is empty, and removes the directory.

## Network

None. `prove.sh` sets `COMPOSER_DISABLE_NETWORK=1` (and `COMPOSER_NO_AUDIT=1`,
since the security audit needs Packagist) with `COMPOSER_HOME` and
`COMPOSER_CACHE_DIR` inside the temporary directory. In a real app the
partial update keeps the other dependencies at their locked versions; they
still need Composer's normal download/cache to be installed in the first place.

## Tool versions

PHP 8.3.6, Composer 2.7.1, Git 2.43.0. Path repository `options.versions`
needs Composer 2.x.

## Limitations

- Prepare re-copies the tracked lock each run, so Composer always reports the
  connected package as "Upgrading 1.0.0 => 1.0.0 <hash>" in the lock; the
  install itself is a no-op on the second run. Result is deterministic.
- `vendor/` is shared between normal and connected installs. Leaving connected
  mode requires a normal `composer install` to replace the symlink.
- If the connected checkout's own requirements conflict with the app's lock,
  the partial update fails; add `--with-dependencies` if the project wants the
  connected package's dependencies re-resolved too.
- Symlinks need a filesystem that supports them; Composer falls back to
  copying otherwise (`symlink: true` makes that fallback an error instead).

## Composition relationship

When the connected repository is a Composer package that is part of the app
(a module, plugin or theme installed through Composer, e.g. via
`composer/installers` into a custom directory), the same path repository
mechanism applies unchanged. When it is raw source composed into the app tree
without being a Composer package, Composer has no native mechanism; the
project's script needs custom treatment (for example linking the checkout into
the expected directory). This fixture proves only the `dependency` case.

## Transcript (second from-scratch run, temp path shortened to `$WORK`)

```
+ COMPOSER=composer.connected.json composer update --no-interaction --no-progress acme/library
Loading composer repositories with package information
Updating dependencies
Lock file operations: 0 installs, 1 update, 0 removals
  - Upgrading acme/library (1.0.0 => 1.0.0 36a7122)
Writing lock file
Installing dependencies from lock file (including require-dev)
Package operations: 1 install, 0 updates, 0 removals
  - Installing acme/library (1.0.0): Symlinking from $WORK/library
Generating autoload files
+ COMPOSER=composer.connected.json composer update --no-interaction --no-progress acme/library
...
Nothing to install, update or remove
Generating autoload files
verified acme/library 1.0.0 -> $WORK/library
app prints: library 1.0.0 + local change
PASS composer
```
