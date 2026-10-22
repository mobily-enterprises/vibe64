#!/usr/bin/env bash
# Proves the Bundler connected-development recipe from scratch, offline.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
# Gem and Bundler state stay in the throwaway directory. Every proxy points at
# a closed local port, so any attempt to reach rubygems.org fails: the
# connected gem must come from its local checkout only.
export GEM_HOME="$work/gems" BUNDLE_USER_HOME="$work/bundle-home" BUNDLE_PATH="$work/gems"
export http_proxy=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9
unset BUNDLE_GEMFILE RUBYOPT
cp -R "$here/library" "$work/library"; cp -R "$here/app" "$work/app"
cd "$work/app"
git init -q && git add -A && git -c user.name=proof -c user.email=proof@example.com commit -qm baseline
before="$(sha256sum Gemfile Gemfile.lock)"
# Simulate an unpublished local change in the connected checkout.
sed -i 's/"library 1.0.0"/"library 1.0.0 + local change"/' "$work/library/lib/acme_library.rb"
mkdir -p .development
printf '{"contract":"vibe64.connected-sources.v1","sessionId":"proof","projects":[{"name":"Library","repository":"https://github.com/example/library","relationship":"dependency","type":"bundler","sourceRoot":"%s","contributionId":"proof"}]}\n' "$work/library" > .development/connected.json
ruby tooling/connected.rb prepare .development/connected.json
ruby tooling/connected.rb prepare .development/connected.json
ruby tooling/connected.rb verify .development/connected.json
# Run the app through Bundler as normal: `bundle exec` reads the local
# `gemfile` setting written by prepare.
out="$(bundle exec ruby app.rb)"; echo "bundle exec ruby app.rb prints: $out"
[ "$out" = "library 1.0.0 + local change" ] || { echo "FAIL: bundle exec did not use the connected source"; exit 1; }
# A launch outside the bundle CLI selects the derived Gemfile explicitly.
out="$(BUNDLE_GEMFILE="$PWD/Gemfile.connected" ruby app.rb)"; echo "BUNDLE_GEMFILE=Gemfile.connected ruby app.rb prints: $out"
[ "$out" = "library 1.0.0 + local change" ] || { echo "FAIL: BUNDLE_GEMFILE launch did not use the connected source"; exit 1; }
# Documented limitation: plain `ruby app.rb` ignores .bundle/config's gemfile
# and uses the tracked Gemfile.lock (the published gem, not installed here).
if out="$(ruby app.rb 2>&1)"; then echo "plain ruby app.rb (limitation) prints: $out"; else echo "plain ruby app.rb (limitation) uses the tracked lock: $(printf '%s\n' "$out" | head -1)"; fi
[ "$before" = "$(sha256sum Gemfile Gemfile.lock)" ] || { echo "FAIL: tracked Gemfile/Gemfile.lock changed"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "FAIL: working tree not clean:"; git status --porcelain; exit 1; }
echo "PASS bundler"
