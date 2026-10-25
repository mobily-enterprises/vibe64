import {
  backtickedArguments,
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  projectPath
} from "./stackOperation.js";

const VIBE64_ARCHITECTURE_LAYOUT_CONTRACT = "vibe64.architecture-layout.v1";
const VIBE64_ARCHITECTURE_LAYOUT_SECTION = "Architecture layout";
const ERROR_CODE = "VIBE64_ARCHITECTURE_LAYOUT_INVALID";
const ARCHITECTURE_LAYOUT_KINDS = Object.freeze(["layer", "libraries", "support"]);

// Vibe64 owns this presentation grammar. Genesis transports the exact section;
// declarations neither discover subsystems nor change their source ownership.
function parseVibe64ArchitectureLayoutLines(lines, { path = "genesis/stack.md#Architecture layout" } = {}) {
  if (!Array.isArray(lines)) invalidStackOperation(ERROR_CODE, path, "Expected exact Stack section lines.");
  if (isExplicitlyEmptyStackSection(lines)) return [];
  const groups = [];
  const ids = new Set();
  const roots = new Set();
  let current;
  function finish() {
    if (!current) return;
    if (!current.kind || !current.purpose || !current.subsystems.length) {
      invalidStackOperation(ERROR_CODE, path, `${current.id} needs Kind, Purpose and at least one Subsystem.`);
    }
    groups.push(current);
  }
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^### Group `([a-z0-9]+(?:-[a-z0-9]+)*)`: (.+)$/u);
    if (heading) {
      finish();
      if (ids.has(heading[1])) invalidStackOperation(ERROR_CODE, path, "Duplicate group id.", index + 1);
      ids.add(heading[1]);
      current = { id: heading[1], title: heading[2], subsystems: [] };
      continue;
    }
    const field = line.match(/^- (Kind|Purpose|Subsystem): (.+)$/u);
    if (!current || !field) {
      invalidStackOperation(ERROR_CODE, path, "Expected a Group heading or Kind, Purpose, Subsystem field.", index + 1);
    }
    const values = backtickedArguments(field[2], ERROR_CODE, path, field[1], index + 1, { count: 1 });
    if (field[1] === "Subsystem") {
      const root = projectPath(values[0], ERROR_CODE, path, "Subsystem root", index + 1);
      if (roots.has(root)) invalidStackOperation(ERROR_CODE, path, "Each directory root may be placed only once.", index + 1);
      roots.add(root);
      current.subsystems.push({ root });
    } else {
      const key = field[1].toLowerCase();
      if (current[key] !== undefined) invalidStackOperation(ERROR_CODE, path, `Duplicate ${field[1]}.`, index + 1);
      if (key === "kind" && !ARCHITECTURE_LAYOUT_KINDS.includes(values[0])) {
        invalidStackOperation(ERROR_CODE, path,
          `Kind must be ${ARCHITECTURE_LAYOUT_KINDS.slice(0, -1).join(", ")} or ${ARCHITECTURE_LAYOUT_KINDS.at(-1)}.`, index + 1);
      }
      current[key] = values[0];
    }
  }
  finish();
  if (!groups.length) invalidStackOperation(ERROR_CODE, path, "Use a Group entry or - Nothing.");
  return groups;
}

function vibe64ArchitectureLayout(section) {
  return {
    contract: VIBE64_ARCHITECTURE_LAYOUT_CONTRACT,
    status: section.status,
    stackHash: section.stackHash,
    groups: section.status === "ready" ? parseVibe64ArchitectureLayoutLines(section.lines) : [],
    diagnostics: section.diagnostics || []
  };
}

export {
  ARCHITECTURE_LAYOUT_KINDS,
  VIBE64_ARCHITECTURE_LAYOUT_CONTRACT,
  VIBE64_ARCHITECTURE_LAYOUT_SECTION,
  parseVibe64ArchitectureLayoutLines,
  vibe64ArchitectureLayout
};
