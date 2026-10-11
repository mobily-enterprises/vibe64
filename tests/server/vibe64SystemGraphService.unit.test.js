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

test('validated City reads share an unchanged snapshot and invalidate replacements, failures and deletion', async () => {
  await withTempRoot(async root => {
    await writeCities(root);
    const [first, concurrent] = await Promise.all([readGenesisCity(root, 'machine'), readGenesisCity(root, 'machine')]);
    assert.equal(first, concurrent, 'concurrent status and view reads share validation');
    assert.equal(await readGenesisCity(root, 'machine'), first);
    const cityPath = path.join(root, GENESIS_MACHINE_CITY_PATH);
    await writeJson(cityPath, { ...machineCityFixture(), codeHash: 'changed-code-hash' });
    const changed = await readGenesisCity(root, 'machine');
    assert.notEqual(changed, first);
    assert.equal(changed.city.codeHash, 'changed-code-hash');
    assert.equal(first.city.codeHash, 'machine-code-hash', 'an already loaded view retains its own snapshot');
    await writeFile(cityPath, '{invalid', 'utf8');
    await assert.rejects(readGenesisCity(root, 'machine'), /invalid JSON/);
    await assert.rejects(readGenesisCity(root, 'machine'), /invalid JSON/);
    await writeJson(cityPath, machineCityFixture());
    assert.equal((await readGenesisCity(root, 'machine')).city.codeHash, 'machine-code-hash');
    const otherRoot = path.join(root, 'other-project');
    await writeJson(path.join(otherRoot, GENESIS_MACHINE_CITY_PATH), { ...machineCityFixture(), codeHash: 'other-project' });
    assert.equal((await readGenesisCity(otherRoot, 'machine')).city.codeHash, 'other-project');
    assert.equal((await readGenesisCity(root, 'machine')).city.codeHash, 'machine-code-hash');
    await rm(cityPath);
    assert.equal((await readGenesisCity(root, 'machine')).exists, false);
  });
});

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
      inspectorReader: async () => ({ status: "unconfigured", inspectors: [] }),
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
      write: true,
      signal: calls[0].signal
    }]);
    assert.ok(calls[0].signal instanceof AbortSignal);
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

function architectureFixture() {
  const machine = machineCityFixture();
  machine.architecture = {
    schema: 'genesis.architecture.v1', snapshotId: 'fixture-snapshot',
    subsystems: [{ id: 'directory:.', root: '.', fileIds: ['file:src/catalog.js'], parentId: null }],
    files: [{ ...machine.buildings[0], subsystemId: 'directory:.' }],
    symbols: machine.functions.map(symbol => ({ ...symbol, rangeAvailable: false })), relations: [], packages: [],
    uiDiscovery: { status: 'configured', discoveries: [] }, ui: null,
    capabilities: { symbols: 'partial', dependencies: 'partial', pages: 'complete', runtimeCalls: 'unsupported' }, diagnostics: [],
  };
  return machine;
}

const emptyObservations = () => ({ schema: 'genesis.architecture-observations.v1', adapter: 'fixture', inputs: [], pages: [], registrations: [], components: [], componentUses: [], entryOperations: [], operationUses: [], diagnostics: [], capabilities: { pages: 'complete', components: 'partial', entryOperations: 'partial', operationUses: 'partial' } });
const inspectorFixture = () => ({ status: 'ready', stackHash: 'stack-hash', inspectors: [{ id: 'fixture', title: 'Fixture', runtimeRequirements: ['nodejs'], workdir: '.', argv: ['node', 'inspect.mjs'], timeout: 1000, maxBuffer: 4096 }] });

test('configured architecture inspection uses managed execution and publishes only validated observations', async () => {
  await withTempRoot(async root => {
    const projectService = { ...projectServiceFor(root), async readCurrentProject() { return { slug: 'fixture' }; }, async projectInspectionEnvironment() { return { FIXTURE: '1' }; } };
    const calls = []; const machine = architectureFixture();
    const service = createService({ projectService, inspectorReader: async () => inspectorFixture(), runtimeReader: ids => { assert.deepEqual(ids, ['nodejs']); return { available: true, runtimes: ['fixture-node'] }; },
      refresher: async input => { calls.push(input); return { machine, program: programCityFixture() }; },
      runCommand: async input => {
        assert.equal(input.actor, 'app'); assert.equal(input.mode, 'capture'); assert.equal(input.purpose, 'source'); assert.equal(input.envPolicy, 'project');
        assert.equal(input.cwd, root); assert.deepEqual(input.allowedRoots, [root]); assert.equal(input.command, 'node'); assert.deepEqual(input.args, ['inspect.mjs']);
        assert.deepEqual(input.runtimes, ['fixture-node']); assert.equal(input.timeout, 1000); assert.equal(input.maxBuffer, 4096); assert.ok(input.signal instanceof AbortSignal);
        const request = JSON.parse(input.input);
        assert.equal(request.schema, 'vibe64.architecture-inspection-input.v1'); assert.deepEqual(request.files, [{ path: 'src/catalog.js', hash: 'catalog-hash' }]);
        return { ok: true, stdout: JSON.stringify(emptyObservations()) };
      }
    });
    assert.equal((await service.refresh({ sessionId: 'session-1' })).ok, true);
    assert.deepEqual(calls.map(input => input.write), [false, true]);
    assert.equal(calls[1].observations.adapter, 'fixture');
    assert.equal(calls[0].signal, calls[1].signal);
  });
});

