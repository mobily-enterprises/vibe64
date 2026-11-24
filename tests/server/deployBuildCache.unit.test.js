import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { parseVibe64DeploymentLines, vibe64DeploymentInspection } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { stackOperationHash } from "../../packages/vibe64-genesis/src/server/stackOperation.js";
import { preferredAlternative, resourceKindIsDatabase } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { servicePackages, servicePackagesProblem } from "../../packages/vibe64-deploy/src/adapters/mobilynet/declaration.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";
import { settingsPerService } from "../../packages/vibe64-deploy/src/package.js";

// A Deployment's `- Kept between builds:` names folders of the build's home that a host building the app afresh each
// time keeps for its next build. On mobilynet they are the declaration's build cache, beside the runtime's: its build
// VM starts with an empty home, so a Prepare that installs each pinned version of a tool once into a store in the home
// (as Mercbot's tools store does, 822 MiB and 81 s of each of Mercbot Online's builds on 24 Nov) downloaded everything
// again every build. Here the builds run as mobilynet's build VM runs them, and a local server counts the downloads.
const exec = promisify(execFile);

const READY = "- Ready when: `GET` `/health` returns `200`";
const TOOLS = Object.freeze({ "1.0.0": "the tool, 1.0.0\n", "1.1.0": "the tool, 1.1.0\n" });
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** The section of an app whose Prepare installs its pinned tool, keeping the store between builds or not. */
function shopLines({ kept }) {
  return [
    "- Runtimes: `nodejs`",
    ...(kept ? ["- Kept between builds: `~/.cache/shop-tools`"] : []),
    "- Prepare `Install the pinned tool`: `bash` `prepare.sh`",
    "- Serve `Start`: `node` `server.js`",
    READY
  ];
}

function inspect(lines) {
  return vibe64DeploymentInspection({
    environment: { stackHash: "sha256:stack", resources: [] },
    section: { status: "ready", stackHash: "sha256:stack", lines, components: [], source: "project" }
  });
}

/** The engine's package of the section for mobilynet: each service's declaration and the scripts. */
function packageOf(lines) {
  const deployment = inspect(lines);
  const { needs } = needsOfStack(deployment, { preferredAlternative, resourceKindIsDatabase });
  return servicePackages({ app: "shop", deployment, needs, settings: settingsPerService(needs) });
}

/**
 * The app's own files, its tool pinned at `version` by its SHA-256. Its Prepare installs the tool once per pinned
 * version into the store in the build's home, counting an install only once its marker is written last and checking
 * the file against the pin each time, and links it into the release.
 */
function shopSource(version) {
  return {
    "tool.pin": `${version} ${sha256(TOOLS[version])}\n`,
    "fetch.mjs": [
      "import { writeFileSync } from \"node:fs\";",
      "const response = await fetch(process.argv[2]);",
      "if (!response.ok) throw new Error(`${process.argv[2]} answered ${response.status}`);",
      "writeFileSync(process.argv[3], Buffer.from(await response.arrayBuffer()));",
      ""
    ].join("\n"),
    "prepare.sh": [
      "set -euo pipefail",
      "read -r version pinned < tool.pin",
      "dir=\"$HOME/.cache/shop-tools/$version\"",
      "if [ ! -f \"$dir/.done\" ]; then",
      "  rm -rf \"$dir\" && mkdir -p \"$dir\"",
      "  node fetch.mjs \"$TOOL_URL/tool-$version\" \"$dir/tool\"",
      "  touch \"$dir/.done\"",
      "fi",
      "echo \"$pinned  $dir/tool\" | sha256sum -c --quiet -",
      "mkdir -p .tools && ln -f \"$dir/tool\" .tools/tool",
      ""
    ].join("\n")
  };
}

/**
 * One build of an app as mobilynet's build VM runs it (its metal/hostd/build-vm/mobilynet-build-run and
 * metal/hostd/lib/builds.js, main 0b6a9c08): an empty home with the release at home/src; the project's kept cache for
 * the app, when there is one, unpacked into the home (cache-restore); the declaration's build command run in the
 * release; then those of the declaration's cache folders that exist archived from the home (cache-save), which the
 * host keeps for the app's next build in place of the last (a build that leaves none keeps the last). Answers the
 * tool the release holds.
 * @param {{ root: string, kept: string, declaration: any, files: Record<string, string>, env: Record<string, string> }} build
 */
