import assert from "node:assert/strict";
import test from "node:test";

import {
  parseVibe64DeploymentLines,
  parseVibe64OutputsLines,
  parseVibe64WorkspaceSetupLines
} from "../../packages/vibe64-genesis/src/server/index.js";

const READY = "- Ready when: `GET` `/api/health` returns `200`";

function webOutputTarget({
  defaultTarget = true,
  id = "app",
  label = "Run app",
  protocol = "vibe64.preview-identity.command.v1",
  previewIdentity = true
} = {}) {
  return [
    `### Target \`${id}\`: ${label}`,
    "",
    ...(defaultTarget ? ["- Default."] : []),
    "- Mode: `interactive`",
    "- Workdir: `.`",
    "- Runtimes: `nodejs`",
    "- Prepare `Generate assets`: `npm` `run` `prepare`",
    "- Run `Develop`: `npm` `run` `develop` `--` `--host={host}` `--port={port}`",
    "",
    "#### Presentation",
    "",
    "- Kind: `web`",
    "- Preferred port: `3000`",
    "- URL path: `/`",
    READY,
    ...(previewIdentity
      ? [
          "",
          "#### Preview identity",
          "",
          "- Command: `tools/preview-identity`",
          `- Protocol: \`${protocol}\``,
          "- Identity types: `email` `user-id`",
          "- Enabled environment: `AUTH_DEV_BYPASS_ENABLED`",
          "- Secret environment: `AUTH_DEV_BYPASS_SECRET`",
          "- Runtimes: `nodejs`",
          "- Timeout ms: `10000`"
        ]
      : [])
  ];
}

function deploymentLines(overrides = {}) {
  return [
    ...(overrides.workdir === undefined ? ["- Workdir: `.`"] : [`- Workdir: \`${overrides.workdir}\``]),
    "- Runtimes: `nodejs`",
    ...(overrides.recreate === false ? [] : ["- Recreate on restore: `node_modules` `packages/*/node_modules`"]),
    ...(overrides.ready === false ? [] : [READY]),
    ...(overrides.steps || [
      "- Prepare `Install`: `npm` `ci`",
      "- Build `Build`: `npm` `run` `build`",
      "- Migrate `Migrate`: `npm` `run` `db:prepare`",
      "- Serve `Start`: `npm` `start`"
    ])
  ];
}

test("Workspace setup Markdown normalizes exact argv, paths, and conditions", () => {
  assert.deepEqual(parseVibe64WorkspaceSetupLines([
    "- Prepare `Install backend` with `php` `composer` in `backend` when `backend/composer.json` exists: `composer` `install` `--no-interaction`",
    "- Prepare `Install frontend` with `nodejs` in `frontend` if `frontend/package.json` exists: `npm` `install`"
  ]), [{
    label: "Install backend",
    argv: ["composer", "install", "--no-interaction"],
    runtimeRequirements: ["php", "composer"],
    workdir: "backend",
    condition: {
      pathExists: "backend/composer.json",
      onMissing: "wait"
    }
  }, {
    label: "Install frontend",
    argv: ["npm", "install"],
    runtimeRequirements: ["nodejs"],
    workdir: "frontend",
    condition: {
      pathExists: "frontend/package.json",
      onMissing: "skip"
    }
  }]);
  assert.deepEqual(parseVibe64WorkspaceSetupLines(["- Nothing."]), []);
});

test("Workspace setup rejects shell strings, traversal, and malformed runtimes", () => {
  const invalid = [
    "- Prepare `Install` with `nodejs`: `npm install`",
    "- Prepare `Install` with `nodejs`: npm install",
    "- Prepare `Install` with `nodejs` in `../outside`: `npm` `install`",
    "- Prepare `Install` with `Node.js`: `npm` `install`",
    "- Prepare `Install` with `nodejs`: `/usr/bin/npm` `install`",
    "- Prepare `Install` with `nodejs` when `../package.json` exists: `npm` `install`"
  ];
  for (const entry of invalid) {
    assert.throws(
      () => parseVibe64WorkspaceSetupLines([entry]),
      (error) => error?.code === "VIBE64_WORKSPACE_SETUP_INVALID"
    );
  }
});

