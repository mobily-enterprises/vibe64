const POSTGRES_TABLES_SQL = `
  SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.oid::text AS table_id,
    c.relkind,
    obj_description(c.oid, 'pg_class') AS comment,
    CASE
      WHEN c.relkind IN ('r', 'p', 'f') THEN true
      WHEN c.relkind = 'v' THEN COALESCE(v.is_updatable = 'YES', false)
      ELSE false
    END AS is_updatable
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN information_schema.views v
    ON v.table_schema = n.nspname AND v.table_name = c.relname
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname <> 'information_schema'
    AND n.nspname !~ '^pg_(catalog|toast|temp_|toast_temp_)'
    AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
    AND pg_catalog.has_table_privilege(c.oid, 'SELECT')
  ORDER BY n.nspname, c.relname
`;

const POSTGRES_COLUMNS_SQL = `
  SELECT
    c.oid::text AS table_id,
    n.nspname AS schema_name,
    c.relname AS table_name,
    a.attnum AS column_id,
    a.attname AS column_name,
    a.attnum AS ordinal_position,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS native_type,
    t.typname AS data_type,
    NOT a.attnotnull AS is_nullable,
    pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default,
    a.attidentity AS identity_kind,
    a.attgenerated AS generated_kind,
    pg_catalog.col_description(c.oid, a.attnum) AS comment
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
  LEFT JOIN pg_catalog.pg_attrdef d
    ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND n.nspname <> 'information_schema'
    AND n.nspname !~ '^pg_(catalog|toast|temp_|toast_temp_)'
    AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
    AND pg_catalog.has_table_privilege(c.oid, 'SELECT')
  ORDER BY n.nspname, c.relname, a.attnum
`;

const POSTGRES_CONSTRAINTS_SQL = `
  SELECT
    con.oid::text AS constraint_id,
    con.conname AS constraint_name,
    con.contype AS constraint_type,
    source_ns.nspname AS schema_name,
    source.relname AS table_name,
    source.oid::text AS table_id,
    con.conkey AS source_column_ids,
    target_ns.nspname AS referenced_schema_name,
    target.relname AS referenced_table_name,
    target.oid::text AS referenced_table_id,
    con.confkey AS referenced_column_ids,
    con.confupdtype AS update_action,
    con.confdeltype AS delete_action,
    con.confmatchtype AS match_type,
    con.condeferrable AS is_deferrable,
    con.condeferred AS initially_deferred,
    pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class source ON source.oid = con.conrelid
  JOIN pg_catalog.pg_namespace source_ns ON source_ns.oid = source.relnamespace
  LEFT JOIN pg_catalog.pg_class target ON target.oid = con.confrelid
  LEFT JOIN pg_catalog.pg_namespace target_ns ON target_ns.oid = target.relnamespace
  WHERE source.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND source_ns.nspname <> 'information_schema'
    AND source_ns.nspname !~ '^pg_(catalog|toast|temp_|toast_temp_)'
    AND pg_catalog.has_schema_privilege(source_ns.oid, 'USAGE')
    AND pg_catalog.has_table_privilege(source.oid, 'SELECT')
  ORDER BY source_ns.nspname, source.relname, con.conname
`;

const POSTGRES_INDEXES_SQL = `
  SELECT
    idx.oid::text AS index_id,
    ns.nspname AS schema_name,
    tbl.relname AS table_name,
    tbl.oid::text AS table_id,
    idx.relname AS index_name,
    i.indisprimary AS is_primary,
    i.indisunique AS is_unique,
    i.indisvalid AS is_valid,
    i.indisready AS is_ready,
    am.amname AS method,
    array_agg(att.attname ORDER BY keys.ordinality)
      FILTER (WHERE att.attname IS NOT NULL) AS columns,
    pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate,
    pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = tbl.relnamespace
  JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_catalog.pg_am am ON am.oid = idx.relam
  LEFT JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS keys(attnum, ordinality) ON true
  LEFT JOIN pg_catalog.pg_attribute att
    ON att.attrelid = tbl.oid AND att.attnum = keys.attnum
  WHERE tbl.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND ns.nspname <> 'information_schema'
    AND ns.nspname !~ '^pg_(catalog|toast|temp_|toast_temp_)'
    AND pg_catalog.has_schema_privilege(ns.oid, 'USAGE')
    AND pg_catalog.has_table_privilege(tbl.oid, 'SELECT')
  GROUP BY idx.oid, ns.nspname, tbl.relname, tbl.oid, idx.relname,
    i.indisprimary, i.indisunique, i.indisvalid, i.indisready,
    am.amname, i.indpred, i.indrelid, i.indexrelid
  ORDER BY ns.nspname, tbl.relname, idx.relname
`;