async function buildInVm({ root, kept, declaration, files, env }) {
  const vm = await mkdtemp(path.join(root, "vm-"));
  try {
    const home = path.join(vm, "home");
    const src = path.join(home, "src");
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(src, file)), { recursive: true });
      await writeFile(path.join(src, file), text);
    }
    if (existsSync(kept)) {
      await exec("tar", ["--extract", "--no-same-permissions", "--delay-directory-restore", "-C", home, "-f", kept]);
    }
    await exec("bash", ["-c", declaration.build.command], {
      cwd: src,
      env: { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, HOME: home, USER: "build", LANG: "C.UTF-8", ...env }
    });
    const paths = declaration.build.cache
      .map((entry) => (entry.startsWith("~/") ? entry.slice(2) : `src/${entry}`))
      .filter((entry) => existsSync(path.join(home, entry)));
    if (paths.length > 0) {
      await exec("tar", ["--create", "--format=posix", "--numeric-owner", "--no-acls", "--no-selinux", "--no-xattrs", "--sort=name",
        "--pax-option=delete=atime,delete=ctime", "-C", home, "-f", path.join(vm, "cache.tar"), "--", ...paths]);
      await rename(path.join(vm, "cache.tar"), kept);
    }
    return await readFile(path.join(src, ".tools/tool"), "utf8");
  } finally {
    await rm(vm, { recursive: true, force: true });
  }
}