test("Outputs Markdown normalizes web targets and preview identity without a shell", () => {
  const parsed = parseVibe64OutputsLines([
    ...webOutputTarget(),
    "",
    ...webOutputTarget({
      defaultTarget: false,
      id: "admin",
      label: "Run admin",
      previewIdentity: false
    })
  ]);

  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.targets.map(({ id, default: isDefault }) => ({ id, isDefault })), [
    { id: "app", isDefault: true },
    { id: "admin", isDefault: false }
  ]);
  assert.deepEqual(parsed.targets[0].steps.map(({ role }) => role), ["prepare", "run"]);
  assert.deepEqual(parsed.targets[0].presentation, {
    kind: "web",
    preferredPort: 3000,
    urlPath: "/",
    readiness: {
      kind: "http",
      method: "GET",
      path: "/api/health",
      status: 200
    }
  });
  assert.deepEqual(parsed.targets[0].previewIdentity, {
    command: ["tools/preview-identity"],
    environment: {
      enabled: "AUTH_DEV_BYPASS_ENABLED",
      secret: "AUTH_DEV_BYPASS_SECRET"
    },
    identityTypes: ["email", "user-id"],
    protocol: "vibe64.preview-identity.command.v1",
    runtimes: ["nodejs"],
    timeoutMs: 10_000
  });
  assert.deepEqual(parseVibe64OutputsLines(["- Nothing."]), { version: 1, targets: [] });
});

test("Outputs normalizes terminal and finite targets with declared downloads", () => {
  const parsed = parseVibe64OutputsLines([
    "### Target `calculator`: Run calculator",
    "",
    "- Default.",
    "- Mode: `interactive`",
    "- Workdir: `.`",
    "- Runtimes: `cpp`",
    "- Prepare `Configure`: `cmake` `-S` `.` `-B` `build` `-G` `Ninja`",
    "- Build `Compile`: `cmake` `--build` `build`",
    "- Run `Calculator`: `./build/calculator`",
    "",
    "#### Presentation",
    "",
    "- Kind: `terminal`",
    "",
    "#### Download `linux-binary`",
    "",
    "- Path: `build/calculator`",
    "- Name: `calculator-linux-x86_64`",
    "- Media type: `application/octet-stream`",
    "",
    "### Target `archive`: Build archive",
    "",
    "- Mode: `finite`",
    "- Runtimes: `shell`",
    "- Build `Archive`: `tools/build-archive`",
    "",
    "#### Download `archive`",
    "",
    "- Path: `dist/app.tar.gz`",
    "- Name: `app.tar.gz`",
    "- Media type: `application/gzip`"
  ]);

  assert.deepEqual(parsed.targets[0].presentation, { kind: "terminal" });
  assert.deepEqual(parsed.targets[0].downloads, [{
    id: "linux-binary",
    path: "build/calculator",
    name: "calculator-linux-x86_64",
    mediaType: "application/octet-stream"
  }]);
  assert.equal(parsed.targets[1].mode, "finite");
  assert.equal(parsed.targets[1].presentation, null);
  assert.deepEqual(parsed.targets[1].steps.map(({ role }) => role), ["build"]);
});

