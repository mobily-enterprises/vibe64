#!/bin/sh
# Builds tooling/connected.rs with the project's own Rust toolchain (std only,
# no Cargo project, so it never reads or writes a Cargo.lock) and runs it.
#   sh tooling/connected.sh prepare|verify <sourcesFile>
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
out="$here/../.development/tooling"
mkdir -p "$out"
if [ ! -x "$out/connected" ] || [ "$here/connected.rs" -nt "$out/connected" ]; then
  rustc --edition 2021 -O --crate-name connected -o "$out/connected" "$here/connected.rs"
fi
exec "$out/connected" "$@"
