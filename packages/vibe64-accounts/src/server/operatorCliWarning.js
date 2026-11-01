import {
  OPERATOR_CLIS,
  operatorCliInstall,
  resolveOperatorCli
} from "@local/vibe64-execution/server";

/**
 * Plain words in the terminal, and only when no AI tool runs Vibe64 at all:
 * one tool is enough, so a missing second one is not worth a warning.
 * @param {(text: string) => void} [write]
 */
function warnMissingOperatorClis(write = (line) => process.stderr.write(`${line}\n`)) {
  if (Object.keys(OPERATOR_CLIS).some((tool) => resolveOperatorCli(tool).installed)) return;
  write([
    "No AI tool is installed on this computer yet. Vibe64 needs one.",
    `To install Claude Code, run: ${operatorCliInstall("claude")}`,
    "Codex and opencode work too: open Vibe64 and choose AI setup."
  ].join("\n"));
}

export { warnMissingOperatorClis };