test("Outputs rejects ambiguous targets and unsafe process declarations", () => {
  const invalid = [
    [...webOutputTarget(), "", ...webOutputTarget()],
    [...webOutputTarget(), "", ...webOutputTarget({ id: "admin" })],
    webOutputTarget().map((line) => line === "- Workdir: `.`" ? "- Workdir: `../outside`" : line),
    webOutputTarget().map((line) => line === "- Preferred port: `3000`" ? "- Preferred port: `80`" : line),
    webOutputTarget().map((line) => line === "- URL path: `/`" ? "- URL path: `https://example.invalid`" : line),
    webOutputTarget().filter((line) => line !== READY),
    webOutputTarget().map((line) => line.includes("--host={host}") ? "- Run `Develop`: `npm` `run` `develop` `{unknown}`" : line),
    webOutputTarget().map((line) => line === "- Runtimes: `nodejs`" ? "- Runtimes: `Node.js`" : line),
    webOutputTarget().filter((line) => line !== "- Mode: `interactive`"),
    webOutputTarget().map((line) => line === "- Kind: `web`" ? "- Kind: `desktop`" : line)
  ];
  for (const lines of invalid) {
    assert.throws(
      () => parseVibe64OutputsLines(lines),
      (error) => error?.code === "VIBE64_OUTPUTS_INVALID"
    );
  }
});

test("Outputs accepts preview identity only for web targets with the current protocol", () => {
  for (const protocol of [
    "genesis.preview-identity.command.v1",
    "vibe64.preview-identity.command.v0",
    "another.protocol"
  ]) {
    assert.throws(
      () => parseVibe64OutputsLines(webOutputTarget({ protocol })),
      (error) => error?.code === "VIBE64_OUTPUTS_INVALID"
    );
  }
});

test("Deployment Markdown normalizes the exact ordered publication recipe", () => {
  assert.deepEqual(parseVibe64DeploymentLines(deploymentLines()), {
    version: 1,
    artifact: {
      disposablePaths: ["node_modules", "packages/*/node_modules"]
    },
    workdir: ".",
    runtimeRequirements: ["nodejs"],
    readiness: {
      kind: "http",
      method: "GET",
      path: "/api/health",
      status: 200
    },
    steps: [
      { label: "Install", argv: ["npm", "ci"], role: "prepare" },
      { label: "Build", argv: ["npm", "run", "build"], role: "build" },
      { label: "Migrate", argv: ["npm", "run", "db:prepare"], role: "migrate" },
      { label: "Start", argv: ["npm", "start"], role: "serve" }
    ]
  });
  assert.deepEqual(parseVibe64DeploymentLines(["- Nothing."]), {
    version: 1,
    artifact: { disposablePaths: [] },
    workdir: ".",
    runtimeRequirements: [],
    readiness: null,
    steps: []
  });
});

test("Deployment rejects unsafe paths, shell strings, placeholders, missing proof, and phase reordering", () => {
  const invalid = [
    deploymentLines({ workdir: "../escape" }),
    deploymentLines({ ready: false }),
    [
      "- Recreate on restore: `../node_modules`",
      READY,
      "- Prepare `Install`: `npm` `ci`",
      "- Serve `Start`: `npm` `start`"
    ],
    deploymentLines({ steps: [
      "- Build `Build`: `npm` `run` `build`",
      "- Prepare `Late install`: `npm` `ci`",
      "- Serve `Start`: `npm` `start`"
    ] }),
    deploymentLines({ steps: [
      "- Serve `Start`: `npm` `start`",
      "- Build `Late build`: `npm` `run` `build`"
    ] }),
    deploymentLines({ steps: ["- Serve `Start`: `npm start`"] }),
    deploymentLines({ steps: ["- Serve `Start`: `php` `artisan` `serve` `--port={port}`"] })
  ];
  for (const lines of invalid) {
    assert.throws(
      () => parseVibe64DeploymentLines(lines),
      (error) => error?.code === "VIBE64_DEPLOYMENT_INVALID"
    );
  }
});

test("all Vibe64 operation parsers reject the retired JSON representation", () => {
  const json = ["```json vibe64.retired.v1", "{\"version\":1}", "```"];
  for (const [parse, code] of [
    [parseVibe64WorkspaceSetupLines, "VIBE64_WORKSPACE_SETUP_INVALID"],
    [parseVibe64OutputsLines, "VIBE64_OUTPUTS_INVALID"],
    [parseVibe64DeploymentLines, "VIBE64_DEPLOYMENT_INVALID"]
  ]) {
    assert.throws(() => parse(json), (error) => error?.code === code);
  }
});
