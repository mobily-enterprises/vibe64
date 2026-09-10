import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  vibe64OutputsInspection
} from "../../packages/vibe64-genesis/src/server/outputs.js";
import {
  createVibe64OutputTargetTerminalSpec,
  inspectVibe64OutputsForContext,
  inspectVibe64WorkspaceSetupForContext,
  listVibe64OutputTargets,
  vibe64OutputCommand,
  vibe64RuntimePacks,
  vibe64WebOutputDescriptor
} from "../../packages/vibe64-terminals/src/server/vibe64OutputTargets.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  runtimePackManagedCommands
} from "../../packages/vibe64-execution/src/server/runtime/runtimePacks.js";
import {
  listOutputTargets,
  workspaceSetupLaunchDisabledReason
} from "../../packages/vibe64-terminals/src/server/outputTargetTerminal.js";

function outputsInspection(targets = []) {
  return {
    components: ["unit"],
    diagnostics: [],
    resources: [],
    runtimeRequirements: [...new Set(targets.flatMap((target) => target.runtimeRequirements || []))],
    stackHash: "sha256:unit",
    status: targets.length ? "ready" : "unconfigured",
    targets
  };
}

function webOutputTarget(overrides = {}) {
  return {
    available: true,
    default: true,
    disabledReason: null,
    downloads: [],
    id: "app",
    label: "Run app",
    mode: "interactive",
    presentation: {
      kind: "web",
      preferredPort: 49_000 + crypto.randomInt(500),
      readiness: {
        kind: "http",
        method: "GET",
        path: "/api/health",
        status: 200
      },
      urlPath: "/catalogue"
    },
    runtimeRequirements: ["nodejs"],
    source: "project",
    steps: [{
      argv: ["npm", "run", "dev", "--", "--host={host}", "--port={port}"],
      label: "Start app",
      role: "run"
    }],
    workdir: ".",
    ...overrides
  };
}

test("the C and C++ pack owns every advertised compiler, build, binary, and debugger command", () => {
  assert.deepEqual(runtimePackManagedCommands("cpp"), [
    "addr2line",
    "ar",
    "as",
    "c++",
    "c++filt",
    "cc",
    "clang",
    "clang++",
    "cmake",
    "cpack",
    "cpp",
    "ctest",
    "g++",
    "gcc",
    "gcore",
    "gdb",
    "gdb-add-index",
    "gdbserver",
    "gprof",
    "gstack",
    "ld",
    "ld.bfd",
    "ld.gold",
    "ld.lld",
    "ld64.lld",
    "lld",
    "lld-link",
    "lldb",
    "lldb-dap",
    "lldb-server",
    "make",
    "ninja",
    "nm",
    "objcopy",
    "objdump",
    "pkg-config",
    "ranlib",
    "readelf",
    "size",
    "strings",
    "strip",
    "wasm-ld"
  ]);
});

function outputTargetView(overrides = {}) {
  return {
    available: true,
    default: true,
    disabledReason: "",
    downloads: [],
    id: "app",
    label: "Run app",
    mode: "interactive",
    presentation: { kind: "web" },
    ...overrides
  };
}

async function outputContext(t) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-genesis-output-"));
  t.after(() => rm(temporaryRoot, {
    force: true,
    recursive: true
  }));
  const projectContextRoot = path.join(temporaryRoot, "namespace");
  const sourceRoot = path.join(
    projectContextRoot,
    "sessions",
    "active",
    "session-unit",
    "source"
  );
  await mkdir(sourceRoot, { recursive: true });
  return {
    projectEnvironment: {
      DB_PASSWORD: "managed-project-value"
    },
    runtime: {
      adapter: null,
      async resolvePromptEnvironment() {
        return { DB_PASSWORD: "do-not-return-this" };
      }
    },
    session: {
      metadata: {
        repository_mode: "local_source",
        source_kind: "session_clone",
        source_path: sourceRoot,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      projectContextRoot,
      sessionId: "session-unit",
      sessionRoot: path.join(temporaryRoot, "state", "session-unit")
    },
    targetRoot: projectContextRoot
  };
}

