#!/usr/bin/env bash
# Runs every connected-development proof whose toolchain is installed.
# Usage: run-all.sh [type...]   (default: every directory with a prove.sh)
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
declare -A needs=(
  [npm]="node npm tar git" [composer]="node git php composer" [pip]="node git python3" [bundler]="node git ruby bundle"
  [gomod]="node git go zip" [cargo]="node git cargo rustc" [maven]="node git java mvn" [gradle]="node git java javac gradle"
  [nuget]="node git dotnet" [custom-cmake]="cmake c++ git"
)
types=("$@")
[ ${#types[@]} -gt 0 ] || for d in "$here"/*/prove.sh; do types+=("$(basename "$(dirname "$d")")"); done
failed=0
for type in "${types[@]}"; do
  missing=""
  for tool in ${needs[$type]:-}; do command -v "$tool" >/dev/null || missing="$missing $tool"; done
  if [ -n "$missing" ]; then echo "SKIP $type (missing:$missing)"; continue; fi
  if bash "$here/$type/prove.sh" > "${TMPDIR:-/tmp}/connected-$type.log" 2>&1; then
    echo "PASS $type"
  else
    echo "FAIL $type (log: ${TMPDIR:-/tmp}/connected-$type.log)"; failed=1
  fi
done
exit $failed