test("a build keeps the Deployment's Kept between builds, so a second Prepare with the same pins downloads nothing and a changed pin downloads again", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-build-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const downloads = [];
  const server = createServer((request, response) => {
    downloads.push(request.url);
    const tool = TOOLS[/^\/tool-(.+)$/u.exec(request.url)?.[1]];
    if (tool) response.end(tool);
    else response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const env = { TOOL_URL: `http://127.0.0.1:${server.address().port}` };
  /** The downloads since the last look. */
  const taken = () => downloads.splice(0);

  const { declarations, scripts } = packageOf(shopLines({ kept: true }));
  const build = (version) => buildInVm({
    root, kept: path.join(root, "kept-shop-web.tar"), declaration: declarations.web, files: { ...scripts, ...shopSource(version) }, env
  });
  assert.equal(await build("1.0.0"), TOOLS["1.0.0"]);
  assert.deepEqual(taken(), ["/tool-1.0.0"], "the first build downloads the tool");
  assert.equal(await build("1.0.0"), TOOLS["1.0.0"]);
  assert.deepEqual(taken(), [], "a second build with the same pins downloads nothing");
  assert.equal(await build("1.1.0"), TOOLS["1.1.0"]);
  assert.deepEqual(taken(), ["/tool-1.1.0"], "a changed pin downloads again");
  assert.equal(await build("1.1.0"), TOOLS["1.1.0"]);
  assert.deepEqual(taken(), [], "and then nothing");
  // The declaration keeps the runtime's folder, then the Deployment's own.
  assert.deepEqual(declarations.web.build.cache, ["~/.npm", "~/.cache/shop-tools"]);

  // Without the line a build keeps only the runtime's folder, so every build downloads the tool again, as each of
  // Mercbot Online's Deploys did.
  const plain = packageOf(shopLines({ kept: false }));
  assert.deepEqual(plain.declarations.web.build.cache, ["~/.npm"]);
  for (let round = 0; round < 2; round += 1) {
    const tool = await buildInVm({
      root, kept: path.join(root, "kept-plain-web.tar"), declaration: plain.declarations.web, files: { ...plain.scripts, ...shopSource("1.0.0") }, env
    });
    assert.equal(tool, TOOLS["1.0.0"]);
    assert.deepEqual(taken(), ["/tool-1.0.0"], `build ${round + 1} without the line downloads`);
  }
});

test("Kept between builds names folders of the build's home, each once, joins the recipe's identity only when said, and refuses anything else at its line", () => {
  const lines = (entry) => ["- Runtimes: `nodejs`", entry, "- Serve `Start`: `node` `server.js`", READY];
  assert.deepEqual(parseVibe64DeploymentLines(lines("- Kept between builds: `~/.cache/pip` `~/.npm` `~/go/pkg/mod`")).buildCache,
    ["~/.cache/pip", "~/.npm", "~/go/pkg/mod"]);
  // A Deployment without the line keeps its recipe's identity, v1's fields hashed as before; with it, the recipe is
  // another.
  const without = inspect(shopLines({ kept: false }));
  assert.deepEqual(without.buildCache, []);
  const v1Fields = ["version", "artifact", "workdir", "runtimeRequirements", "generatedSecrets", "setupCode", "sandboxAllowances",
    "packages", "instances", "readiness", "steps"];
  assert.equal(without.recipeHash, stackOperationHash(Object.fromEntries(v1Fields.map((field) => [field, without[field]]))));
  const kept = inspect(shopLines({ kept: true }));
  assert.deepEqual(kept.buildCache, ["~/.cache/shop-tools"]);
  assert.equal(kept.recipeHash, stackOperationHash({ ...Object.fromEntries(v1Fields.map((field) => [field, kept[field]])), buildCache: kept.buildCache }));
  assert.notEqual(kept.recipeHash, without.recipeHash);

  const refused = (entry, pattern) => assert.throws(() => parseVibe64DeploymentLines(lines(entry)), (error) => {
    assert.equal(error?.code, "VIBE64_DEPLOYMENT_INVALID", error?.message);
    assert.equal(error.details?.line, 2, error.message);
    assert.match(error.message, pattern);
    return true;
  }, entry);
  for (const outside of ["`.cache/pip`", "`/root/.cache`", "`~`", "`~/`", "`~/../x`", "`~/a/./b`", "`~/a//b`", "`~/a b`", "`~/$HOME`",
    `\`~/${Array.from({ length: 17 }, () => "a").join("/")}\``]) {
    refused(`- Kept between builds: ${outside}`, /Kept between builds names folders of the build's home as `~\/` then plain names/u);
  }
  refused("- Kept between builds: `~/.npm` `~/.npm`", /names a folder twice/u);
  refused(`- Kept between builds: ${Array.from({ length: 11 }, (_, at) => `\`~/cache${at}\``).join(" ")}`, /at most 10 folders/u);
  refused("- Kept between builds: ``", /backticked values/u);
  refused("- Kept between builds: ~/.cache/pip", /backticked values/u);
  assert.throws(() => parseVibe64DeploymentLines(["- Kept between builds: `~/a`", "- Kept between builds: `~/b`", "- Serve `Start`: `node` `s.js`", READY]),
    /Duplicate Deployment Kept between builds/u);
  // It is the whole Deployment's, as the build is: never a service's.
  assert.throws(() => parseVibe64DeploymentLines([
    "- Runtimes: `nodejs`", "", "### Service `web`: pages", "", "- Exposure: `public`", "- Kept between builds: `~/.cache/pip`",
    "- Serve `Start`: `node` `server.js`", READY, "- Instances: `1` to `2`"
  ]), /Kept between builds is the whole Deployment's: put it above the first ### heading/u);
});

test("a Deployment keeping more folders than a mobilynet build keeps with its runtime's is refused before anything is made, naming the fix", () => {
  const ten = Array.from({ length: 10 }, (_, at) => `\`~/cache${at}\``).join(" ");
  const node = inspect(["- Runtimes: `nodejs`", `- Kept between builds: ${ten}`, "- Serve `Start`: `node` `server.js`", READY]);
  assert.deepEqual(servicePackagesProblem(node, {}), {
    code: "vibe64_app_package_build_cache_invalid",
    message: "A mobilynet build keeps at most 10 folders between builds, its runtimes' among them (~/.npm), and the Deployment would keep 11. "
      + "Name fewer in genesis/stack.md's - Kept between builds: (the coding agent can do this), Save, then deploy to production."
  });
  // The runtime's own folder named again is kept once.
  const nine = Array.from({ length: 9 }, (_, at) => `\`~/cache${at}\``).join(" ");
  const again = inspect(["- Runtimes: `nodejs`", `- Kept between builds: \`~/.npm\` ${nine}`, "- Serve `Start`: `node` `server.js`", READY]);
  assert.equal(servicePackagesProblem(again, {}), null);
  const { needs } = needsOfStack(again, { preferredAlternative, resourceKindIsDatabase });
  assert.deepEqual(servicePackages({ app: "shop", deployment: again, needs, settings: settingsPerService(needs) }).declarations.web.build.cache,
    ["~/.npm", ...Array.from({ length: 9 }, (_, at) => `~/cache${at}`)]);
  // A python app has no runtime folder: its ten are kept.
  const python = inspect(["- Runtimes: `python`", `- Kept between builds: ${ten}`, "- Serve `Start`: `python` `-m` `shop`", READY]);
  assert.equal(servicePackagesProblem(python, {}), null);
});