test("Vibe64 abstract runtimes map only through Vibe64-owned pinned packs", () => {
  assert.deepEqual(vibe64RuntimePacks(["nodejs", "php", "composer", "cpp"]), {
    available: true,
    disabledReason: "",
    runtimes: ["node26", "php", "composer", "cpp"],
    unsupported: []
  });
  assert.deepEqual(vibe64RuntimePacks(["future-runtime"]), {
    available: false,
    disabledReason: "Vibe64 does not provide a pinned runtime for: future-runtime.",
    runtimes: [],
    unsupported: ["future-runtime"]
  });
});

test("Vibe64 output argv substitution remains shell-safe", () => {
  assert.equal(
    vibe64OutputCommand([
      "tool",
      "--host={host}",
      "--port",
      "{port}",
      "$(touch /tmp/not-run)",
      "it's-safe"
    ], {
      host: "127.0.0.1",
      port: 4123
    }),
    "tool --host=127.0.0.1 --port 4123 '$(touch /tmp/not-run)' 'it'\\''s-safe'"
  );
});

test("web output descriptors retain web-only identity and readiness details", () => {
  const previewIdentity = {
    command: [".vibe64/preview-identity"],
    identityTypes: ["user"],
    runtimes: ["nodejs"]
  };
  const descriptor = vibe64WebOutputDescriptor(webOutputTarget({ previewIdentity }), {
    port: 4123,
    worktreePath: "/tmp/vibe64-genesis-output"
  });

  assert.deepEqual(descriptor.previewIdentity, {
    ...previewIdentity,
    runtimes: ["node26"]
  });
  assert.deepEqual(descriptor.readiness, {
    kind: "http",
    method: "GET",
    path: "/api/health",
    status: 200
  });
});

test("neutral sessions list output targets without exposing resource values or source paths", async (t) => {
  const context = await outputContext(t);
  let received = null;
  const targets = await listVibe64OutputTargets(context, {
    inspect(input) {
      received = input;
      return outputsInspection([
        webOutputTarget({
          downloads: [{
            id: "bundle",
            mediaType: "application/zip",
            name: "bundle.zip",
            path: "dist/bundle.zip"
          }]
        }),
        webOutputTarget({
          available: false,
          default: false,
          disabledReason: "MySQL needs one of: DB_PASSWORD.",
          id: "blocked",
          label: "Blocked app"
        })
      ]);
    }
  });

  assert.equal(received.projectRoot, context.session.metadata.source_path);
  assert.equal(received.environment.DB_PASSWORD, "managed-project-value");
  assert.deepEqual(targets, [outputTargetView({
    downloads: [{
      id: "bundle",
      mediaType: "application/zip",
      name: "bundle.zip"
    }]
  }), {
    available: false,
    disabledReason: "MySQL needs one of: DB_PASSWORD.",
    downloads: [],
    id: "blocked",
    label: "Blocked app",
    mode: "interactive",
    presentation: { kind: "web" }
  }]);
  assert.doesNotMatch(JSON.stringify(targets), /dist\/bundle|do-not-return-this/u);
});

test("blocked empty Outputs preserve their actionable inspection diagnostic", async (t) => {
  const context = await outputContext(t);
  const diagnostic = {
    code: "STACK_SECTION_AMBIGUOUS",
    message: "Selected Stack components provide competing `Outputs` sections: component:jskit, component:laravel. Add one project `## Outputs` section to select the exact declaration.",
    details: {
      name: "Outputs",
      sources: ["component:jskit", "component:laravel"]
    }
  };
  const outputs = vibe64OutputsInspection({
    environment: { diagnostics: [], stackHash: "sha256:unit" },
    section: {
      diagnostics: [diagnostic],
      lines: [],
      stackHash: "sha256:unit",
      status: "blocked"
    }
  });
  assert.equal(outputs.status, "blocked");
  assert.deepEqual(outputs.targets, []);
  const options = { inspect: () => outputs };
  const expectedError = { code: diagnostic.code, message: diagnostic.message };

  await t.test("context inspection", async () => {
    await assert.rejects(inspectVibe64OutputsForContext(context, options), expectedError);
  });
  await t.test("target listing", async () => {
    await assert.rejects(listVibe64OutputTargets(context, options), expectedError);
  });
  await t.test("target specification", async () => {
    await assert.rejects(createVibe64OutputTargetTerminalSpec({
      context,
      outputTargetId: "app"
    }, options), expectedError);
  });
});

