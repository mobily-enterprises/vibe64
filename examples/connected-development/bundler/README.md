# Connected development: Bundler (Ruby)

Proves Vibe64's own `bundler` treatment: a consuming Ruby app uses an
unpublished local checkout of a gem during connected development, without
touching its tracked `Gemfile` or `Gemfile.lock`.

## Layout

- `library/` — gem `acme_library` 1.0.0 (`acme_library.gemspec`,
  `AcmeLibrary.marker` returns `library 1.0.0`).
- `app/` — tracked `Gemfile` (`source "https://rubygems.org"`,
  `gem "acme_library", "~> 1.0"`) and the published-style `Gemfile.lock`
  (acme_library 1.0.0 from rubygems.org). `app.rb` requires `bundler/setup`
  and prints the marker.
  - `genesis/stack.md` — `## Connected development` with only
    `- Default package type: bundler`. No project commands: Vibe64 prepares
    and proves the connection itself.
  - `.gitignore` — `.development/`, `Gemfile.connected`,
    `Gemfile.connected.lock`, `.bundle/`, `vendor/bundle/`.
- `prove.sh` — the reproducible acceptance run. It calls Vibe64's adapter
  through `../vibe64-adapter.mjs` (`apply`, `proof`), as workspace preparation
  does.

## Vibe64's treatment

`packages/vibe64-project/src/server/connectedAdapters/bundler.js`: a derived
Gemfile selected with Bundler's `gemfile` setting
(`BUNDLE_GEMFILE`, see [bundle config](https://bundler.io/man/bundle-config.1.html)),
which `eval_gemfile`s the tracked Gemfile and gives each connected gem a
[`path:` source](https://bundler.io/guides/gemfile.html).

Apply (after the project's own Workspace setup):

1. Takes each connected copy's single `*.gemspec` (named after its gem, which
   Ruby confirms by loading it) and refuses a gem the tracked `Gemfile.lock`
   does not use.
2. Writes the untracked `Gemfile.connected`. It overrides the DSL's `gem`
   method for connected names only (dropping any `git:`/`github:`/`source:`
   options and adding `path: <connected copy>`), then
   `eval_gemfile File.expand_path('Gemfile', __dir__)`. Connected gems the
   Gemfile does not declare directly (dependencies of gems it does) are added
   with `path:` afterwards.
3. Copies the tracked `Gemfile.lock` to `Gemfile.connected.lock` (Bundler names
   the lock after the Gemfile), so every other gem keeps its locked version.
4. Refuses a tracked `.bundle/config`, keeps `Gemfile.connected`,
   `Gemfile.connected.lock` and `.bundle/config` out of Git
   (`.git/info/exclude`), runs `bundle config set --local gemfile Gemfile.connected`
   and `BUNDLE_GEMFILE=<app>/Gemfile.connected bundle install --quiet`.

A path gem loads the copy in place, so saved files are live without a watcher.

Proof (after the project's own Verify steps, and in session status from files
alone): `Gemfile.connected` matches the copies now, `Gemfile.connected.lock`
has a `PATH` section for the gem at its copy, `.bundle/config` selects
`Gemfile.connected`, and (in preparation) a `bundle exec ruby` probe with the
app's normal launch shows Bundler using `Gemfile.connected`, the gem coming from
a path source at the copy, and its lib folders on the load path. Each failure
says which, for example after `bundle config unset --local gemfile`:
`.bundle/config does not select Gemfile.connected, so bundle exec uses the published acme_library; prepare the workspace again.`

Save (`bump`): when the copy declares a version (a literal `spec.version` or
`lib/<gem>/version.rb`) that differs from the tracked lock's, Vibe64 pins the
Gemfile's own declaration of the gem to exactly that version in a Gemfile
beside the tracked one, and runs `bundle lock --update <gem>` against it (never
reading the derived Gemfile). Only when Bundler locks exactly that version from
the Gemfile's sources does it replace the tracked `Gemfile` and `Gemfile.lock`,
then applies the connection again on top. An unpublished version moves
nothing; a source that cannot be checked is reported. Staging and Production
install from the tracked files only.

When the connection goes, Vibe64 removes the derived files and the `gemfile`
setting, keeping the project's other local settings.

## Running the app

`bundle exec ruby app.rb` (and any `bundle ...` command) honours the local
`gemfile` setting, and `bundle exec` exports `BUNDLE_GEMFILE` to the child, so
Rails-style binstubs (`ENV["BUNDLE_GEMFILE"] ||= ...`) also follow it.

**Limitation:** a launch that does not go through the `bundle` command —
plain `ruby app.rb` with `require "bundler/setup"` — ignores `.bundle/config`'s
`gemfile` setting and uses the tracked `Gemfile`/`Gemfile.lock`. Such launches
must export `BUNDLE_GEMFILE=Gemfile.connected` (or run under `bundle exec`).
`prove.sh` demonstrates all three.

## Commands

```
node ../vibe64-adapter.mjs apply .development/connected.json
node ../vibe64-adapter.mjs proof .development/connected.json
bundle exec ruby app.rb
```

`./prove.sh` copies `library/` and `app/` to a fresh temporary directory,
commits the app, changes the library copy's marker, writes the sources map,
applies twice, proves, runs the app via `bundle exec` and via explicit
`BUNDLE_GEMFILE` (asserting the changed marker), checks the tracked hashes and
`git status --porcelain`, then unsets the local `gemfile` setting and shows the
proof refusing.

## Network

None. `prove.sh` keeps `GEM_HOME`, `BUNDLE_PATH` and `BUNDLE_USER_HOME` in the
temporary directory and points every HTTP(S) proxy at a closed local port, so
any rubygems.org access would fail. Bundler resolves a lock whose only gem is
a path gem without contacting the remote. The Save bump needs a gem source to
check, so it is proved with a stand-in for Bundler
(`tests/server/vibe64ConnectedBundlerAdapter.unit.test.js`), not here.

## Evidence

Run `cad-phpruby-3` on usone (2026-11-23), through Nix: Ruby 3.4.12,
Bundler 2.6.9, Git 2.53.0, Node v26.5.0. 3 s. (Ruby's "already initialized
constant Gem::Platform" warnings are left out.)

```
[Connected] Library is in effect.
bundle exec ruby app.rb prints: library 1.0.0 + local change
BUNDLE_GEMFILE=Gemfile.connected ruby app.rb prints: library 1.0.0 + local change
plain ruby app.rb (limitation) uses the tracked lock: …/bundler/definition.rb:691:in 'Bundler::Definition#materialize': Could not find acme_library-1.0.0 in locally installed gems (Bundler::GemNotFound)
proof refused: connected proof: Connected Library is not in effect: .bundle/config does not select Gemfile.connected, so bundle exec uses the published acme_library; prepare the workspace again.
PASS bundler
```

## Limitations

- See "Running the app": non-`bundle` launches need `BUNDLE_GEMFILE`.
- Frozen/deployment mode (`BUNDLE_FROZEN`/`BUNDLE_DEPLOYMENT`) refuses the
  changed derived lock; connected development must not run frozen.
- The connected gem's version must satisfy the Gemfile requirement.
- The bump pins the Gemfile's declaration to exactly the published version; a
  gem the Gemfile does not declare itself is reported and left at its locked
  version.
- Path gems evaluate their gemspec from the checkout, so gemspecs using
  `git ls-files` need the checkout to be a Git work tree.

## Composition relationship

If the composed repository is itself a gem (an engine or plugin), the same
`path:` override applies. If it is raw source composed into the app tree
(not a gem), Bundler has no native mechanism; the project's script needs
custom treatment. This fixture proves only the `dependency` case.
