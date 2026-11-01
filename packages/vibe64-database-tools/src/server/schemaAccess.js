import { vibe64Error } from "@local/vibe64-core/server/core";
import { toText } from "@local/vibe64-core/shared/toText";

const MAX_DATABASE_SCHEMA_CATALOG_ENTRIES = 100;
const MAX_DATABASE_SCHEMA_MATCHES = 8;
const MAX_DATABASE_SCHEMA_RESULT_BYTES = 128 * 1024;
const MAX_DATABASE_SCHEMA_SEARCH_CHARACTERS = 300;

function databaseSchemaSummary(schema = {}) {
  const tables = Array.isArray(schema.tables) ? schema.tables : [];
  const objectKinds = {};
  for (const table of tables) {
    const kind = toText(table.kind) || "table";
    objectKinds[kind] = Number(objectKinds[kind] || 0) + 1;
  }
  return {
    database: toText(schema.database),
    engine: toText(schema.engine),
    engineLabel: toText(schema.engineLabel),
    objectCount: tables.length,
    objectKinds,
    refreshedAt: toText(schema.refreshedAt),
    schemaCount: new Set(tables.map((table) => toText(table.schema))).size,
    schemaVersion: Number(schema.schemaVersion || 0),
    version: toText(schema.version)
  };
}

function assistantColumnView(sourceColumn = {}) {
  const {
    databaseIdentity: _databaseIdentity,
    immutable: _immutable,
    ordinal: _ordinal,
    ...column
  } = sourceColumn;
  return column;
}

function assistantIndexView(sourceIndex = {}) {
  const {
    id: _id,
    ...index
  } = sourceIndex;
  return index;
}

function incomingRelationships(schema = {}, qualifiedName = "") {
  return (Array.isArray(schema.tables) ? schema.tables : []).flatMap((sourceTable) => (
    (Array.isArray(sourceTable.constraints) ? sourceTable.constraints : [])
      .filter((constraint) => (
        constraint.type === "foreign-key" &&
        toText(constraint.referencedTable) === qualifiedName
      ))
      .map((constraint) => ({
        columns: Array.isArray(constraint.columns) ? constraint.columns : [],
        constraintName: toText(constraint.name),
        referencedColumns: Array.isArray(constraint.referencedColumns)
          ? constraint.referencedColumns
          : [],
        sourceTable: toText(sourceTable.qualifiedName)
      }))
  ));
}

function assistantTableView(schema = {}, sourceTable = {}) {
  const {
    physicalId: _physicalId,
    ...table
  } = sourceTable;
  return {
    ...table,
    columns: (Array.isArray(sourceTable.columns) ? sourceTable.columns : [])
      .map(assistantColumnView),
    incomingRelationships: incomingRelationships(schema, toText(sourceTable.qualifiedName)),
    indexes: (Array.isArray(sourceTable.indexes) ? sourceTable.indexes : [])
      .map(assistantIndexView)
  };
}

function searchableTableText(table = {}) {
  return [
    table.qualifiedName,
    table.schema,
    table.name,
    table.kind,
    table.comment,
    ...(Array.isArray(table.columns) ? table.columns.flatMap((column) => [
      column.name,
      column.comment,
      column.dataType,
      column.nativeType
    ]) : []),
    ...(Array.isArray(table.constraints) ? table.constraints.flatMap((constraint) => [
      constraint.name,
      constraint.type,
      constraint.referencedTable,
      ...(Array.isArray(constraint.columns) ? constraint.columns : []),
      ...(Array.isArray(constraint.referencedColumns) ? constraint.referencedColumns : [])
    ]) : [])
  ].map(toText).filter(Boolean).join("\n").toLocaleLowerCase();
}

function searchTerms(value = "") {
  return [...new Set(String(value || "")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map(toText)
    .filter((term) => term.length > 1))];
}