test("genuinely unconfigured Outputs remain an empty target list", async (t) => {
  const context = await outputContext(t);
  for (const section of [
    { lines: [], status: "unconfigured" },
    { lines: ["- Nothing."], status: "ready" }
  ]) {
    const outputs = vibe64OutputsInspection({
      environment: { diagnostics: [], stackHash: "sha256:unit" },
      section: { ...section, diagnostics: [], stackHash: "sha256:unit" }
    });
    const options = { inspect: () => outputs };
    const inspection = await inspectVibe64OutputsForContext(context, options);
    assert.equal(inspection.status, "unconfigured");
    assert.deepEqual(inspection.targets, []);
    assert.deepEqual(await listVibe64OutputTargets(context, options), []);
  }
});

test("configured blocked Outputs keep disabled targets without exposing private inputs", async (t) => {
  const context = await outputContext(t);
  const disabledReason = "MySQL needs one of: DB_PASSWORD.";
  const outputs = vibe64OutputsInspection({
    environment: {
      diagnostics: [{ code: "STACK_RESOURCE_MISSING", message: disabledReason }],
      stackHash: "sha256:unit"
    },
    section: {
      diagnostics: [],
      lines: [
        "### Target `app`: Run app",
        "- Default.",
        "- Mode: `interactive`",
        "- Workdir: `private-workdir`",
        "- Runtimes: `nodejs`",
        "- Run `Start app`: `npm` `run` `dev`",
        "#### Presentation",
        "- Kind: `web`",
        "- Ready when: `GET` `/api/health` returns `200`",
        "#### Download `bundle`",
        "- Path: `dist/bundle.zip`",
        "- Name: `bundle.zip`",
        "- Media type: `application/zip`"
      ],
      source: "component:jskit",
      stackHash: "sha256:unit",
      status: "ready"
    }
  });
  const received = [];
  const options = {
    inspect(input) {
      received.push(input);
      return outputs;
    }
  };
  assert.equal((await inspectVibe64OutputsForContext(context, options)).status, "blocked");
  const targets = await listVibe64OutputTargets(context, options);
  assert.deepEqual(targets, [outputTargetView({
    available: false,
    disabledReason,
    downloads: [{ id: "bundle", mediaType: "application/zip", name: "bundle.zip" }]
  })]);
  assert.deepEqual(await createVibe64OutputTargetTerminalSpec({
    context,
    outputTargetId: "app"
  }, options), { ok: false, message: disabledReason });
  assert.equal(received.length, 3);
  for (const input of received) {
    assert.equal(input.projectRoot, context.session.metadata.source_path);
    assert.equal(input.environment.DB_PASSWORD, "managed-project-value");
  }
  assert.doesNotMatch(
    JSON.stringify(targets),
    /private-workdir|dist\/bundle|component:jskit|do-not-return-this|managed-project-value/u
  );
});

test("missing Genesis Stack leaves Outputs and workspace setup unconfigured", async (t) => {
  const context = await outputContext(t);
  const inspect = async () => {
    const error = new Error("Run genesis init first.");
    error.code = "STACK_REQUIRED";
    throw error;
  };

  assert.deepEqual(await inspectVibe64OutputsForContext(context, { inspect }), {
    status: "unconfigured",
    targets: []
  });
  assert.deepEqual(await inspectVibe64WorkspaceSetupForContext(context, { inspect }), {
    recipeHash: "",
    status: "unconfigured",
    steps: []
  });
});

