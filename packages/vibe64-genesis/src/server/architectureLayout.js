import { backtickedArguments, invalidStackOperation, isExplicitlyEmptyStackSection, projectPath } from './stackOperation.js';

export const VIBE64_ARCHITECTURE_LAYOUT_SECTION = 'Architecture layout';

// Vibe64 owns this presentation grammar. Genesis transports the exact section;
// declarations neither discover subsystems nor change their source ownership.
export function parseVibe64ArchitectureLayoutLines(lines, { path = 'genesis/stack.md#Architecture layout' } = {}) {
  const code = 'VIBE64_ARCHITECTURE_LAYOUT_INVALID';
  if (!Array.isArray(lines)) invalidStackOperation(code, path, 'Expected exact Stack section lines.');
  if (isExplicitlyEmptyStackSection(lines)) return [];
  const groups = []; const ids = new Set(); const roots = new Set(); let current;
  function finish() {
    if (!current) return;
    if (!current.kind || !current.purpose || !current.subsystems.length) invalidStackOperation(code, path, `${current.id} needs Kind, Purpose and at least one Subsystem.`);
    groups.push(current);
  }
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim(); if (!line) continue;
    const heading = line.match(/^### Group `([a-z0-9]+(?:-[a-z0-9]+)*)`: (.+)$/u);
    if (heading) {
      finish();
      if (ids.has(heading[1])) invalidStackOperation(code, path, 'Duplicate group id.', index + 1);
      ids.add(heading[1]); current = { id: heading[1], title: heading[2], subsystems: [] }; continue;
    }
    const field = line.match(/^- (Kind|Purpose|Subsystem): (.+)$/u);
    if (!current || !field) invalidStackOperation(code, path, 'Expected a Group heading or Kind, Purpose, Subsystem field.', index + 1);
    const values = backtickedArguments(field[2], code, path, field[1], index + 1, { count: field[1] === 'Subsystem' ? 3 : 1 });
    if (field[1] === 'Subsystem') {
      const root = projectPath(values[0], code, path, 'Subsystem root', index + 1);
      if (roots.has(root)) invalidStackOperation(code, path, 'Each directory root may be placed only once.', index + 1);
      roots.add(root); current.subsystems.push({ root, title: values[1], description: values[2] });
    } else {
      const key = field[1].toLowerCase();
      if (current[key] !== undefined) invalidStackOperation(code, path, `Duplicate ${field[1]}.`, index + 1);
      if (key === 'kind' && !['layer', 'libraries', 'support'].includes(values[0])) invalidStackOperation(code, path, 'Kind must be layer, libraries or support.', index + 1);
      current[key] = values[0];
    }
  }
  finish();
  if (!groups.length) invalidStackOperation(code, path, 'Use a Group entry or - Nothing.');
  return groups;
}

export function vibe64ArchitectureLayout(section) {
  return { contract: 'vibe64.architecture-layout.v1', status: section.status, stackHash: section.stackHash,
    groups: section.status === 'ready' ? parseVibe64ArchitectureLayoutLines(section.lines) : [], diagnostics: section.diagnostics || [] };
}
