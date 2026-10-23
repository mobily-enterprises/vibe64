import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { runVibe64Command } from "../runVibe64Command.js";
import {
  LOCAL_TOOLS,
  localToolFamily,
  localToolId,
  localToolInstall
} from "./localTools.js";
import { RUNTIME_PACKS, runtimePackRoot } from "./runtimePacks.js";

const CHECK_TIMEOUT_MS = 5_000;

// Finds the first listed command on the tool PATH and runs it with its version
// argument. A path is printed first so the row can say what was found. With
// "skip" set (macOS without Apple's command line tools), /usr/bin stubs are
// passed over instead of opening Apple's install dialog.
const PROBE_SCRIPT = [
  "skip=$1; version=$2; shift 2",
  "for name in \"$@\"; do",
  "  found=$(command -v -- \"$name\" 2>/dev/null) || continue",
  "  case $found in /*) ;; *) continue ;; esac",
  "  if [ -n \"$skip\" ]; then case $found in /usr/bin/*) continue ;; esac; fi",
  "  printf '%s\\n' \"$found\"",
  "  exec \"$found\" $version 2>&1",
  "done",
  "exit 127"
].join("\n");

function homeRelative(file = "", home = os.homedir()) {
  return home && file.startsWith(`${home}/`) ? `~/${file.slice(home.length + 1)}` : file;
}

function aptGetOnPath(env = process.env) {
  return [...String(env.PATH || "").split(path.delimiter), "/usr/bin"]
    .some((directory) => path.isAbsolute(directory) && existsSync(path.join(directory, "apt-get")));
}

/** This computer's install-line family: "apt", "brew" or "". */
function thisComputerToolFamily({ env = process.env, platform = process.platform } = {}) {
  return localToolFamily({ platform, aptGet: platform !== "darwin" && aptGetOnPath(env) });
}

function versionText(output = "") {
  const text = String(output || "");
  return /\d+\.\d+(?:\.\d+)?/u.exec(text)?.[0] || "";
}

async function probe(commands = [], { cwd, runCommand, runtimes, skipStubs, version = "--version" }) {
  const result = await runCommand({
    actor: "app",
    args: ["-c", PROBE_SCRIPT, "probe", skipStubs ? "1" : "", version, ...commands],
    command: "sh",
    cwd,
    mode: "capture",
    purpose: "health",
    runtimes,
    timeout: CHECK_TIMEOUT_MS
  });
  const [first = "", ...rest] = String(result?.output || "").split(/\r?\n/u);
  const found = path.isAbsolute(first.trim()) ? first.trim() : "";
  return { ok: result?.ok === true && Boolean(found), path: found, version: versionText(rest.join("\n")) };
}

/**
 * Whether each tool actually runs on the PATH projects use: a tool counts as
 * ready only when its command starts and answers its version within a few
 * seconds, never because a file exists. Checks run only for the ids asked
 * for, every time they are asked (so "Check again" sees a fresh install).
 * A host with runtime packs supplies its own tools, so nothing is checked.
 */
async function checkLocalTools(ids = [], {
  cwd = os.homedir(),
  env = process.env,
  platform = process.platform,
  runCommand = runVibe64Command
} = {}) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(localToolId))]
    .filter((id) => LOCAL_TOOLS[id]?.run);
  if (runtimePackRoot()) return { ok: true, managed: true, tools: [] };
  const family = thisComputerToolFamily({ env, platform });
  const options = { cwd, runCommand };
  const needsMise = wanted.some((id) => LOCAL_TOOLS[id].mise && !LOCAL_TOOLS[id].any && !LOCAL_TOOLS[id][family]);
  const [xcode, mise] = await Promise.all([
    platform === "darwin"
      ? runCommand({ actor: "app", args: ["-p"], command: "xcode-select", cwd, mode: "capture", purpose: "health",
          timeout: CHECK_TIMEOUT_MS }).then((result) => result?.ok === true)
      : true,
    needsMise ? probe(["mise"], { ...options, runtimes: [] }).then((result) => result.ok) : false
  ]);
  const tools = await Promise.all(wanted.map(async (id) => {
    const tool = LOCAL_TOOLS[id];
    const groups = await Promise.all(tool.run.map((commands) => probe(commands, {
      ...options, runtimes: Object.hasOwn(RUNTIME_PACKS, id) ? [id] : [], skipStubs: !xcode, version: tool.version
    })));
    const broken = groups.find((group) => !group.ok && group.path);
    const missing = groups.some((group) => !group.ok);
    const main = groups[0];
    const status = missing ? broken ? "broken" : "missing" : "ready";
    return {
      id,
      name: tool.name,
      status,
      path: homeRelative(broken?.path || main.path),
      version: status === "ready" ? main.version : "",
      detail: tool.detail || "",
      install: status === "ready" ? null : localToolInstall(id, { family, mise, xcode }),
      guideUrl: tool.guideUrl
    };
  }));
  return { ok: true, managed: false, tools };
}

export {
  checkLocalTools,
  thisComputerToolFamily
};
