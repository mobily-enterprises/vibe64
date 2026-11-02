import {
  OPERATOR_CLIS,
  operatorCliInstall,
  resolveOperatorCli
} from "@local/vibe64-execution/server";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

/**
 * Plain words in the terminal, and only when no AI tool runs Vibe64 at all:
 * one tool is enough, so a missing second one is not worth a warning.
 * @param {RuntimeEnv} env the server's environment, where the tools are looked up
 * @param {(text: string) => void} [write]
 */
function warnMissingOperatorClis(env, write = (line) => process.stderr.write(`${line}\n`)) {
  if (Object.keys(OPERATOR_CLIS).some((tool) => resolveOperatorCli(tool, { env }).installed)) return;
  write([
    "No AI tool is installed on this computer yet. Vibe64 needs one.",
    `To install Claude Code, run: ${operatorCliInstall("claude")}`,
    "Codex and opencode work too: open Vibe64 and choose AI setup."
  ].join("\n"));
}

export { warnMissingOperatorClis };