test('architecture refresh respects the existing assistant write admission lock', async () => {
  await withTempRoot(async root => {
    const base = projectServiceFor(root);
    const service = createService({
      projectService: { async createRuntime() {
        const runtime = await base.createRuntime();
        return { ...runtime, store: { async runSessionExclusive(sessionId, lock, operation, options) {
          assert.equal(sessionId, 'session-1'); assert.equal(lock, 'agent-write-mode'); assert.equal(options.operation, 'architecture-refresh');
          return { acquired: false, blockingOperation: 'prepare-agent-session' };
        } } };
      } },
      inspectorReader: async () => { throw new Error('Must not inspect while admission is blocked'); },
      refresher: async () => { throw new Error('Must not index while admission is blocked'); }
    });
    const result = await service.refresh({ sessionId: 'session-1' });
    assert.equal(result.ok, false); assert.equal(result.code, 'vibe64_agent_write_mode_busy');
    assert.match(result.error, /reconnecting/u);
  });
});

test('invalid output and changed Stack never reach architecture publication', async () => {
  await withTempRoot(async root => {
    const projectService = { ...projectServiceFor(root), async readCurrentProject() { return {}; }, async projectInspectionEnvironment() { return {}; } };
    for (const failure of ['invalid-json', 'invalid-evidence', 'changed-stack']) {
      const calls = []; let reads = 0;
      const service = createService({ projectService, runtimeReader: () => ({ available: true, runtimes: [] }),
        inspectorReader: async () => ({ ...inspectorFixture(), stackHash: failure === 'changed-stack' && reads++ ? 'changed' : 'stack-hash' }),
        refresher: async input => { calls.push(input); return { machine: architectureFixture(), program: programCityFixture() }; },
        runCommand: async () => ({ ok: true, stdout: failure === 'invalid-json' ? 'broken' : JSON.stringify(failure === 'invalid-evidence' ? { ...emptyObservations(), inputs: [{ path: 'src/catalog.js', hash: 'stale' }] } : emptyObservations()) })
      });
      const result = await service.refresh({ sessionId: 'session-1' });
      assert.equal(result.ok, false, failure);
      assert.deepEqual(calls.map(input => input.write), [false], failure);
    }
  });
});

test('cancel waits for managed cleanup, keeps the last artifact and prevents overlapping refresh', async () => {
  await withTempRoot(async root => {
    const machine = architectureFixture(); await writeCities(root, { machine });
    const projectService = { ...projectServiceFor(root), async readCurrentProject() { return {}; }, async projectInspectionEnvironment() { return {}; } };
    let started; const ready = new Promise(resolve => { started = resolve; });
    let interrupted; const aborted = new Promise(resolve => { interrupted = resolve; });
    let cleanup; const cleanupReady = new Promise(resolve => { cleanup = resolve; });
    const calls = [];
    const service = createService({ projectService, inspectorReader: async () => inspectorFixture(), runtimeReader: () => ({ available: true, runtimes: [] }),
      refresher: async input => { calls.push(input); return { machine, program: programCityFixture() }; },
      runCommand: async ({ signal }) => { started(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); interrupted(); await cleanupReady; return { ok: false, stdout: '' }; }
    });
    const refresh = service.refresh({ sessionId: 'session-1' }); await ready;
    const cancel = service.cancelRefresh({ sessionId: 'session-1' }); await aborted;
    assert.equal((await service.refresh({ sessionId: 'session-1' })).code, 'vibe64_architecture_refresh_busy');
    let completed = false; cancel.then(() => { completed = true; }); await Promise.resolve(); assert.equal(completed, false);
    cleanup();
    assert.equal((await refresh).code, 'vibe64_architecture_cancelled'); assert.equal((await cancel).cancelled, true);
    assert.deepEqual(calls.map(input => input.write), [false]);
    assert.equal((await service.readArchitecture({ sessionId: 'session-1' })).architecture.snapshotId, machine.architecture.snapshotId);
    assert.deepEqual((await service.readMachineCity({ sessionId: 'session-1' })).city.architecture, machine.architecture);
    assert.equal((await service.cancelRefresh({ sessionId: 'session-1' })).cancelled, false);
  });
});


