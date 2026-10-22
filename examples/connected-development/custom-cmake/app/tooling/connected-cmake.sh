#!/usr/bin/env bash
# Vibe64 custom connected-development script for CMake FetchContent.
#
# Invoked by Vibe64 once per custom connection and phase:
#   bash tooling/connected-cmake.sh --phase prepare|verify --source-root DIR \
#     --project-root DIR --sources-file FILE --repository URL
#
# prepare: configure the untracked build tree .development/connected/build with
#          FETCHCONTENT_SOURCE_DIR_<NAME>=<source root>, so FetchContent uses the
#          connected checkout instead of downloading the pinned tag. Idempotent.
# verify:  build and prove from CMake's own compilation database that the
#          dependency's sources were compiled from the connected checkout, and
#          that no tracked file of the consuming project changed.
set -euo pipefail

die() { echo "connected-cmake: $*" >&2; exit 1; }

phase="" source_root="" project_root="" sources_file="" repository=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase) phase="${2-}"; shift 2 ;;
    --source-root) source_root="${2-}"; shift 2 ;;
    --project-root) project_root="${2-}"; shift 2 ;;
    --sources-file) sources_file="${2-}"; shift 2 ;;
    --repository) repository="${2-}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ "$phase" == prepare || "$phase" == verify ]] || die "--phase must be prepare or verify"
[[ -d "$source_root" ]] || die "--source-root is not a directory: $source_root"
[[ -f "$project_root/CMakeLists.txt" ]] || die "--project-root has no CMakeLists.txt: $project_root"
[[ -f "$sources_file" ]] || die "--sources-file does not exist: $sources_file"
[[ -n "$repository" ]] || die "--repository is required"

# Map each connected repository to the FetchContent dependency it replaces.
# Unknown repositories fail: a connection must have an explicit native target.
repo_key="$(printf '%s' "$repository" | tr '[:upper:]' '[:lower:]' | sed -E 's#\.git/?$##; s#/$##')"
case "$repo_key" in
  https://github.com/acme/example-library) content_name="example_library" ;;
  *) die "no FetchContent dependency is mapped for $repository" ;;
esac
upper_name="$(printf '%s' "$content_name" | tr '[:lower:]' '[:upper:]')"

source_root="$(cd "$source_root" && pwd -P)"
project_root="$(cd "$project_root" && pwd -P)"
build_dir="$project_root/.development/connected/build"

case "$phase" in
  prepare)
    # Cache entries accumulate, so several custom connections can configure the
    # same build tree one after another.
    cmake -S "$project_root" -B "$build_dir" \
      -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
      "-DFETCHCONTENT_SOURCE_DIR_${upper_name}=${source_root}" >/dev/null
    echo "connected-cmake: $content_name -> $source_root (build tree $build_dir)"
    ;;
  verify)
    [[ -f "$build_dir/CMakeCache.txt" ]] || die "run prepare first: $build_dir is not configured"
    cached="$(sed -n "s#^FETCHCONTENT_SOURCE_DIR_${upper_name}:[A-Z]*=##p" "$build_dir/CMakeCache.txt")"
    [[ "$cached" == "$source_root" ]] || die "build tree uses '$cached', expected $source_root"
    cmake --build "$build_dir" >/dev/null
    # Proof: CMake's compilation database lists the translation units actually
    # compiled. At least one must live in the connected checkout, and none may
    # come from a downloaded copy under _deps/<name>-src.
    python3 -I - "$build_dir/compile_commands.json" "$source_root" "$content_name" <<'PY'
import json, os, sys
db, root, name = sys.argv[1], os.path.realpath(sys.argv[2]), sys.argv[3]
files = [os.path.realpath(os.path.join(e["directory"], e["file"])) for e in json.load(open(db))]
connected = [f for f in files if os.path.commonpath([f, root]) == root]
downloaded = [f for f in files if f"/_deps/{name}-src/" in f]
if not connected or downloaded:
    sys.exit(f"connected-cmake: not proven; connected={connected} downloaded={downloaded}")
print(f"connected-cmake: compiled from connected checkout: {', '.join(connected)}")
PY
    if git -C "$project_root" rev-parse --git-dir >/dev/null 2>&1; then
      changed="$(git -C "$project_root" status --porcelain --untracked-files=no)"
      [[ -z "$changed" ]] || die "tracked files changed:"$'\n'"$changed"
    fi
    echo "connected-cmake: verified $repository"
    ;;
esac
