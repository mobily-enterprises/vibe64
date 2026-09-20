import path from "node:path";

import { writeExecutableFileIfChanged } from "./writeExecutableFileIfChanged.js";

async function prepareAgentHelperCommand({ wrapperHostDir = "" } = {}) {
  const directory = String(wrapperHostDir || "").trim();
  if (!directory) {
    return { ok: false };
  }
  await writeExecutableFileIfChanged(path.join(directory, "vibe64-helper"), `#!/bin/sh
case "\${1-}" in
  ""|-h|--help)
    printf '%s\\n' 'Usage: vibe64-helper <group> [arguments]

Groups:
  preview      Preview lifecycle, browser inspection, screenshots and logs
  playwright   Managed project browser test suites
  env          Project environment settings
  database     Database refresh, overview and diagram operations
  github       GitHub view refresh

Use vibe64-helper <group> --help for that group.
Commands use the current managed session and its access checks.'
    exit 0
    ;;
  preview|playwright|env|database|github)
    command_group=$1
    shift
    ;;
  *)
    printf '%s\\n' 'Unknown Vibe64 helper group. Use vibe64-helper --help.' >&2
    exit 2
    ;;
esac
case "$0" in
  */*) wrapper_dir=\${0%/*} ;;
  *) wrapper_dir=. ;;
esac
command_path="$wrapper_dir/vibe64-$command_group"
if [ ! -x "$command_path" ]; then
  printf '%s\\n' "Vibe64 helper $command_group is unavailable in this session." >&2
  exit 127
fi
exec "$command_path" "$@"
`);
  return { ok: true };
}

export {
  prepareAgentHelperCommand
};