function tableSearchScore(table = {}, search = "") {
  const query = toText(search).toLocaleLowerCase();
  const qualifiedName = toText(table.qualifiedName).toLocaleLowerCase();
  const name = toText(table.name).toLocaleLowerCase();
  const haystack = searchableTableText(table);
  let score = 0;
  if (query === qualifiedName) score += 2_000;
  if (query === name) score += 1_500;
  if (qualifiedName.includes(query)) score += 400;
  if (name.includes(query)) score += 300;
  for (const term of searchTerms(query)) {
    if (term === name) score += 250;
    else if (name.includes(term)) score += 120;
    if (qualifiedName.includes(term)) score += 60;
    if (haystack.includes(term)) score += 20;
  }
  return score;
}

function boundedSchemaResult(result = {}) {
  const bounded = {
    ...result,
    catalog: [...result.catalog],
    objects: [...result.objects]
  };
  while (
    Buffer.byteLength(JSON.stringify(bounded), "utf8") > MAX_DATABASE_SCHEMA_RESULT_BYTES &&
    bounded.catalog.length > 0
  ) {
    bounded.catalog.pop();
    bounded.truncated = true;
  }
  while (
    Buffer.byteLength(JSON.stringify(bounded), "utf8") > MAX_DATABASE_SCHEMA_RESULT_BYTES &&
    bounded.objects.length > 1
  ) {
    bounded.objects.pop();
    bounded.truncated = true;
  }
  if (Buffer.byteLength(JSON.stringify(bounded), "utf8") > MAX_DATABASE_SCHEMA_RESULT_BYTES) {
    throw vibe64Error(
      "One database object is too large for the bounded schema assistant result.",
      "vibe64_database_assistant_schema_object_too_large"
    );
  }
  bounded.returnedCount = bounded.objects.length;
  return bounded;
}

function searchDatabaseSchema(schema = {}, value = "") {
  const search = toText(value);
  if (!search) {
    throw vibe64Error(
      "The database assistant must name or search for a schema object.",
      "vibe64_database_assistant_schema_search_required"
    );
  }
  if (search.length > MAX_DATABASE_SCHEMA_SEARCH_CHARACTERS) {
    throw vibe64Error(
      "The database assistant schema search is too long.",
      "vibe64_database_assistant_schema_search_too_large"
    );
  }
  const tables = Array.isArray(schema.tables) ? schema.tables : [];
  const catalogueRequested = ["*", "all", "catalog", "catalogue", "list"]
    .includes(search.toLocaleLowerCase());
  const normalizedSearch = search.toLocaleLowerCase();
  const exactQualifiedMatches = tables.filter((table) => (
    toText(table.qualifiedName).toLocaleLowerCase() === normalizedSearch
  ));
  const exactNameMatches = exactQualifiedMatches.length > 0
    ? []
    : tables.filter((table) => toText(table.name).toLocaleLowerCase() === normalizedSearch);
  const candidates = exactQualifiedMatches.length > 0
    ? exactQualifiedMatches
    : exactNameMatches.length > 0
      ? exactNameMatches
      : tables;
  const ranked = catalogueRequested
    ? []
    : candidates
        .map((table) => ({ score: tableSearchScore(table, search), table }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => (
          right.score - left.score ||
          toText(left.table.qualifiedName).localeCompare(toText(right.table.qualifiedName))
        ));
  const selected = ranked.slice(0, MAX_DATABASE_SCHEMA_MATCHES);
  const showCatalog = catalogueRequested || ranked.length === 0;
  return boundedSchemaResult({
    catalog: showCatalog
      ? tables
          .map((table) => ({
            kind: toText(table.kind),
            qualifiedName: toText(table.qualifiedName)
          }))
          .sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName))
          .slice(0, MAX_DATABASE_SCHEMA_CATALOG_ENTRIES)
      : [],
    matchedCount: catalogueRequested ? tables.length : ranked.length,
    objects: selected.map(({ table }) => assistantTableView(schema, table)),
    query: search,
    returnedCount: selected.length,
    totalObjects: tables.length,
    truncated: catalogueRequested
      ? tables.length > MAX_DATABASE_SCHEMA_CATALOG_ENTRIES
      : ranked.length > selected.length
  });
}

export {
  MAX_DATABASE_SCHEMA_MATCHES,
  MAX_DATABASE_SCHEMA_RESULT_BYTES,
  MAX_DATABASE_SCHEMA_SEARCH_CHARACTERS,
  databaseSchemaSummary,
  searchDatabaseSchema
};
