#!/usr/bin/env sh
set -e

VIBE64_SESSION_SOURCE_ROOT="$VIBE64_SOURCE_ROOT"

for file in .env .env.development .env.development.local .env.local .env.production .env.production.local .env.test .env.test.local; do
  if [ -f "$VIBE64_TARGET_ROOT/$file" ] && [ ! -e "$VIBE64_SESSION_SOURCE_ROOT/$file" ]; then
    cp -p "$VIBE64_TARGET_ROOT/$file" "$VIBE64_SESSION_SOURCE_ROOT/$file"
  fi
done
