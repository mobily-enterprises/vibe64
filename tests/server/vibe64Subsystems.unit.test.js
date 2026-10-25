import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGenesisCity } from "../../packages/vibe64-system-graph/src/server/genesisCities.js";
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
