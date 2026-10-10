import path from "node:path";
import { resolveStudioAppRoot } from "@local/vibe64-core/server/studioRoots";
import { shellQuote } from "@local/vibe64-execution/server";

import { writeExecutableFileIfChanged } from "./writeExecutableFileIfChanged.js";

async function prepareAgentHelperCommand({ wrapperHostDir = "", env = process.env } = {}) {
  const directory = String(wrapperHostDir || "").trim();
  if (!directory) {
    return { ok: false };
  }
  await writeExecutableFileIfChanged(path.join(directory, "vibe64"), `#!/bin/sh
if [ "\${1-}" != training ]; then
  printf '%s\\n' 'Use vibe64 training validate, bundle or publish-manifest in this session.' >&2
  exit 2
fi
shift
case "\${1-}" in
  ""|-h|--help)
    printf '%s\\n' 'Usage: vibe64 training validate <topic-directory>
       vibe64 training bundle <topic-directory> <new-output-directory>
       vibe64 training publish-manifest <course.json> <committed-topic-directory...>'
    exit 0
    ;;
  validate|bundle|publish-manifest) ;;
  *)
    printf '%s\\n' 'Only training validate, bundle and publish-manifest are available in this session.' >&2
    exit 2
    ;;
esac
exec ${shellQuote(process.execPath)} ${shellQuote(path.join(resolveStudioAppRoot({ env }), "bin", "run.js"))} training "$@"
`);
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
  session      Current environment/setup/tool summary and session rename
  plan         Read and maintain the current plan and archived plans
  training     Validate, bundle and pin local teaching content

Use vibe64-helper <group> --help for that group.
Commands use the current managed session and its access checks.'
    exit 0
    ;;
  preview|playwright|env|database|github|session|plan|training)
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
if [ "$command_group" = training ]; then
  exec "$wrapper_dir/vibe64" training "$@"
fi
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