const MYSQL_TABLES_SQL = `
  SELECT
    t.TABLE_SCHEMA AS schema_name,
    t.TABLE_NAME AS table_name,
    t.TABLE_TYPE AS table_type,
    t.ENGINE AS storage_engine,
    t.TABLE_COMMENT AS comment,
    CASE
      WHEN t.TABLE_TYPE = 'BASE TABLE' THEN 1
      ELSE COALESCE(v.IS_UPDATABLE = 'YES', 0)
    END AS is_updatable
  FROM information_schema.TABLES t
  LEFT JOIN information_schema.VIEWS v
    ON v.TABLE_SCHEMA = t.TABLE_SCHEMA AND v.TABLE_NAME = t.TABLE_NAME
  WHERE t.TABLE_SCHEMA = DATABASE()
  ORDER BY t.TABLE_NAME
`;

const MYSQL_COLUMNS_SQL = `
  SELECT
    c.TABLE_SCHEMA AS schema_name,
    c.TABLE_NAME AS table_name,
    c.COLUMN_NAME AS column_name,
    c.ORDINAL_POSITION AS ordinal_position,
    c.DATA_TYPE AS data_type,
    c.COLUMN_TYPE AS native_type,
    c.IS_NULLABLE AS is_nullable,
    c.COLUMN_DEFAULT AS column_default,
    c.EXTRA AS extra,
    c.GENERATION_EXPRESSION AS generation_expression,
    c.COLUMN_COMMENT AS comment,
    c.CHARACTER_SET_NAME AS character_set,
    c.COLLATION_NAME AS collation_name
  FROM information_schema.COLUMNS c
  WHERE c.TABLE_SCHEMA = DATABASE()
  ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
`;

const MYSQL_CONSTRAINT_COLUMNS_SQL = `
  SELECT
    tc.TABLE_SCHEMA AS schema_name,
    tc.TABLE_NAME AS table_name,
    tc.CONSTRAINT_NAME AS constraint_name,
    tc.CONSTRAINT_TYPE AS constraint_type,
    kcu.COLUMN_NAME AS column_name,
    kcu.ORDINAL_POSITION AS ordinal_position,
    kcu.REFERENCED_TABLE_SCHEMA AS referenced_schema_name,
    kcu.REFERENCED_TABLE_NAME AS referenced_table_name,
    kcu.REFERENCED_COLUMN_NAME AS referenced_column_name,
    kcu.POSITION_IN_UNIQUE_CONSTRAINT AS referenced_ordinal_position
  FROM information_schema.TABLE_CONSTRAINTS tc
  LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
    ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
    AND kcu.TABLE_NAME = tc.TABLE_NAME
    AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  WHERE tc.TABLE_SCHEMA = DATABASE()
  ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
`;

const MYSQL_REFERENTIAL_RULES_SQL = `
  SELECT
    rc.CONSTRAINT_SCHEMA AS schema_name,
    rc.TABLE_NAME AS table_name,
    rc.CONSTRAINT_NAME AS constraint_name,
    rc.UPDATE_RULE AS update_rule,
    rc.DELETE_RULE AS delete_rule,
    rc.MATCH_OPTION AS match_option,
    rc.UNIQUE_CONSTRAINT_SCHEMA AS referenced_schema_name,
    rc.REFERENCED_TABLE_NAME AS referenced_table_name
  FROM information_schema.REFERENTIAL_CONSTRAINTS rc
  WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
  ORDER BY rc.TABLE_NAME, rc.CONSTRAINT_NAME
`;

const MYSQL_CHECKS_SQL = `
  SELECT
    tc.TABLE_SCHEMA AS schema_name,
    tc.TABLE_NAME AS table_name,
    tc.CONSTRAINT_NAME AS constraint_name,
    cc.CHECK_CLAUSE AS definition
  FROM information_schema.TABLE_CONSTRAINTS tc
  JOIN information_schema.CHECK_CONSTRAINTS cc
    ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
    AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  WHERE tc.TABLE_SCHEMA = DATABASE()
    AND tc.CONSTRAINT_TYPE = 'CHECK'
  ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME
`;

