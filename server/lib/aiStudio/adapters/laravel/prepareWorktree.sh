#!/usr/bin/env sh
set -e

for file in .env .env.testing; do
  if [ -f "$AI_STUDIO_TARGET_ROOT/$file" ] && [ ! -e "$AI_STUDIO_WORKTREE_PATH/$file" ]; then
    cp -p "$AI_STUDIO_TARGET_ROOT/$file" "$AI_STUDIO_WORKTREE_PATH/$file"
  fi
done
