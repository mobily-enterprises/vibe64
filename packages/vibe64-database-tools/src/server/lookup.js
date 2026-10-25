import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";

import {
  databaseDialect
} from "./databaseDialect.js";
import {
  quoteIdentifier
} from "./sqlPolicy.js";

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

function displayColumn(table = {}, preferred = "") {
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const preferredName = normalizeText(preferred);
  if (preferredName && columns.some((column) => column.name === preferredName)) {
    return preferredName;
  }
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

function sqlLiteral(value, engine = "postgresql") {
  const dialect = databaseDialect(engine);
  if (value == null) {
    return "NULL";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (value && typeof value === "object" && value.kind === "binary" && value.base64) {
    const hex = Buffer.from(value.base64, "base64").toString("hex");
    return dialect.binaryLiteral(hex);
  }
  return dialect.stringLiteral(value);
}

function lookupQuerySql(table = {}, keys = {}, engine = "postgresql") {
  const qualified = [table.schema, table.name].filter(Boolean).map((name) => quoteIdentifier(name, engine)).join(".");
  const predicates = Object.entries(keys).map(([column, value]) => (
    value == null
      ? `${quoteIdentifier(column, engine)} IS NULL`
      : `${quoteIdentifier(column, engine)} = ${sqlLiteral(value, engine)}`
  ));
  return `SELECT *\nFROM ${qualified}\nWHERE ${predicates.join("\n  AND ")};`;
}

async function searchDatabaseLookup({
  displayColumn: preferredDisplayColumn = "",
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
  const selectedDisplayColumn = displayColumn(table, preferredDisplayColumn);
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
    displayColumn: selectedDisplayColumn,
    displayColumnOptions: table.columns.map((column) => ({
      label: `${column.name} · ${column.nativeType}`,
      value: column.name
    })),
    items: rows.map((row) => {
      const keys = Object.fromEntries(relation.referencedColumns.map((column) => [column, row[column]]));
      const keyLabel = relation.referencedColumns.map((column) => String(row[column] ?? "NULL")).join(" / ");
      const display = selectedDisplayColumn ? String(row[selectedDisplayColumn] ?? "") : "";
      return {
        display: display && display !== keyLabel ? `${display} — ${keyLabel}` : keyLabel,
        keys,
        querySql: lookupQuerySql(table, keys, engine)
      };
    }),
    ok: true,
    relationshipId: relation.id,
    truncated: rows.length >= LOOKUP_LIMIT
  };
}

export {
  DISPLAY_COLUMN_NAMES,
  LOOKUP_LIMIT,
  displayColumn,
  lookupQuerySql,
  searchDatabaseLookup
};