const MYSQL_INDEXES_SQL = `
  SELECT
    s.TABLE_SCHEMA AS schema_name,
    s.TABLE_NAME AS table_name,
    s.INDEX_NAME AS index_name,
    s.NON_UNIQUE AS non_unique,
    s.SEQ_IN_INDEX AS sequence_in_index,
    s.COLUMN_NAME AS column_name,
    s.SUB_PART AS prefix_length,
    s.INDEX_TYPE AS method,
    s.COLLATION AS collation,
    s.CARDINALITY AS cardinality,
    s.INDEX_COMMENT AS comment
  FROM information_schema.STATISTICS s
  WHERE s.TABLE_SCHEMA = DATABASE()
  ORDER BY s.TABLE_NAME, s.INDEX_NAME, s.SEQ_IN_INDEX
`;

function text(value = "") {
  return String(value ?? "").trim();
}

async function rawRows(knex, sql) {
  const result = await knex.raw(sql);
  if (Array.isArray(result)) {
    return Array.isArray(result[0]) ? result[0] : [];
  }
  return Array.isArray(result?.rows) ? result.rows : [];
}

function tableKey(schema = "", name = "") {
  return `${text(schema)}\u0000${text(name)}`;
}

function qualifiedName(schema = "", name = "") {
  return schema ? `${schema}.${name}` : name;
}

function postgresTableKind(relkind = "") {
  return ({
    f: "foreign-table",
    m: "materialized-view",
    p: "partitioned-table",
    r: "table",
    v: "view"
  })[relkind] || "table";
}

function postgresConstraintType(type = "") {
  return ({
    c: "check",
    f: "foreign-key",
    p: "primary-key",
    u: "unique",
    x: "exclusion"
  })[type] || text(type);
}

function postgresReferentialAction(action = "") {
  return ({
    a: "NO ACTION",
    c: "CASCADE",
    d: "SET DEFAULT",
    n: "SET NULL",
    r: "RESTRICT"
  })[action] || "";
}

function postgresMatchType(type = "") {
  return ({ f: "FULL", p: "PARTIAL", s: "SIMPLE" })[type] || "";
}

function columnNamesForIds(table, ids = []) {
  const columns = new Map(table.columns.map((column) => [Number(column.databaseIdentity?.columnId), column.name]));
  return (Array.isArray(ids) ? ids : []).map((id) => columns.get(Number(id))).filter(Boolean);
}

function normalizedTable(record = {}, kind = "table") {
  const schema = text(record.schema_name);
  const name = text(record.table_name);
  return {
    columns: [],
    comment: record.comment == null ? "" : String(record.comment),
    constraints: [],
    indexes: [],
    keys: [],
    kind,
    name,
    physicalId: text(record.table_id),
    qualifiedName: qualifiedName(schema, name),
    schema,
    storageEngine: text(record.storage_engine),
    updatable: record.is_updatable === true || Number(record.is_updatable) === 1
  };
}

function editableTableKeys(table = {}) {
  const keys = (Array.isArray(table.constraints) ? table.constraints : [])
    .filter((constraint) => ["primary-key", "unique"].includes(constraint.type) && constraint.columns.length > 0)
    .map((constraint) => ({
      columns: constraint.columns,
      name: constraint.name,
      primary: constraint.type === "primary-key"
    }));
  const signatures = new Set(keys.map((key) => key.columns.join("\u0000")));
  for (const index of Array.isArray(table.indexes) ? table.indexes : []) {
    const signature = index.columns.join("\u0000");
    if (
      index.unique === true &&
      index.valid === true &&
      index.ready === true &&
      !index.predicate &&
      index.columns.length > 0 &&
      !signatures.has(signature)
    ) {
      keys.push({
        columns: index.columns,
        name: index.name,
        primary: index.primary === true
      });
      signatures.add(signature);
    }
  }
  return keys.sort((left, right) => (
    Number(right.primary) - Number(left.primary) ||
    left.columns.length - right.columns.length ||
    left.name.localeCompare(right.name)
  ));
}

function finalSchema(connection = {}, version = "", tables = []) {
  const relationships = tables.flatMap((table) => table.constraints
    .filter((constraint) => constraint.type === "foreign-key")
    .map((constraint) => ({
      columns: constraint.columns,
      constraintName: constraint.name,
      deleteAction: constraint.deleteAction,
      id: `${table.qualifiedName}:${constraint.name}`,
      matchType: constraint.matchType,
      referencedColumns: constraint.referencedColumns,
      referencedTable: constraint.referencedTable,
      sourceTable: table.qualifiedName,
      updateAction: constraint.updateAction
    })));
  const schemas = [...new Set(tables.map((table) => table.schema))]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      name,
      tables: tables.filter((table) => table.schema === name).map((table) => table.qualifiedName)
    }));
  return {
    database: connection.database,
    engine: connection.engine,
    engineLabel: connection.label,
    refreshedAt: new Date().toISOString(),
    relationships,
    schemaVersion: 1,
    schemas,
    tables,
    version: text(version)
  };
}

