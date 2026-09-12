import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  GENESIS_MACHINE_CITY_PATH,
  GENESIS_PROGRAM_CITY_PATH
} from "../../packages/vibe64-genesis/src/server/index.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  readGenesisCity
} from "../../packages/vibe64-system-graph/src/server/genesisCities.js";
import {
  createService
} from "../../packages/vibe64-system-graph/src/server/service.js";

function machineCityFixture() {
  return {
    schema: "genesis.machine-city.v1",
    schemaVersion: 1,
    status: "current",
    codeHash: "machine-code-hash",
    stackComponents: ["nodejs"],
    indexers: ["javascript"],
    diagnostics: [],
    districts: [{
      id: "directory:.",
      path: "",
      title: "Project",
      parentId: null
    }],
    buildings: [{
      id: "file:src/catalog.js",
      path: "src/catalog.js",
      title: "catalog.js",
      districtId: "directory:.",
      language: "javascript",
      role: "source",
      mode: 0o100644,
      bytes: 42,
      lines: 2,
      hash: "catalog-hash",
      extractors: ["javascript"],
      functionIds: ["function:src/catalog.js:listBooks:function:1:1"],
      publicFunctionCount: 1,
      internalFunctionCount: 0
    }],
    functions: [{
      id: "function:src/catalog.js:listBooks:function:1:1",
      name: "listBooks",
      qualifiedName: "listBooks",
      kind: "function",
      visibility: "public",
      container: null,
      path: "src/catalog.js",
      fileId: "file:src/catalog.js",
      line: 1,
      column: 1,
      parameters: [],
      async: false,
      generator: false,
      static: false,
      role: "source",
      language: "javascript",
      extractor: "javascript"
    }]
  };
}

function programCityFixture() {
  return {
    schema: "genesis.program-city.v1",
    schemaVersion: 1,
    status: "current",
    programHash: "program-hash",
    diagnostics: [],
    districts: [{
      id: "subsystem:catalog",
      path: "catalog",
      title: "catalog",
      parentId: null
    }],
    buildings: [{
      id: "operation:catalog/list-books",
      name: "list-books",
      title: "List books",
      description: "Lists the catalogue.",
      publicContract: "Returns the current books.",
      implementationMap: "- `listBooks()` returns the records.",
      path: "genesis/program/catalog/list-books.md",
      subsystem: "catalog",
      districtId: "subsystem:catalog",
      sources: ["src/catalog.js"],
      sourceFileIds: ["file:src/catalog.js"]
    }],
    links: [{
      kind: "implemented-by",
      fromId: "operation:catalog/list-books",
      toId: "file:src/catalog.js"
    }]
  };
}

