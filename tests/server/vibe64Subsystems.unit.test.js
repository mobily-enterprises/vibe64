import assert from "node:assert/strict";
import { test } from "node:test";
import { subsystemEntries } from "../../packages/vibe64-system-graph/src/client/subsystemsModel.js";
import { validateGenesisCity } from "../../packages/vibe64-system-graph/src/server/genesisCities.js";
const table = {
  resource: "database",
  schema: "default",
  table: "forms"
};
const map = {
  status: "valid",
  subsystems: [{
    id: "forms",
    title: "Forms",
    description: "Owns forms",
    program: ["genesis/program/elsewhere/render.md"],
    dataOwned: [table],
    dataUsed: []
  }, {
    id: "work",
    title: "Work",
    description: "Captures work",
    program: [],
    dataOwned: [],
    dataUsed: [table]
  }]
};
const city = {
  buildings: [{
    id: "render",
    path: "genesis/program/elsewhere/render.md",
    title: "Render a form",
    sources: ["src/forms.js"]
  }]
};
test("subsystem data resolves exact resource and schema identity and preserves shared ownership", () => {
  const database = {
    connection: {
      resourceId: "database",
      engine: "mysql",
      database: "app"
    },
    schema: {
      tables: [{
        schema: "app",
        name: "forms",
        qualifiedName: "app.forms"
      }]
    }
  };
  const entries = subsystemEntries(map, city, database);
  assert.equal(entries[0].operations[0].title, "Render a form");
  assert.equal(entries[0].dataOwned[0].qualifiedName, "app.forms");
  assert.equal(entries[1].dataUsed[0].ownerId, "forms");
  assert.equal(subsystemEntries(map, city, {
    ...database,
    connection: {
      ...database.connection,
      resourceId: "another"
    }
  })[0].dataOwned[0].resolution, "unavailable");
  assert.equal(subsystemEntries(map, city, {
    ...database,
    schema: {
      tables: []
    }
  })[0].dataOwned[0].resolution, "missing");
  assert.equal(subsystemEntries(map, city, null)[0].dataOwned[0].resolution, "unavailable");
});
test("unassigned Genesis operations remain readable before subsystem adoption", () => {
  const source = {
    schema: "genesis.program-city.v1",
    schemaVersion: 1,
    status: "valid",
    programHash: "hash",
    diagnostics: [],
    districts: [],
    links: [],
    buildings: [{
      id: "operation:render",
      name: "render",
      path: "genesis/program/render.md",
      title: "Render",
      description: "Renders",
      publicContract: "Returns form",
      implementationMap: "",
      subsystem: null,
      districtId: null,
      sources: [],
      sourceFileIds: []
    }]
  };
  assert.equal(validateGenesisCity(source, "program"), source);
});
