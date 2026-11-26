import path from "node:path";
import { resolveStudioAppRoot } from "@local/vibe64-core/server/studioRoots";
import { shellQuote } from "@local/vibe64-execution/server";

import { writeExecutableFileIfChanged } from "./writeExecutableFileIfChanged.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

// vibe64-helper's own groups, as its help lists them. A host's groups (helperCommandGroups.js) follow them there and
// never take one of these names.
const VIBE64_HELPER_GROUPS = Object.freeze([
  ["preview", "Preview lifecycle, opening a page in the Preview pane, browser inspection, screenshots and logs"],
  ["playwright", "Managed project browser test suites"],
  ["env", "Project environment settings"],
  ["staging", "Staging status, and how this session reaches staging itself (ssh staging)"],
  ["database", "Database refresh, overview and diagram operations, and where database tests run"],
  ["github", "GitHub view refresh"],
  ["pages", "Publish, update and list pages everyone on the project can open"],
  ["session", "Session status, Update, Save, setup retry, rename, and listing and messaging project sessions"],
  ["plan", "Read and maintain the current plan and archived plans"],
  ["training", "Validate, bundle and pin local teaching content"],
  ["spec", "Exact Vibe64 contracts: Stack sections and command protocols"]
]);
const VIBE64_HELPER_GROUP_NAMES = Object.freeze(VIBE64_HELPER_GROUPS.map(([name]) => name));
// The caller every host group shares, beside vibe64-helper in the session's wrapper directory.
const HELPER_GROUP_CLIENT_NAME = "vibe64-helper-group";

/** vibe64-helper's help: its own groups, then a host's. @param {{ name: string, summary: string }[]} hostGroups */
function helperUsage(hostGroups) {
  const lines = [...VIBE64_HELPER_GROUPS, ...hostGroups.map(({ name, summary }) => [name, summary])]
    .map(([name, summary]) => `  ${name.padEnd(12)} ${summary}`);
  return ["Usage: vibe64-helper <group> [arguments]", "", "Groups:", ...lines, "",
    "Use vibe64-helper <group> --help for that group.", "Commands use the current managed session and its access checks."].join("\n");
}

/**
 * Writes a session's vibe64 and vibe64-helper commands into its wrapper directory.
 * @param {{ wrapperHostDir?: string, env: RuntimeEnv, hostGroups?: { name: string, summary: string }[] }} options env
 *   locates the Studio app the commands run; hostGroups are a host's own groups, which run through its caller
 *   (HELPER_GROUP_CLIENT_NAME, written with the session command)
 */
async function prepareAgentHelperCommand({ wrapperHostDir = "", env, hostGroups = [] }) {
  const directory = String(wrapperHostDir || "").trim();
  if (!directory) {
    return { ok: false };
  }
  const run = `exec ${shellQuote(process.execPath)} ${shellQuote(path.join(resolveStudioAppRoot({ env }), "bin", "run.js"))}`;
  await writeExecutableFileIfChanged(path.join(directory, "vibe64"), `#!/bin/sh
if [ "\${1-}" = spec ]; then
  shift
  ${run} spec "$@"
fi
if [ "\${1-}" != training ]; then
  printf '%s\\n' 'Use vibe64 spec, or vibe64 training validate, bundle or publish-manifest, in this session.' >&2
  exit 2
fi
shift
case "\${1-}" in
  ""|-h|--help)
    printf '%s\\n' 'Usage: vibe64 training validate <topic-directory>
       vibe64 training bundle <topic-directory> <new-output-directory>
       vibe64 training publish-manifest <course.json> <committed-topic-directory...>
Content format: vibe64-helper spec training-content'
    exit 0
    ;;
  validate|bundle|publish-manifest) ;;
  *)
    printf '%s\\n' 'Only training validate, bundle and publish-manifest are available in this session.' >&2
    exit 2
    ;;
esac
${run} training "$@"
`);
  await writeExecutableFileIfChanged(path.join(directory, "vibe64-helper"), `#!/bin/sh
case "\${1-}" in
  ""|-h|--help)
    printf '%s\\n' ${shellQuote(helperUsage(hostGroups))}
    exit 0
    ;;
  ${VIBE64_HELPER_GROUP_NAMES.join("|")})
    command_group=$1
    shift
    ;;
${hostGroups.length ? `  ${hostGroups.map(({ name }) => name).join("|")})
    case "$0" in */*) exec "\${0%/*}/${HELPER_GROUP_CLIENT_NAME}" "$@" ;; esac
    exec ./${HELPER_GROUP_CLIENT_NAME} "$@"
    ;;
` : ""}  *)
    printf '%s\\n' 'Unknown Vibe64 helper group. Use vibe64-helper --help.' >&2
    exit 2
    ;;
esac
case "$0" in
  */*) wrapper_dir=\${0%/*} ;;
  *) wrapper_dir=. ;;
esac
command_path="$wrapper_dir/vibe64-$command_group"
if [ "$command_group" = staging ]; then
  command_path="$wrapper_dir/vibe64-env"
  set -- staging "$@"
fi
if [ "$command_group" = training ] || [ "$command_group" = spec ]; then
  exec "$wrapper_dir/vibe64" "$command_group" "$@"
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
  HELPER_GROUP_CLIENT_NAME,
  VIBE64_HELPER_GROUP_NAMES,
  prepareAgentHelperCommand
};
