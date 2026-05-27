#!/usr/bin/env sh
set -e

if [ -f "$VIBE64_TARGET_ROOT/.env" ] && [ ! -e "$VIBE64_WORKTREE_PATH/.env" ]; then
  cp -p "$VIBE64_TARGET_ROOT/.env" "$VIBE64_WORKTREE_PATH/.env"
fi
