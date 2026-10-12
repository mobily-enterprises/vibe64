import { describe, expect, it } from "vitest";

import {
  GENESIS_MACHINE_CITY_KIND,
  GENESIS_PROGRAM_CITY_KIND,
  genesisCityKind,
  genesisCityWorld
} from "../../packages/vibe64-system-graph/src/client/world/genesisCityWorld.js";

describe("Genesis City world projection", () => {
  it("passes native Machine City districts, buildings, and functions by reference", () => {
    const districts = [{
      id: "directory:src",
      parentId: null,
      path: "src",
      title: "src"
    }];
    const buildings = [{
      bytes: 120,
      districtId: "directory:src",
      extractors: ["javascript"],
      functionIds: [],
      hash: "hash",
      id: "file:src/catalog.js",
      internalFunctionCount: 0,
      language: "javascript",
      lines: 4,
      mode: 0o100644,
      path: "src/catalog.js",
      publicFunctionCount: 0,
      role: "source",
      title: "catalog.js"
    }];
    const functions = [];
    const city = { buildings, districts, functions };

    const overview = genesisCityWorld(city, GENESIS_MACHINE_CITY_KIND);

    expect(overview).toEqual({
      buildings,
      cityKind: "machine",
      cityLabel: "MACHINE CITY · FILES AND FUNCTIONS",
      districts,
      functions,
      presentationCampuses: [],
      presentationRegions: []
    });
    expect(overview.buildings).toBe(buildings);
    expect(overview.districts).toBe(districts);
    expect(overview.functions).toBe(functions);
    expect(overview.presentationCampuses).toEqual([]);
    expect(overview.presentationRegions).toEqual([]);
    expect(overview).not.toHaveProperty("adapter");
    expect(overview).not.toHaveProperty("relationships");
    expect(overview).not.toHaveProperty("findings");
  });

  it("passes native Program links without invented architecture", () => {
    const operation = {
      description: "Lists the catalogue.",
      districtId: "subsystem:catalog",
      id: "operation:catalog/list-books",
      implementationMap: "- `listBooks()` returns records.",
      name: "list-books",
      path: "genesis/program/catalog/list-books.md",
      publicContract: "Returns the current books.",
      sourceFileIds: ["file:src/catalog.js"],
      sources: ["src/catalog.js"],
      subsystem: "catalog",
      title: "List books"
    };
    const districts = [{
      id: "subsystem:catalog",
      parentId: null,
      path: "catalog",
      title: "Catalog"
    }];
    const links = [{
      fromId: operation.id,
      kind: "implemented-by",
      toId: "file:src/catalog.js"
    }];
    const overview = genesisCityWorld({
      buildings: [operation],
      districts,
      links
    }, GENESIS_PROGRAM_CITY_KIND);

    expect(overview.buildings[0]).not.toHaveProperty("lines");
    expect(overview.buildings[0]).not.toHaveProperty("imports");
    expect(overview.buildings[0]).not.toHaveProperty("routes");
    expect(overview.buildings[0]).not.toHaveProperty("evidence");
    expect(overview.links).toBe(links);
  });

  it("joins Program implemented-by links to exact Machine files without path inference", () => {
    const machineFile = {
      districtId: "directory:src",
      id: "file:src/catalog.js",
      lines: 20,
      path: "src/catalog.js",
      title: "catalog.js"
    };
    const unlinkedMachineFile = {
      districtId: "directory:src",
      id: "file:src/other.js",
      lines: 10,
      path: "src/other.js",
      title: "other.js"
    };
    const operation = {
      districtId: "subsystem:catalog",
      id: "operation:catalog/list",
      path: "genesis/program/catalog/list.md",
      sources: ["src/catalog.js", "src/other.js"],
      title: "List books"
    };
    const machineCity = {
      buildings: [machineFile, unlinkedMachineFile],
      districts: [],
      functions: []
    };
    const programCity = {
      buildings: [operation],
      districts: [{
        id: "subsystem:catalog",
        parentId: null,
        path: "catalog",
        title: "Catalog"
      }],
      links: [{
        fromId: operation.id,
        kind: "implemented-by",
        toId: machineFile.id
      }, {
        fromId: operation.id,
        kind: "described-by",
        toId: unlinkedMachineFile.id
      }]
    };

    const overview = genesisCityWorld(machineCity, GENESIS_MACHINE_CITY_KIND, {
      machineCity,
      programCity
    });

    expect(overview.semantic.subsystems).toHaveLength(1);
    expect(overview.semantic.subsystems[0].fileIds).toEqual([machineFile.id]);
    expect(overview.semantic.operations[0].implementationLinks).toEqual([
      expect.objectContaining({
        fileId: machineFile.id,
        operationId: operation.id,
        subsystemId: "subsystem:catalog"
      })
    ]);
    expect(overview.semantic.implementationLinks).toHaveLength(1);
    expect(overview.semantic).not.toHaveProperty("dependencies");
    expect(overview.semantic).not.toHaveProperty("executionSide");
  });

  it("normalizes unknown selector values to Machine City", () => {
    expect(genesisCityKind("program")).toBe("program");
    expect(genesisCityKind("anything-else")).toBe("machine");
  });
});