function projectServiceFor(root) {
  return {
    async createRuntime() {
      return {
        async getSession(sessionId) {
          return {
            metadata: {
              source_kind: "session_clone",
              source_path: root,
              source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
            },
            sessionId,
          };
        }
      };
    }
  };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeCities(root, {
  machine = machineCityFixture(),
  program = programCityFixture()
} = {}) {
  await Promise.all([
    writeJson(path.join(root, GENESIS_MACHINE_CITY_PATH), machine),
    writeJson(path.join(root, GENESIS_PROGRAM_CITY_PATH), program)
  ]);
}

async function withTempRoot(operation) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-genesis-city-"));
  const root = path.join(temporaryRoot, "sessions", "active", "session-1", "source");
  try {
    await mkdir(root, { recursive: true });
    await operation(root);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

test("Genesis City status reports both missing documents without scanning source", async () => {
  await withTempRoot(async (root) => {
    await writeFile(path.join(root, "broken-source.js"), "this is deliberately not valid JavaScript {\n", "utf8");
    const service = createService({
      projectService: projectServiceFor(root),
      refresher: async () => {
        throw new Error("refresh should not run while reading status");
      }
    });

    const status = await service.readStatus({ sessionId: "session-1" });

    assert.equal(status.ok, true);
    assert.equal(status.status, "missing");
    assert.deepEqual(status.cities, {
      machine: {
        available: false,
        error: null,
        path: GENESIS_MACHINE_CITY_PATH,
        state: "missing"
      },
      program: {
        available: false,
        error: null,
        path: GENESIS_PROGRAM_CITY_PATH,
        state: "missing"
      }
    });
    const missing = await service.readMachineCity({ sessionId: "session-1" });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "vibe64_genesis_city_missing");
  });
});

test("Genesis Machine and Program Cities are returned without projection or invented fields", async () => {
  await withTempRoot(async (root) => {
    const machine = machineCityFixture();
    const program = programCityFixture();
    await writeCities(root, { machine, program });
    const service = createService({
      projectService: projectServiceFor(root)
    });

    const status = await service.readStatus({ sessionId: "session-1" });
    assert.equal(status.status, "ready");
    assert.equal(status.cities.machine.status, "current");
    assert.equal(status.cities.program.status, "current");

    const machineResult = await service.readMachineCity({ sessionId: "session-1" });
    const programResult = await service.readProgramCity({ sessionId: "session-1" });
    assert.deepEqual(machineResult, {
      city: machine,
      kind: "machine",
      ok: true,
      path: GENESIS_MACHINE_CITY_PATH
    });
    assert.deepEqual(programResult, {
      city: program,
      kind: "program",
      ok: true,
      path: GENESIS_PROGRAM_CITY_PATH
    });
  });
});

test("Genesis City schema validation rejects corrupt documents and broken references", async () => {
  await withTempRoot(async (root) => {
    const invalidMachine = machineCityFixture();
    invalidMachine.schema = "genesis.machine-city.v0";
    await writeCities(root, { machine: invalidMachine });
    const service = createService({
      projectService: projectServiceFor(root)
    });

    const status = await service.readStatus({ sessionId: "session-1" });
    assert.equal(status.ok, true);
    assert.equal(status.status, "invalid");
    assert.equal(status.cities.machine.state, "invalid");
    assert.equal(status.cities.machine.error.code, "vibe64_invalid_genesis_city");

    const response = await service.readMachineCity({ sessionId: "session-1" });
    assert.equal(response.ok, false);
    assert.equal(response.code, "vibe64_invalid_genesis_city");

    const brokenReference = machineCityFixture();
    brokenReference.buildings[0].functionIds = ["function:missing"];
    await writeJson(path.join(root, GENESIS_MACHINE_CITY_PATH), brokenReference);
    await assert.rejects(
      readGenesisCity(root, "machine"),
      (error) => error.code === "vibe64_invalid_genesis_city" && /unknown function id/u.test(error.message)
    );
  });
});

test("refresh delegates to Genesis exactly once and validates its native result", async () => {
  await withTempRoot(async (root) => {
    const machine = machineCityFixture();
    const program = programCityFixture();
    const calls = [];
    const service = createService({
      projectService: projectServiceFor(root),
      refresher: async (input) => {
        calls.push(input);
        return {
          changedFiles: [GENESIS_MACHINE_CITY_PATH, GENESIS_PROGRAM_CITY_PATH],
          diagnostics: [],
          machine,
          program,
          status: "ready",
          summary: "Indexed one function and one Program operation."
        };
      }
    });

    const refreshed = await service.refresh({ sessionId: "session-1" });

    assert.deepEqual(calls, [{
      projectRoot: root,
      write: true
    }]);
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.status, "ready");
    assert.deepEqual(refreshed.cities, { machine, program });
    assert.deepEqual(refreshed.changedFiles, [
      GENESIS_MACHINE_CITY_PATH,
      GENESIS_PROGRAM_CITY_PATH
    ]);
  });
});

test("subsystems read the authored Genesis map for the selected source without refreshing Cities", async () => {
  await withTempRoot(async (root) => {
    const map = { contract: "genesis.subsystems.v0", status: "missing", subsystems: [] };
    const service = createService({ projectService: projectServiceFor(root),
      subsystemReader: async ({ projectRoot }) => { assert.equal(projectRoot, root); return map; },
      refresher: async () => { throw new Error("Reading subsystems must not write indexes"); }
    });
    assert.deepEqual(await service.readSubsystems({ sessionId: "session-1" }), { ok: true, ...map });
  });
});