test('Architecture view keeps public ranges and complete dependency evidence without returning private symbol detail', async () => {
  await withTempRoot(async root => {
    const machine = architectureFixture();
    const publicSymbol = { id: 'public', fileId: machine.architecture.files[0].id, path: machine.architecture.files[0].path, name: 'run', qualifiedName: 'run', kind: 'function', visibility: 'public', start: {line:1,column:1}, end: {line:2,column:1}, rangeAvailable: true, parameters: ['request: Request'], returnType: 'Response' };
    publicSymbol.visibilityScope = 'crate';
    machine.architecture.symbols = [publicSymbol, { ...publicSymbol, id: 'internal', visibility: 'internal' }];
    const evidence = { path: machine.architecture.files[0].path, hash: machine.architecture.files[0].hash, start: {line:1,column:1}, end: {line:1,column:20} };
    machine.architecture.relations = [{ id: 'dependency', fromFileId: publicSymbol.fileId, targetFileId: publicSymbol.fileId, resolution: 'resolved', kind: 'type-import', typeOnly: true, specifier: './catalog.js', evidence }];
    await writeCities(root, { machine });
    const service = createService({ projectService: projectServiceFor(root) });
    const response = await service.readArchitecture({sessionId:'session-1'});
    assert.equal(response.ok, true, response.error);
    assert.deepEqual(response.architecture.symbols.map(symbol => symbol.id), ['public']);
    assert.deepEqual(response.architecture.symbols[0].start, publicSymbol.start);
    assert.deepEqual(response.architecture.symbols[0].end, publicSymbol.end);
    assert.equal(response.architecture.symbols[0].visibilityScope, 'crate');
    assert.deepEqual(response.architecture.symbols[0].parameters, ['request: Request']);
    assert.equal(response.architecture.symbols[0].returnType, 'Response');
    assert.equal(response.architecture.files[0].dependencies, undefined);
    assert.deepEqual(response.architecture.relations[0].evidence, evidence);
    assert.equal(response.architecture.relations[0].typeOnly, true);
    assert.deepEqual((await service.readMachineCity({sessionId:'session-1'})).city.architecture, machine.architecture);
  });
});

test('Architecture projects hash-matched source size and declared entry files without running an inspector', async () => {
  await withTempRoot(async root => {
    const machine = architectureFixture();
    await writeCities(root, { machine });
    const service = createService({ projectService: projectServiceFor(root),
      inspectorReader: async ({projectRoot}) => { assert.equal(projectRoot, root); return { status: 'ready', inspectors: [{ entryFiles: ['src/catalog.js', 'missing/Main.kt'] }] }; },
      layoutReader: async ({projectRoot}) => { assert.equal(projectRoot, root); return { status: 'ready', groups: [{id:'work',title:'Application work',kind:'layer',purpose:'Handles work.',subsystems:[{root:'.',title:'Catalog',description:'Lists books.'}]}] }; },
      runCommand: async () => { throw new Error('Read must not execute project commands'); }
    });
    const response = await service.readArchitecture({sessionId:'session-1'});
    assert.equal(response.ok, true, response.error);
    assert.equal(response.architecture.files[0].sourceLines, 2);
    assert.equal(response.architecture.layout.groups[0].title, 'Application work');
    assert.deepEqual((await service.readMachineCity({sessionId:'session-1'})).city.architecture, machine.architecture, 'presentation declarations do not rewrite native ownership or evidence');
    assert.deepEqual(response.architecture.entryPoints, [
      { file: 'src/catalog.js', fileId: 'file:src/catalog.js', subsystemId: 'directory:.', resolution: 'resolved' },
      { file: 'missing/Main.kt', fileId: null, subsystemId: null, resolution: 'unresolved' }
    ]);
    machine.architecture.files[0].hash = 'other-snapshot';
    await writeCities(root, { machine });
    assert.equal((await service.readArchitecture({sessionId:'session-1'})).architecture.files[0].sourceLines, null);
    const malformed = createService({ projectService: projectServiceFor(root), inspectorReader: async () => { throw new Error('Malformed entry declarations'); }, layoutReader: async () => { throw new Error('Malformed group declarations'); } });
    const retained = await malformed.readArchitecture({sessionId:'session-1'});
    assert.equal(retained.ok, true);
    assert.match(retained.architecture.entryPointDiagnostic, /Malformed entry declarations/);
    assert.match(retained.architecture.layoutDiagnostic, /Malformed group declarations/);
    assert.equal(retained.architecture.layout, null);
  });
});
