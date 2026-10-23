import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_PACKAGING_CONTRACT,
  parseVibe64PackagingLines,
  resolveVibe64PackagingEnvironment,
  vibe64PackagingInspection
} from "../../packages/vibe64-genesis/src/server/packaging.js";

const DESIGN_EXAMPLE = `
### Package \`web-mobile\`: Mobile web client

- Packer: \`web-bundle\`
- Runtimes: \`nodejs\`
- Prepare \`Install dependencies\`: \`npm\` \`install\`
- Build \`Build bundled client\`: \`npm\` \`run\` \`build\`
- Environment \`VITE_API_BASE_URL\`: \`https://notes.example.com\`
- Environment \`JSKIT_ASSET_MODE\`: \`bundled\`
- Output: \`dist\`

### Package \`app\`: Notes

- Packer: \`capacitor\`
- Content: package \`web-mobile\`
- Platforms: \`android\`
- Id: \`com.example.notes\`
- Name: \`Notes\`
- Icon: \`assets/icon-1024.png\`
- Version from: \`package.json\`
- Deep link scheme from: \`APP_URL_SCHEME\`
- App link domains from: \`APP_LINK_DOMAINS\`
- Permission \`camera\`: Take photos to attach to notes.

### Package \`sdk\`: Notes SDK

- Packer: \`npm\`
- Workdir: \`packages/notes-sdk\`
- Runtimes: \`nodejs\`
- Version from: \`package.json\`

### Package \`client\`: Python client

- Packer: \`python-dist\`
- Workdir: \`python\`
- Runtimes: \`python\`
- Build \`Build distributions\`: \`python\` \`-m\` \`build\`
- Output: \`python/dist\`
- Version from: \`pyproject.toml\`
`.split("\n");

const ENVIRONMENT_DEFAULTS = [
  { name: "APP_URL_SCHEME", value: "notes" },
  { name: "APP_LINK_DOMAINS", value: "notes.example.com, www.notes.example.com" }
];

function withPackage(entries, { heading = "### Package `pkg`: Package" } = {}) {
  return [heading, ...entries];
}

function rejects(sectionLines, pattern) {
  assert.throws(() => parseVibe64PackagingLines(sectionLines), (error) => (
    error.code === "VIBE64_PACKAGING_INVALID"
    && pattern.test(error.message)
    && error.message.endsWith("Exact grammar: vibe64-helper spec packaging.")
  ), pattern.source);
}

const webBundle = [
  "### Package `web`: Web",
  "- Packer: `web-bundle`",
  "- Build `Build`: `npm` `run` `build`",
  "- Output: `dist`"
];

function capacitor(extra = [], omit = []) {
  const base = [
    "- Packer: `capacitor`",
    "- Content: package `web`",
    "- Platforms: `android`",
    "- Id: `com.example.app`",
    "- Name: `App`",
    "- Icon: `icon.png`",
    "- Version from: `package.json`"
  ].filter((line) => !omit.some((prefix) => line.startsWith(prefix)));
  return [...webBundle, "### Package `app`: App", ...base, ...extra];
}

test("the design examples parse into the normalized v1 model", () => {
  const parsed = parseVibe64PackagingLines(DESIGN_EXAMPLE);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.packages.map(({ id, packer }) => [id, packer]), [
    ["web-mobile", "web-bundle"],
    ["app", "capacitor"],
    ["sdk", "npm"],
    ["client", "python-dist"]
  ]);
  const [web, app, sdk, client] = parsed.packages;
  assert.deepEqual(web.prepare, [{ label: "Install dependencies", argv: ["npm", "install"] }]);
  assert.deepEqual(web.build, [{ label: "Build bundled client", argv: ["npm", "run", "build"] }]);
  assert.deepEqual(web.environment, [
    { name: "VITE_API_BASE_URL", value: "https://notes.example.com" },
    { name: "JSKIT_ASSET_MODE", value: "bundled" }
  ]);
  assert.equal(web.output, "dist");
  assert.equal(web.versionFrom, null);
  assert.equal(app.content, "web-mobile");
  assert.deepEqual(app.platforms, ["android"]);
  assert.deepEqual(app.application, { id: "com.example.notes", name: "Notes", icon: "assets/icon-1024.png" });
  assert.equal(app.deepLinkSchemeFrom, "APP_URL_SCHEME");
  assert.equal(app.appLinkDomainsFrom, "APP_LINK_DOMAINS");
  assert.deepEqual(app.permissions, [{ id: "camera", reason: "Take photos to attach to notes." }]);
  assert.equal(sdk.workdir, "packages/notes-sdk");
  assert.deepEqual(sdk.runtimeRequirements, ["nodejs"]);
  assert.deepEqual(sdk.build, []);
  assert.equal(sdk.output, null);
  assert.equal(client.versionFrom, "pyproject.toml");
  assert.deepEqual(parseVibe64PackagingLines(["- Nothing."]), { version: 1, packages: [] });
});