test("workspace setup disables outputs only for a failed current recipe", () => {
  assert.equal(workspaceSetupLaunchDisabledReason({
    workspaceSetup: {
      diagnostic: "npm install failed",
      recipeHash: "sha256:recipe",
      status: "failed"
    }
  }, {
    recipeHash: "sha256:recipe",
    status: "ready"
  }), "npm install failed");
  assert.equal(workspaceSetupLaunchDisabledReason({
    workspaceSetup: {
      diagnostic: "stale failure",
      recipeHash: "sha256:old",
      status: "failed"
    }
  }, {
    recipeHash: "sha256:new",
    status: "ready"
  }), "");
});

test("a pending workspace recipe remains runnable so the request can prepare it", async (t) => {
  const context = await outputContext(t);
  context.session.workspaceSetup = { status: "unconfigured" };

  assert.deepEqual(await listOutputTargets(context, {
    inspectOutputs: () => outputsInspection([webOutputTarget()]),
    inspectWorkspaceSetup: () => ({
      recipeHash: "sha256:install",
      status: "ready",
      steps: [{
        argv: ["npm", "install"],
        label: "Install dependencies",
        runtimeRequirements: ["nodejs"],
        workdir: "."
      }]
    })
  }), [outputTargetView()]);
});

test("web outputs translate through the existing private web-preview terminal seam", async (t) => {
  const context = await outputContext(t);
  const sourceSubdirectory = path.join(context.session.metadata.source_path, "web");
  await mkdir(sourceSubdirectory);
  const target = webOutputTarget({
    steps: [{
      argv: ["npm", "run", "prepare"],
      label: "Prepare app",
      role: "prepare"
    }, {
      argv: ["npm", "run", "dev", "--", "--host={host}", "--port={port}"],
      label: "Start app",
      role: "run"
    }],
    workdir: "web"
  });
  const spec = await createVibe64OutputTargetTerminalSpec({
    context,
    outputTargetId: target.id
  }, {
    inspect: () => outputsInspection([target])
  });
  t.after(() => spec.releasePortReservation?.());

  assert.equal(spec.ok, true);
  assert.equal(spec.stackHash, "sha256:unit");
  assert.equal(spec.cwd, sourceSubdirectory);
  assert.deepEqual(spec.runtimes, ["node26"]);
  assert.equal(spec.metadata.vibe64OutputsSource, "project");
  assert.equal(spec.metadata.outputPresentationKind, "web");
  assert.equal(spec.metadata.urlPath, "/catalogue");
  assert.match(spec.commandPreview, /npm run prepare/u);
  assert.match(spec.commandPreview, /--host=127\.0\.0\.1/u);
  assert.match(spec.commandPreview, new RegExp(`--port=${spec.metadata.port}`, "u"));
  assert.match(spec.args().join(" "), /VIBE64_LAUNCH_READY_V1/u);
  assert.match(spec.args().join(" "), /VIBE64_OUTPUT_RESULTS_READY_V1/u);
  assert.deepEqual(spec.metadata.readiness, target.presentation.readiness);
});

test("terminal outputs use a generic PTY spec and exact declared runtimes", async (t) => {
  const context = await outputContext(t);
  const target = webOutputTarget({
    id: "cli",
    label: "Run CLI",
    presentation: { kind: "terminal" },
    runtimeRequirements: ["cpp"],
    steps: [{
      argv: ["./build/example"],
      label: "Run example",
      role: "run"
    }]
  });
  const spec = await createVibe64OutputTargetTerminalSpec({
    context,
    outputTargetId: target.id
  }, {
    inspect: () => outputsInspection([target])
  });

  assert.equal(spec.ok, true);
  assert.equal(spec.stackHash, "sha256:unit");
  assert.equal(spec.command, "bash");
  assert.deepEqual(spec.runtimes, ["cpp"]);
  assert.equal(spec.metadata.outputPresentationKind, "terminal");
  assert.equal(spec.reuseRunning, true);
  assert.match(spec.args[1], /exec \.\/build\/example/u);
});

