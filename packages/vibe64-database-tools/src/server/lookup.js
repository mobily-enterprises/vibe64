import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";

import {
  databaseDialect
} from "./databaseDialect.js";
import {
  jsonSafeValue
} from "./queryExecutor.js";

const LOOKUP_LIMIT = 25;
const DISPLAY_COLUMN_NAMES = Object.freeze(["name", "title", "label", "code"]);

function relationship(schema = {}, relationshipId = "") {
  const found = (Array.isArray(schema?.relationships) ? schema.relationships : []).find((candidate) => (
    candidate.id === normalizeText(relationshipId)
  ));
  if (!found) {
    throw vibe64Error(
      "The foreign-key relationship is not present in the refreshed schema.",
      "vibe64_database_lookup_relationship_missing"
    );
  }
  return found;
}

function schemaTable(schema = {}, qualifiedName = "") {
  const found = (Array.isArray(schema?.tables) ? schema.tables : []).find((candidate) => (
    candidate.qualifiedName === normalizeText(qualifiedName)
  ));
  if (!found) {
    throw vibe64Error(
      "The lookup table is not present in the refreshed schema.",
      "vibe64_database_lookup_table_missing"
    );
  }
  return found;
}

function displayColumn(table = {}) {
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const byLowerName = new Map(columns.map((column) => [column.name.toLowerCase(), column.name]));
  for (const name of DISPLAY_COLUMN_NAMES) {
    if (byLowerName.has(name)) {
      return byLowerName.get(name);
    }
  }
  return columns[0]?.name || "";
}

function tableQuery(knex, table = {}) {
  return knex(table.name).withSchema(table.schema);
}

function searchableColumns(table = {}, keyColumns = [], selectedDisplayColumn = "") {
  const names = [selectedDisplayColumn, ...keyColumns].filter(Boolean);
  return [...new Set(names)].filter((name) => table.columns.some((column) => column.name === name));
}

function addSearch(query, columns = [], search = "", engine = "postgresql") {
  const term = normalizeText(search);
  if (!term || columns.length < 1) {
    return query;
  }
  const pattern = `%${term}%`;
  const dialect = databaseDialect(engine);
  return query.where(function searchColumns() {
    columns.forEach((column, index) => {
      const method = index === 0 ? "whereRaw" : "orWhereRaw";
      dialect.lookupSearch(this, method, column, pattern);
    });
  });
}

async function searchDatabaseLookup({
  engine = "postgresql",
  knex,
  relationshipId = "",
  schema = {},
  search = ""
} = {}) {
  if (!knex) {
    throw new TypeError("searchDatabaseLookup requires Knex.");
  }
  const relation = relationship(schema, relationshipId);
  const table = schemaTable(schema, relation.referencedTable);
  const selectedDisplayColumn = displayColumn(table);
  const selectedColumns = [...new Set([
    ...relation.referencedColumns,
    selectedDisplayColumn
  ].filter(Boolean))];
  let query = tableQuery(knex, table).select(selectedColumns).limit(LOOKUP_LIMIT);
  query = addSearch(
    query,
    searchableColumns(table, relation.referencedColumns, selectedDisplayColumn),
    search,
    engine
  );
  const rows = await query;
  return {
    items: rows.map((row) => {
      const keys = Object.fromEntries(relation.referencedColumns.map((column) => [column, jsonSafeValue(row[column])]));
      const keyLabel = relation.referencedColumns.map((column) => String(row[column] ?? "NULL")).join(" / ");
      const display = selectedDisplayColumn ? String(row[selectedDisplayColumn] ?? "") : "";
      return {
        display: display && display !== keyLabel ? `${display} — ${keyLabel}` : keyLabel,
        keys
      };
    }),
    ok: true,
    relationshipId: relation.id,
    truncated: rows.length >= LOOKUP_LIMIT
  };
}

export {
  searchDatabaseLookup
};