async function inspectPostgresSchema(knex, connection = {}) {
  const [versionRows, tableRows, columnRows, constraintRows, indexRows] = await Promise.all([
    rawRows(knex, "SELECT current_database() AS database_name, current_schema() AS default_schema, version() AS version"),
    rawRows(knex, POSTGRES_TABLES_SQL),
    rawRows(knex, POSTGRES_COLUMNS_SQL),
    rawRows(knex, POSTGRES_CONSTRAINTS_SQL),
    rawRows(knex, POSTGRES_INDEXES_SQL)
  ]);
  const tables = tableRows.map((record) => normalizedTable(record, postgresTableKind(record.relkind)));
  const byKey = new Map(tables.map((table) => [tableKey(table.schema, table.name), table]));
  const byId = new Map(tables.map((table) => [table.physicalId, table]));

  for (const record of columnRows) {
    const table = byKey.get(tableKey(record.schema_name, record.table_name));
    if (!table) {
      continue;
    }
    const identityKind = text(record.identity_kind);
    const generatedKind = text(record.generated_kind);
    table.columns.push({
      characterSet: "",
      collation: "",
      comment: record.comment == null ? "" : String(record.comment),
      dataType: text(record.data_type),
      databaseIdentity: {
        columnId: Number(record.column_id),
        tableId: text(record.table_id)
      },
      default: record.column_default == null ? null : String(record.column_default),
      generated: Boolean(generatedKind),
      generatedExpression: generatedKind ? text(record.column_default) : "",
      identity: Boolean(identityKind),
      identityKind,
      immutable: Boolean(identityKind || generatedKind),
      name: text(record.column_name),
      nativeType: text(record.native_type),
      nullable: record.is_nullable === true,
      ordinal: Number(record.ordinal_position)
    });
  }

  for (const record of constraintRows) {
    const table = byKey.get(tableKey(record.schema_name, record.table_name));
    if (!table) {
      continue;
    }
    const referencedTable = byId.get(text(record.referenced_table_id));
    table.constraints.push({
      columns: columnNamesForIds(table, record.source_column_ids),
      definition: text(record.definition),
      deferrable: record.is_deferrable === true,
      deleteAction: postgresReferentialAction(record.delete_action),
      initiallyDeferred: record.initially_deferred === true,
      matchType: postgresMatchType(record.match_type),
      name: text(record.constraint_name),
      referencedColumns: referencedTable
        ? columnNamesForIds(referencedTable, record.referenced_column_ids)
        : [],
      referencedTable: referencedTable?.qualifiedName || qualifiedName(
        text(record.referenced_schema_name),
        text(record.referenced_table_name)
      ),
      type: postgresConstraintType(record.constraint_type),
      updateAction: postgresReferentialAction(record.update_action)
    });
  }

  for (const record of indexRows) {
    const table = byKey.get(tableKey(record.schema_name, record.table_name));
    if (!table) {
      continue;
    }
    table.indexes.push({
      columns: Array.isArray(record.columns) ? record.columns.map(text).filter(Boolean) : [],
      comment: "",
      definition: text(record.definition),
      id: text(record.index_id),
      method: text(record.method),
      name: text(record.index_name),
      predicate: text(record.predicate),
      primary: record.is_primary === true,
      ready: record.is_ready === true,
      unique: record.is_unique === true,
      valid: record.is_valid === true
    });
  }

  for (const table of tables) {
    table.keys = editableTableKeys(table);
  }

  return { ...finalSchema(connection, versionRows[0]?.version, tables), defaultSchema: text(versionRows[0]?.default_schema) };
}

function mysqlConstraintType(value = "") {
  return ({
    "CHECK": "check",
    "FOREIGN KEY": "foreign-key",
    "PRIMARY KEY": "primary-key",
    "UNIQUE": "unique"
  })[text(value).toUpperCase()] || text(value).toLowerCase();
}

function groupedRows(rows = [], keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }
  return groups;
}

async function optionalRawRows(knex, sql) {
  try {
    return await rawRows(knex, sql);
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
      return [];
    }
    throw error;
  }
}