test("every rejection rule refuses the section with an actionable message", () => {
  rejects([], /needs at least one Package/u);
  rejects(["- Packer: `npm`"], /belong under ### Package/u);
  rejects(["#### Package `x`: X"], /Unknown Packaging heading/u);
  rejects(withPackage(["- Packer: `cargo-crate`"]), /Unknown packer `cargo-crate`/u);
  rejects(withPackage(["- Packer: `npm`"]), /needs a Version from entry/u);
  rejects(withPackage(["- Packer: `npm`", "- Version from: `package.json`", "- Signing key: `x`"]), /Unknown Packaging entry/u);
  rejects(withPackage(["- Packer: `npm`", "- Version from: `package.json`", "- Packer: `npm`"]), /duplicate Packer/u);
  rejects(withPackage(["- Packer: `npm`", "- Version from: `pyproject.toml`"]), /reads its version from/u);
  rejects(withPackage(["- Packer: `npm`", "- Version from: `package.json`", "- Output: `dist`"]), /npm packer takes no Output/u);
  rejects(withPackage(["- Packer: `python-dist`", "- Version from: `pyproject.toml`", "- Output: `dist`"]), /needs a Build entry/u);
  rejects(withPackage(["- Packer: `web-bundle`", "- Build `B`: `npm` `run` `build`"]), /needs an Output entry/u);
  rejects(withPackage(["- Packer: `web-bundle`", "- Build `B`: `npm` `run` `build`", "- Output: `dist`", "- Version from: `package.json`"]), /takes no Version from/u);
  rejects(withPackage(["- Packer: `web-bundle`", "- Build `B`: `npm` `run` `build`", "- Output: `/abs`"]), /canonical project-relative path/u);
  rejects(withPackage(["- Packer: `web-bundle`", "- Build `B`: `/usr/bin/npm` `run`", "- Output: `dist`"]), /safe executable/u);
  rejects(withPackage(["- Packer: `web-bundle`", "- Build `B`: npm run build", "- Output: `dist`"]), /backticked/u);
  rejects(withPackage(["- Packer: `npm`", "- Version from: `package.json`"], { heading: "### Package `Bad_Id`: Bad" }), /Package id must use lowercase/u);
  rejects([...webBundle, ...webBundle], /duplicate package id web/u);

  // No placeholders in v1.
  rejects(withPackage(["- Packer: `web-bundle`", "- Build `B`: `npm` `run` `build:{target}`", "- Output: `dist`"]), /no placeholders/u);
  rejects(withPackage(["- Packer: `web-bundle`", "- Build `B`: `npm` `run` `build`", "- Output: `dist`", "- Environment `API`: `{name}`"]), /no placeholders/u);
  rejects(withPackage(["- Packer: `web-bundle`", "- Build `B`: `npm` `run` `build`", "- Output: `{name}`"]), /no placeholders/u);
  // Packaging is non-secret.
  rejects(withPackage(["- Packer: `web-bundle`", "- Build `B`: `npm` `run` `build`", "- Output: `dist`", "- Environment `NPM_TOKEN`: `x`"]), /looks like a credential/u);
  rejects(withPackage(["- Packer: `web-bundle`", "- Build `B`: `npm` `run` `build`", "- Output: `dist`", "- Environment `lower`: `x`"]), /uppercase environment variable/u);

  // Capacitor app packages.
  rejects(capacitor(["- Plugin: `@capacitor/camera`"]), /no Plugin list/u);
  rejects(capacitor(["- Plugins: `@capacitor/camera`"]), /no Plugin list/u);
  for (const [entry, label] of [["- Id: ", "Id"], ["- Name: ", "Name"], ["- Icon: ", "Icon"], ["- Content: ", "Content"], ["- Platforms: ", "Platforms"]]) {
    rejects(capacitor([], [entry]), new RegExp(`needs an? ${label} entry`, "u"));
  }
  rejects([...capacitor([], ["- Content: "]), "- Content: package `missing`"], /Content must name a web-bundle/u);
  rejects([
    "### Package `lib`: Lib", "- Packer: `npm`", "- Version from: `package.json`",
    ...capacitor([], ["- Content: "]).slice(4), "- Content: package `lib`"
  ], /Content must name a web-bundle/u);
  rejects([...capacitor([], ["- Platforms: "]), "- Platforms: `ios`"], /Platforms must be `android`/u);
  rejects([...capacitor([], ["- Id: "]), "- Id: `notes`"], /reverse-DNS id/u);
  rejects([...capacitor([], ["- Id: "]), "- Id: `com.1example.app`"], /reverse-DNS id/u);
  rejects([...capacitor([], ["- Icon: "]), "- Icon: `icon.jpg`"], /PNG/u);
  rejects(capacitor(["- Build `B`: `npm` `run` `build`"]), /capacitor packer takes no Build/u);
  rejects(capacitor(["- Environment `API`: `x`"]), /capacitor packer takes no Environment/u);
  rejects(capacitor(["- Deep link scheme from: `app-scheme`"]), /uppercase environment variable/u);
  rejects(capacitor(["- Permission `camera`: Photos.", "- Permission `camera`: Again."]), /duplicate Permission camera/u);
  rejects(capacitor(["- Permission `camera`: Use `code`."]), /plain user-facing text/u);
  rejects(withPackage(["- Packer: `npm`", "- Version from: `package.json`", "- Permission `camera`: Photos."]), /npm packer takes no Permission/u);
});

test("environment references resolve against Environment defaults", () => {
  const resolved = resolveVibe64PackagingEnvironment(parseVibe64PackagingLines(DESIGN_EXAMPLE), ENVIRONMENT_DEFAULTS);
  const app = resolved.packages.find(({ id }) => id === "app");
  assert.equal(app.deepLinkScheme, "notes");
  assert.deepEqual(app.appLinkDomains, ["notes.example.com", "www.notes.example.com"]);
  assert.equal(resolved.packages.find(({ id }) => id === "sdk").deepLinkScheme, undefined);

  const parsed = parseVibe64PackagingLines(DESIGN_EXAMPLE);
  const fails = (defaults, pattern) => assert.throws(
    () => resolveVibe64PackagingEnvironment(parsed, defaults),
    (error) => error.code === "VIBE64_PACKAGING_INVALID" && pattern.test(error.message)
  );
  fails([ENVIRONMENT_DEFAULTS[1]], /names APP_URL_SCHEME, which ## Environment defaults does not declare/u);
  fails([{ name: "APP_URL_SCHEME", value: "" }, ENVIRONMENT_DEFAULTS[1]], /does not declare with a value/u);
  fails([{ name: "APP_URL_SCHEME", value: "https" }, ENVIRONMENT_DEFAULTS[1]], /custom lowercase URL scheme/u);
  fails([ENVIRONMENT_DEFAULTS[0], { name: "APP_LINK_DOMAINS", value: "https://notes.example.com" }], /lowercase domain names/u);
});

test("the inspection hash is deterministic and follows only the normalized facts", () => {
  const environment = { stackHash: "sha256:stack", environmentDefaults: ENVIRONMENT_DEFAULTS };
  const inspect = (sectionLines) => vibe64PackagingInspection({
    environment,
    section: { status: "ready", stackHash: "sha256:stack", lines: sectionLines }
  });
  const first = inspect(DESIGN_EXAMPLE);
  assert.equal(first.contract, VIBE64_PACKAGING_CONTRACT);
  assert.equal(first.status, "ready");
  assert.match(first.packagingHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(inspect(DESIGN_EXAMPLE).packagingHash, first.packagingHash);
  assert.equal(inspect(["", ...DESIGN_EXAMPLE, "", ""]).packagingHash, first.packagingHash);
  const renamed = DESIGN_EXAMPLE.map((line) => line.replace("- Name: `Notes`", "- Name: `Notes Pro`"));
  assert.notEqual(inspect(renamed).packagingHash, first.packagingHash);
  const otherScheme = vibe64PackagingInspection({
    environment: { ...environment, environmentDefaults: [{ name: "APP_URL_SCHEME", value: "notespro" }, ENVIRONMENT_DEFAULTS[1]] },
    section: { status: "ready", stackHash: "sha256:stack", lines: DESIGN_EXAMPLE }
  });
  assert.notEqual(otherScheme.packagingHash, first.packagingHash);

  const absent = vibe64PackagingInspection({ environment, section: { status: "missing", stackHash: "sha256:stack" } });
  assert.equal(absent.status, "unconfigured");
  assert.equal(absent.packagingHash, "");
  assert.throws(() => vibe64PackagingInspection({
    environment: { stackHash: "sha256:other" },
    section: { status: "ready", stackHash: "sha256:stack", lines: DESIGN_EXAMPLE }
  }), (error) => error.code === "VIBE64_STACK_CHANGED");
});
