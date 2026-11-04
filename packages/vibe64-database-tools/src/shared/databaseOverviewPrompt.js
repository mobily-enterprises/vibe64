import { DATA_OVERVIEW_ABSTRACTIONS } from "./dataOverview.js";

/**
 * The agent request that creates or reviews the project's Data overview at one abstraction level. The scope is the
 * whole grouping ("all"), tables no review has seen yet ("new"), or the listed ungrouped tables ("ungrouped").
 * The overview's AI task sends it; without one, the main chat receives it as a draft.
 * @param {{
 *   abstraction: string,
 *   scope: string,
 *   schemaTables: Array<{ qualifiedName: string, reference?: string }>,
 *   tables: string[]
 * }} options
 * @returns {{ abstraction: string, displayMessage: string, message: string }}
 */
function buildOverviewAssistantRequest({ abstraction, scope, schemaTables, tables }) {
  const level = DATA_OVERVIEW_ABSTRACTIONS.find((item) => item.value === abstraction) || DATA_OVERVIEW_ABSTRACTIONS[1];
  const tableReferences = tables.map(name => schemaTables.find(table => table.qualifiedName === name)?.reference || name);
  const scopeInstruction = scope === "ungrouped"
    ? `Review only these currently ungrouped tables: ${JSON.stringify(tableReferences)}. Preserve existing actors, names, descriptions, memberships and manual choices. Classify these tables into existing or new actors where appropriate. Explain any deliberately retained under Other tables. Preserve reviewedTables and record this review.`
    : scope === "new"
    ? "Process only coverage.unreviewed tables. Preserve existing actors, names, descriptions, memberships and manual choices. New tables may join an existing actor or form a new one. Preserve reviewedTables and add the newly reviewed tables, including those deliberately left under Other tables."
    : "Regenerate the whole grouping at the selected abstraction level, replacing existing actor choices as needed. Review every current table and record every one in reviewedTables, including those deliberately left under Other tables.";
  const scopeLabel = scope === "ungrouped"
    ? `Review ${tableReferences.length} ungrouped tables`
    : scope === "new" ? "Process new tables only" : "Regenerate the data overview";
  return {
    abstraction: level.value,
    displayMessage: `${scopeLabel}: ${level.title}.`,
    message: `Create or review this project's Data overview. Run \`vibe64-helper database overview --json\` to read its current definition, refreshed schema and exact authoring instructions. Inspect the relevant application source to understand the main actors. Selected abstraction: ${level.title} (${level.value}). ${level.description} ${scopeInstruction} Save the grouping in data-overview.json with abstraction set to "${level.value}". Supporting tables may be several relationships away. Change only this grouping file; do not change database records, schema or other application files. Run \`vibe64-helper database refresh\` followed by \`vibe64-helper database overview --json\`, fix invalid or missing references, and report coverage plus any tables left under Other tables.`
  };
}

export { buildOverviewAssistantRequest };
