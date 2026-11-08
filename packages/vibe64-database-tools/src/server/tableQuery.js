// readable-check: allow no-direct-knex - infrastructure: the database tool's query on one table of a project's own database
/**
 * A Knex query on one table in its schema.
 */
function tableQuery(knex, table = {}) {
  return knex(table.name).withSchema(table.schema);
}

export { tableQuery };