async function inspectMysqlSchema(knex, connection = {}) {
  const [versionRows, tableRows, columnRows, constraintColumnRows, ruleRows, checkRows, indexRows] = await Promise.all([
    rawRows(knex, "SELECT DATABASE() AS database_name, VERSION() AS version"),
    rawRows(knex, MYSQL_TABLES_SQL),
    rawRows(knex, MYSQL_COLUMNS_SQL),
    rawRows(knex, MYSQL_CONSTRAINT_COLUMNS_SQL),
    rawRows(knex, MYSQL_REFERENTIAL_RULES_SQL),
    optionalRawRows(knex, MYSQL_CHECKS_SQL),
    rawRows(knex, MYSQL_INDEXES_SQL)
  ]);
  const tables = tableRows.map((record) => normalizedTable(
    record,
    text(record.table_type).toUpperCase() === "VIEW" ? "view" : "table"
  ));
  const byKey = new Map(tables.map((table) => [tableKey(table.schema, table.name), table]));

  for (const record of columnRows) {
    const table = byKey.get(tableKey(record.schema_name, record.table_name));
    if (!table) {
      continue;
    }
    const extra = text(record.extra).toLowerCase();
    const generatedExpression = text(record.generation_expression);
    const generated = Boolean(generatedExpression || extra.includes("generated"));
    const identity = extra.includes("auto_increment");
    table.columns.push({
      characterSet: text(record.character_set),
      collation: text(record.collation_name),
      comment: record.comment == null ? "" : String(record.comment),
      dataType: text(record.data_type),
      databaseIdentity: {
        columnId: Number(record.ordinal_position),
        tableId: table.qualifiedName
      },
      default: record.column_default == null ? null : String(record.column_default),
      generated,
      generatedExpression,
      identity,
      identityKind: identity ? "auto_increment" : "",
      immutable: generated || identity,
      name: text(record.column_name),
      nativeType: text(record.native_type),
      nullable: text(record.is_nullable).toUpperCase() === "YES",
      ordinal: Number(record.ordinal_position)
    });
  }

  const rules = new Map(ruleRows.map((row) => [
    `${tableKey(row.schema_name, row.table_name)}\u0000${text(row.constraint_name)}`,
    row
  ]));
  const checks = new Map(checkRows.map((row) => [
    `${tableKey(row.schema_name, row.table_name)}\u0000${text(row.constraint_name)}`,
    row
  ]));
  const constraintGroups = groupedRows(constraintColumnRows, (row) => (
    `${tableKey(row.schema_name, row.table_name)}\u0000${text(row.constraint_name)}`
  ));
  for (const [constraintKey, records] of constraintGroups) {
    const first = records[0] || {};
    const table = byKey.get(tableKey(first.schema_name, first.table_name));
    if (!table) {
      continue;
    }
    const sorted = [...records].sort((left, right) => Number(left.ordinal_position || 0) - Number(right.ordinal_position || 0));
    const rule = rules.get(constraintKey) || {};
    const check = checks.get(constraintKey) || {};
    table.constraints.push({
      columns: sorted.map((record) => text(record.column_name)).filter(Boolean),
      definition: text(check.definition),
      deferrable: false,
      deleteAction: text(rule.delete_rule),
      initiallyDeferred: false,
      matchType: text(rule.match_option),
      name: text(first.constraint_name),
      referencedColumns: sorted.map((record) => text(record.referenced_column_name)).filter(Boolean),
      referencedTable: qualifiedName(
        text(first.referenced_schema_name || rule.referenced_schema_name),
        text(first.referenced_table_name || rule.referenced_table_name)
      ),
      type: mysqlConstraintType(first.constraint_type),
      updateAction: text(rule.update_rule)
    });
  }

  const indexGroups = groupedRows(indexRows, (row) => (
    `${tableKey(row.schema_name, row.table_name)}\u0000${text(row.index_name)}`
  ));
  for (const records of indexGroups.values()) {
    const first = records[0] || {};
    const table = byKey.get(tableKey(first.schema_name, first.table_name));
    if (!table) {
      continue;
    }
    const sorted = [...records].sort((left, right) => Number(left.sequence_in_index || 0) - Number(right.sequence_in_index || 0));
    table.indexes.push({
      columns: sorted.map((record) => text(record.column_name)).filter(Boolean),
      comment: text(first.comment),
      definition: "",
      id: `${table.qualifiedName}:${text(first.index_name)}`,
      method: text(first.method),
      name: text(first.index_name),
      predicate: "",
      primary: text(first.index_name).toUpperCase() === "PRIMARY",
      ready: true,
      unique: Number(first.non_unique) === 0,
      valid: true
    });
  }

  for (const table of tables) {
    table.keys = editableTableKeys(table);
  }

  return finalSchema(connection, versionRows[0]?.version, tables);
}

export {
  inspectMysqlSchema,
  inspectPostgresSchema,
  rawRows
};
