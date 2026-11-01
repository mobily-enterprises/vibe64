// `vibe64 spec [<name>]`: prints the exact Vibe64-owned contracts that coding
// agents implement. Each spec lives with its owning package; the root app is the
// only place that may depend on all of them.
import { readFile } from "node:fs/promises";

import { VIBE64_GENESIS_AGENT_SPECS } from "@local/vibe64-genesis/server/agentSpecs";
import { VIBE64_SOURCE_EDITOR_AGENT_SPECS } from "@local/vibe64-source-editor/server/agentSpecs";
import { VIBE64_TERMINALS_AGENT_SPECS } from "@local/vibe64-terminals/server/agentSpecs";

const VIBE64_AGENT_SPECS = Object.freeze([
  ...VIBE64_GENESIS_AGENT_SPECS,
  ...VIBE64_TERMINALS_AGENT_SPECS,
  ...VIBE64_SOURCE_EDITOR_AGENT_SPECS,
  {
    name: "training-content",
    title: "Teaching content format for vibe64 training validate and bundle",
    text: () => readFile(new URL("../../docs/training-content.md", import.meta.url), "utf8")
  }
]);

function agentSpecList() {
  const width = Math.max(...VIBE64_AGENT_SPECS.map(({ name }) => name.length));
  return [
    "Usage: vibe64 spec <name>",
    "",
    "Vibe64-owned contracts:",
    ...VIBE64_AGENT_SPECS.map(({ name, title }) => `  ${name.padEnd(width)}  ${title}`)
  ].join("\n");
}

async function runAgentSpecCli(args = [], {
  write = (text) => process.stdout.write(`${text.trimEnd()}\n`),
  writeError = (text) => process.stderr.write(`${text.trimEnd()}\n`)
} = {}) {
  const [name] = args;
  if (!name || name === "--help" || name === "-h") {
    write(agentSpecList());
    return 0;
  }
  const spec = args.length === 1 && VIBE64_AGENT_SPECS.find((entry) => entry.name === name);
  if (!spec) {
    writeError(`Unknown Vibe64 spec: ${args.join(" ")}.\n\n${agentSpecList()}`);
    return 2;
  }
  write(await spec.text());
  return 0;
}

export { VIBE64_AGENT_SPECS, runAgentSpecCli };
