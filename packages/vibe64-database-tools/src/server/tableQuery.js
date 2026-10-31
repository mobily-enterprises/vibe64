// A Knex query on one table in its schema.
function tableQuery(knex, table = {}) {
  return knex(table.name).withSchema(table.schema);
}

export { tableQuery };