for (const kind of ["terminal", "web"]) {
  test(`${kind} output specs accept '..build' and reject outside workdirs`, async (t) => {
    const context = await outputContext(t);
    const sourceRoot = context.session.metadata.source_path;
    const buildDirectory = path.join(sourceRoot, "..build");
    const outsideDirectory = path.resolve(sourceRoot, "../outside");
    await mkdir(buildDirectory);
    await mkdir(outsideDirectory);
    const outputs = vibe64OutputsInspection({
      environment: { diagnostics: [], stackHash: "sha256:unit" },
      section: {
        diagnostics: [],
        lines: [
          "### Target `app`: Run app",
          "- Mode: `interactive`",
          "- Workdir: `..build`",
          "- Runtimes: `nodejs`",
          "- Run `Start app`: `npm` `run` `dev`",
          "#### Presentation",
          `- Kind: \`${kind}\``,
          ...(kind === "web" ? ["- Ready when: `GET` `/api/health` returns `200`"] : [])
        ],
        source: "project",
        stackHash: "sha256:unit",
        status: "ready"
      }
    });
    assert.equal(outputs.status, "ready");
    assert.equal(outputs.targets[0].workdir, "..build");

    await t.test("accepts a declared ..build directory", async (t) => {
      const spec = await createVibe64OutputTargetTerminalSpec({
        context,
        outputTargetId: "app"
      }, { inspect: () => outputs });
      t.after(() => spec.releasePortReservation?.());

      assert.equal(spec.ok, true, spec.message);
      assert.equal(spec.cwd, buildDirectory);
    });

    // Bypass the parser's rejection to exercise each terminal-spec containment guard.
    for (const [label, workdir] of [
      ["parent directory", ".."],
      ["relative outside directory", "../outside"],
      ["absolute outside directory", outsideDirectory]
    ]) {
      await t.test(`rejects ${label}`, async (t) => {
        const spec = await createVibe64OutputTargetTerminalSpec({
          context,
          outputTargetId: "app"
        }, {
          inspect: () => outputsInspection([{ ...outputs.targets[0], workdir }])
        });
        t.after(() => spec.releasePortReservation?.());

        assert.equal(spec.ok, false);
        assert.match(spec.message, /workdir is outside the session source\./u);
      });
    }
  });
}

test("finite outputs build once and declare immutable result inputs", async (t) => {
  const context = await outputContext(t);
  const target = webOutputTarget({
    downloads: [{
      id: "binary",
      mediaType: "application/octet-stream",
      name: "hello",
      path: "build/hello"
    }],
    id: "build",
    label: "Build binary",
    mode: "finite",
    presentation: null,
    runtimeRequirements: ["cpp"],
    steps: [{
      argv: ["cmake", "--build", "build"],
      label: "Build binary",
      role: "build"
    }]
  });
  const spec = await createVibe64OutputTargetTerminalSpec({
    context,
    outputTargetId: target.id
  }, {
    inspect: () => outputsInspection([target])
  });

  assert.equal(spec.ok, true);
  assert.equal(spec.stackHash, "sha256:unit");
  assert.equal(spec.reuseRunning, false);
  assert.deepEqual(spec.metadata.outputDownloads, target.downloads);
  assert.match(spec.args[1], /cmake --build build/u);
  assert.match(spec.args[1], /VIBE64_OUTPUT_RESULTS_READY_V1/u);
});

test("unsupported runtimes disable a target before terminal creation", async (t) => {
  const context = await outputContext(t);
  const target = webOutputTarget({ runtimeRequirements: ["future-runtime"] });

  assert.deepEqual(await listVibe64OutputTargets(context, {
    inspect: () => outputsInspection([target])
  }), [outputTargetView({
    available: false,
    disabledReason: "Vibe64 does not provide a pinned runtime for: future-runtime."
  })]);
  assert.deepEqual(await createVibe64OutputTargetTerminalSpec({
    context,
    outputTargetId: target.id
  }, {
    inspect: () => outputsInspection([target])
  }), {
    ok: false,
    message: "Vibe64 does not provide a pinned runtime for: future-runtime."
  });
});
