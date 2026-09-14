import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { DATA_OVERVIEW_MAX_BYTES, DATA_OVERVIEW_PATH, validateDataOverview } from "../shared/dataOverview.js";

// MySQL's schema qualifier is the selected database, unlike PostgreSQL's
// application-owned schemas. Only the overview's persisted references omit it.
export function dataOverviewReference(schema, reference, { qualified = false } = {}) {
  if (schema.engine !== "mysql") return reference;
  const prefix = `${schema.database}.`;
  if (qualified) return `${prefix}${reference}`;
  if (!reference.startsWith(prefix)) throw new Error(`Data overview: ${reference} is outside the selected database.`);
  return reference.slice(prefix.length);
}

export function dataOverviewDefinition(schema, definition, options) {
  const reference = (value) => dataOverviewReference(schema, value, options);
  const tableReference = (value) => {
    if (schema.engine === "mysql" && options?.qualified && value.includes(".")) {
      throw new Error("Data overview: MySQL table references must omit the database name. Use Review with AI to convert data-overview.json once, preserving its grouping and positions.");
    }
    return reference(value);
  };
  return {
    ...definition,
    actors: definition.actors.map((actor) => ({ ...actor, table: tableReference(actor.table), tables: actor.tables.map(tableReference) })),
    ...(definition.reviewedTables && { reviewedTables: definition.reviewedTables.map(tableReference) }),
    ...(definition.rings && { rings: definition.rings.map((ring) => ring.map(tableReference)) }),
    ...(definition.mainRelationships && { mainRelationships: definition.mainRelationships.map(reference) }),
    ...(definition.positions && { positions: Object.fromEntries(Object.entries(definition.positions)
      .map(([table, position]) => [table === "other-tables" ? table : tableReference(table), position])) })
  };
}

export async function readDataOverview(session, schema) {
  const result = { path: DATA_OVERVIEW_PATH, present: false, hash: "", error: "", definition: { version: 1, actors: [] } };
  const root = sessionSourcePath(session);
  if (!root) return result;
  let handle;
  try {
    handle = await open(path.join(root, DATA_OVERVIEW_PATH), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    result.present = true;
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > DATA_OVERVIEW_MAX_BYTES) throw new Error("Data overview must be a regular JSON file smaller than 256 KiB.");
    const buffer = Buffer.alloc(DATA_OVERVIEW_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > DATA_OVERVIEW_MAX_BYTES) throw new Error("Data overview is larger than 256 KiB.");
    const content = buffer.subarray(0, length);
    result.hash = createHash("sha256").update(content).digest("hex");
    const definition = validateDataOverview(JSON.parse(content.toString("utf8")));
    result.definition = schema ? dataOverviewDefinition(schema, definition, { qualified: true }) : definition;
  } catch (error) {
    if (error.code !== "ENOENT") {
      result.present = true;
      result.error = error.message || "The data overview could not be read.";
    }
  } finally {
    await handle?.close();
  }
  return result;
}
