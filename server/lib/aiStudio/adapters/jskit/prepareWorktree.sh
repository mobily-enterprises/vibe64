#!/usr/bin/env sh
set -e

if [ -f "$AI_STUDIO_TARGET_ROOT/.env" ] && [ ! -e "$AI_STUDIO_WORKTREE_PATH/.env" ]; then
  cp -p "$AI_STUDIO_TARGET_ROOT/.env" "$AI_STUDIO_WORKTREE_PATH/.env"
fi
