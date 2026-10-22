# Connected development: Bundler (Ruby)

Proves that a consuming Ruby app can use an unpublished local checkout of a
gem during connected development, without touching its tracked `Gemfile` or
`Gemfile.lock`.

## Layout

- `library/` — gem `acme_library` 1.0.0 (`acme_library.gemspec`,
  `AcmeLibrary.marker` returns `library 1.0.0`).
- `app/` — tracked `Gemfile` (`source "https://rubygems.org"`,
  `gem "acme_library", "~> 1.0"`) and the published-style `Gemfile.lock`
  (acme_library 1.0.0 from rubygems.org). `app.rb` requires `bundler/setup`
  and prints the marker.
  - `tooling/connected.rb` — `prepare <sourcesFile>` / `verify <sourcesFile>`,
    Ruby standard library only, no Node.
  - `genesis/stack.md` — the `## Connected development` section.
  - `.gitignore` — `.development/`, `Gemfile.connected`,
    `Gemfile.connected.lock`, `.bundle/`, `vendor/bundle/`.
- `prove.sh` — the reproducible acceptance run.

## Native mechanism

A derived Gemfile selected with Bundler's `gemfile` setting
(`BUNDLE_GEMFILE`, see [bundle config](https://bundler.io/man/bundle-config.1.html)),
which `eval_gemfile`s the tracked Gemfile and gives each connected gem a
[`path:` source](https://bundler.io/guides/gemfile.html).

`prepare`:

1. Reads the sources map and, for each `type: bundler` (also `gem`/`ruby`)
   project, the gem name from the checkout's single `*.gemspec`.
2. Writes the untracked `Gemfile.connected`. It overrides the DSL's `gem`
   method for connected names only (dropping any `git:`/`github:`/`source:`
   options and adding `path: <sourceRoot>`), then
   `eval_gemfile File.expand_path("Gemfile", __dir__)`. Connected gems the
   Gemfile does not declare directly (transitive dependencies) are added with
   `path:` afterwards. Declaring the gem a second time instead would fail:
   Bundler rejects the same gem from two different sources.
3. Copies the tracked `Gemfile.lock` to `Gemfile.connected.lock` (Bundler names
   the lock after the Gemfile), so every other gem keeps its locked version and
   only the connected gems move to a `PATH` source.
4. `bundle config set --local gemfile Gemfile.connected` (writes the
   git-ignored `.bundle/config`) and
   `BUNDLE_GEMFILE=<app>/Gemfile.connected bundle install --quiet`.

The tracked `Gemfile` and `Gemfile.lock` are only read.

`verify` checks that `Gemfile.connected.lock` has a `PATH` section whose
`remote` is `sourceRoot`, then runs a probe with `bundle exec ruby` and no
`BUNDLE_GEMFILE` in the environment (the app's normal launch): Bundler must be
using `Gemfile.connected`, the gem's spec must come from a
`Bundler::Source::Path` whose `full_gem_path` is `sourceRoot`, and requiring
it must load files from inside `sourceRoot`. Finally `git status` must report
`Gemfile`/`Gemfile.lock` unmodified.

### Why not `bundle config local.<gem>`

Bundler's local git override only applies to gems declared with a `git:`
source and a `branch:` in the Gemfile, and it checks the checkout's branch
and revision against the lock. Gems from rubygems.org (the normal published
case here) cannot use it, so it is not a general connected mechanism. It is a
valid alternative only for apps that already depend on the gem via `git:`.

## Running the app

`bundle exec ruby app.rb` (and any `bundle ...` command) honours the local
`gemfile` setting, and `bundle exec` exports `BUNDLE_GEMFILE` to the child, so
Rails-style binstubs (`ENV["BUNDLE_GEMFILE"] ||= ...`) also follow it.

**Limitation:** a launch that does not go through the `bundle` command —
plain `ruby app.rb` with `require "bundler/setup"` — ignores `.bundle/config`'s
`gemfile` setting and uses the tracked `Gemfile`/`Gemfile.lock`. Such launches
must export `BUNDLE_GEMFILE=Gemfile.connected` (or run under `bundle exec`).
`prove.sh` demonstrates all three: `bundle exec` and explicit `BUNDLE_GEMFILE`
print the changed marker; plain `ruby app.rb` uses the tracked lock (here it
fails with `GemNotFound` because the published gem is not installed offline).

## Commands

```
ruby tooling/connected.rb prepare .development/connected.json
ruby tooling/connected.rb verify  .development/connected.json
bundle exec ruby app.rb
```

`./prove.sh` copies `library/` and `app/` to a fresh temporary directory,
commits the app, changes the library copy's marker, writes the sources map,
runs prepare twice, verify, the app via `bundle exec` and via explicit
`BUNDLE_GEMFILE` (asserting the changed marker), checks that the
`Gemfile`/`Gemfile.lock` hashes are unchanged and `git status --porcelain` is
empty, and removes the directory.

## Network

None. `prove.sh` keeps `GEM_HOME`, `BUNDLE_PATH` and `BUNDLE_USER_HOME` in the
temporary directory and points every HTTP(S) proxy at a closed local port, so
any rubygems.org access would fail. Bundler resolves a lock whose only gem is
a path gem without contacting the remote. In a real app the other locked gems
still come from rubygems.org (or the local gem cache) on first install.

## Tool versions

Ruby 3.2.3, Bundler 2.6.9, RubyGems 3.4.20, Git 2.43.0.

## Limitations

- See "Running the app": non-`bundle` launches need `BUNDLE_GEMFILE`.
- Leaving connected mode: `bundle config unset --local gemfile`.
- Frozen/deployment mode (`BUNDLE_FROZEN`/`BUNDLE_DEPLOYMENT`) refuses the
  changed derived lock; connected development must not run frozen.
- The connected gem's version must satisfy the Gemfile requirement.
- Path gems evaluate their gemspec from the checkout, so gemspecs using
  `git ls-files` need the checkout to be a Git work tree.

## Composition relationship

If the composed repository is itself a gem (an engine or plugin), the same
`path:` override applies. If it is raw source composed into the app tree
(not a gem), Bundler has no native mechanism; the project's script needs
custom treatment. This fixture proves only the `dependency` case.

## Transcript (second from-scratch run, temp path shortened to `$WORK`)

```
+ bundle config set --local gemfile Gemfile.connected
+ BUNDLE_GEMFILE=$WORK/app/Gemfile.connected bundle install --quiet
+ bundle config set --local gemfile Gemfile.connected
+ BUNDLE_GEMFILE=$WORK/app/Gemfile.connected bundle install --quiet
+ bundle exec ruby -e <bundler probe> acme_library $WORK/library
verified acme_library 1.0.0 path -> $WORK/library (1 file(s) loaded)
bundle exec ruby app.rb prints: library 1.0.0 + local change
BUNDLE_GEMFILE=Gemfile.connected ruby app.rb prints: library 1.0.0 + local change
plain ruby app.rb (limitation) uses the tracked lock: /var/lib/gems/3.2.0/gems/bundler-2.6.9/lib/bundler/definition.rb:691:in `materialize': Could not find acme_library-1.0.0 in locally installed gems (Bundler::GemNotFound)
PASS bundler
```
