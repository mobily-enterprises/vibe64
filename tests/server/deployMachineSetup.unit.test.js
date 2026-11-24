import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { servicePackages, serviceUpload } from "../../packages/vibe64-deploy/src/adapters/mobilynet/declaration.js";
import { CONTAINERFILE, imagePackages } from "../../packages/vibe64-deploy/src/image.js";
import { MACHINE_SETUP_FILE, packArchive, settingsPerService, withRootFile } from "../../packages/vibe64-deploy/src/package.js";
import { parseVibe64DeploymentLines, vibe64DeploymentInspection } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { stackOperationHash } from "../../packages/vibe64-genesis/src/server/stackOperation.js";
import { workersStack } from "../fixtures/deployWorkersApp.js";
import { awsWorld } from "./deployAwsHelpers.js";
import { googleWorld } from "./deployGoogleHelpers.js";
import { SHOP, refusal, refused, world } from "./vibe64DeployStandInHelpers.js";

// A Deployment's `- Machine setup:` names a committed script a host that builds the app's machine runs on it once, as
// root, keeping what it installs read-only for every machine built with the same script (mobilynet's setup layer, its
// docs/colleague-usage/setup-scripts.md). Mercbot Online's Production build output was 2,452 MiB on 25 Nov, 1,647 MiB
// of it pinned tool downloads fetched, stored and copied at every Deploy though they change only with a pin. Here: the
// grammar, the archive carrying the script at its root byte for byte, each mobilynet declaration's build.setup and the
// stand-in taking (or refusing) it as mobilynet does, and the AWS and Google images running it as root before the release.
const exec = promisify(execFile);

const READY = "- Ready when: `GET` `/health` returns `200`";
const LINE = "- Machine setup: `deploy/machine-setup.sh`";
const SCRIPT = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "# The shop's pinned tool, by its URL and SHA-256.",
  "curl -fsSL https://downloads.example.com/tool-1.0.0.tar.xz -o /tmp/tool.tar.xz",
  "echo '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  /tmp/tool.tar.xz' | sha256sum -c -",
  "mkdir -p /opt/shop-tools && tar -xJf /tmp/tool.tar.xz -C /opt/shop-tools",
  ""
].join("\n");

function inspect(lines, resources = []) {
  return vibe64DeploymentInspection({
    environment: { stackHash: "sha256:stack", resources },
    section: { status: "ready", stackHash: "sha256:stack", lines, components: [], source: "project" }
  });
}

/**
 * The two-service app of the container tests, its shared entries (above its first `### Service`, beside its shared
 * Packages; the workers service has Packages of its own) naming the machine setup script, or not.
 */
function stackOf({ setup = true, file = "deploy/machine-setup.sh" } = {}) {
  return workersStack((lines) => {
    if (!setup) return lines;
    const shared = lines.indexOf("- Packages: `git` `ripgrep`");
    assert.ok(shared >= 0 && shared < lines.findIndex((line) => line.startsWith("### ")), "the fixture's shared Packages");
    return lines.toSpliced(shared + 1, 0, `- Machine setup: \`${file}\``);
  });
}

/** A repository with one commit of these files (text, bytes, or `{ link }` for a symbolic link), and git run in it. */
async function repository(root, files) {
  const git = async (args) => (await exec("git", args, { cwd: root, env: { PATH: process.env.PATH, HOME: root } })).stdout;
  await mkdir(root, { recursive: true });
  await git(["init", "-q", "-b", "main"]);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    // A string has a .link of its own (String.prototype.link), so only a plain object names a link.
    if (typeof content === "object" && !Buffer.isBuffer(content)) await symlink(content.link, path.join(root, file));
    else await writeFile(path.join(root, file), content);
  }
  await git(["add", "-A"]);
  await git(["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "app"]);
  return { git, commit: (await git(["rev-parse", "HEAD"])).trim() };
}

/** Each entry of a gzip tarball by its name (ustar names, and a pax header's path), its bytes. @param {Buffer} archive */
function entriesOf(archive) {
  const tar = gunzipSync(archive);
  const entries = {};
  let paxPath = null;
  for (let at = 0; at + 512 <= tar.length && tar.subarray(at, at + 512).some((byte) => byte !== 0);) {
    const field = (offset, length) => tar.subarray(at + offset, at + offset + length).toString("utf8").replace(/\0.*$/su, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    const ustarName = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const data = Buffer.from(tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/u.exec(data.toString("utf8"))?.[1] ?? null;
    if (type === "x" || type === "g") continue;
    const name = paxPath ?? ustarName;
    paxPath = null;
    entries[name] = entries[name] ? [...[entries[name]].flat(), data] : data;
  }
  return entries;
}

/** A gzip tarball of these files at its root, each a ustar entry of its bytes. @param {Record<string, string | Buffer>} files */
function tarballOf(files) {
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100, "ascii");
    header.write("0000000\0", 108, "ascii");
    header.write("0000000\0", 116, "ascii");
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, "ascii");
    header.write("00000000000\0", 136, "ascii");
    header.write("        ", 148, "ascii");
    header.write("0", 156, "ascii");
    header.write("ustar\0" + "00", 257, "ascii");
    header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

test("Machine setup names one committed file by its path from the project's root, joins the recipe's identity only when said, and is refused anywhere else at its line", () => {
  const lines = (entry) => ["- Runtimes: `nodejs`", entry, "- Serve `Start`: `node` `server.js`", READY];
  assert.equal(parseVibe64DeploymentLines(lines(LINE)).machineSetup, "deploy/machine-setup.sh");
  assert.equal(parseVibe64DeploymentLines(lines("- Machine setup: `.vibe64/setup@1+x.sh`")).machineSetup, ".vibe64/setup@1+x.sh");
  // A Deployment without the line keeps its recipe's identity, v1's fields hashed as before; with it, the recipe is
  // another, and another script is another again.
  const without = inspect(lines("- Packages: `git`"));
  assert.equal(without.machineSetup, "");
  const v1Fields = ["version", "artifact", "workdir", "runtimeRequirements", "generatedSecrets", "setupCode", "sandboxAllowances",
    "packages", "instances", "readiness", "steps"];
  assert.equal(without.recipeHash, stackOperationHash(Object.fromEntries(v1Fields.map((field) => [field, without[field]]))));
  const withSetup = inspect(["- Packages: `git`", ...lines(LINE)]);
  assert.equal(withSetup.machineSetup, "deploy/machine-setup.sh");
  assert.equal(withSetup.recipeHash, stackOperationHash({ ...Object.fromEntries(v1Fields.map((field) => [field, withSetup[field]])), machineSetup: "deploy/machine-setup.sh" }));
  assert.notEqual(withSetup.recipeHash, without.recipeHash);
  assert.notEqual(inspect(lines("- Machine setup: `deploy/other.sh`")).recipeHash, inspect(lines(LINE)).recipeHash);

  const refused = (entry, pattern) => assert.throws(() => parseVibe64DeploymentLines(lines(entry)), (error) => {
    assert.equal(error?.code, "VIBE64_DEPLOYMENT_INVALID", error?.message);
    assert.equal(error.details?.line, 2, error.message);
    assert.match(error.message, pattern);
    return true;
  }, entry);
  for (const outside of ["/opt/setup.sh", "../setup.sh", "deploy/../setup.sh", "./setup.sh", "deploy/./setup.sh", "deploy//setup.sh",
    "deploy/", ".", "-setup.sh", "deploy/-x.sh", "set up.sh", "$HOME/setup.sh", "deploy\\setup.sh", "a*.sh",
    Array.from({ length: 17 }, () => "a").join("/"), `deploy/${"a".repeat(256)}.sh`]) {
    refused(`- Machine setup: \`${outside}\``, /Deployment Machine setup names one committed file of the project by its path from the project's root/u);
  }
  refused("- Machine setup: ``", /Deployment Machine setup must contain exactly 1 backticked value/u);
  refused("- Machine setup: `a.sh` `b.sh`", /Deployment Machine setup must contain exactly 1 backticked value/u);
  refused("- Machine setup: deploy/machine-setup.sh", /Deployment Machine setup must contain exactly 1 backticked value/u);
  assert.throws(() => parseVibe64DeploymentLines([LINE, "- Machine setup: `deploy/other.sh`", "- Serve `Start`: `node` `s.js`", READY]),
    /Duplicate Deployment Machine setup/u);
  // It is the whole Deployment's, as the build is: never a service's.
  assert.throws(() => parseVibe64DeploymentLines([
    "- Runtimes: `nodejs`", "", "### Service `web`: pages", "", "- Exposure: `public`", LINE,
    "- Serve `Start`: `node` `server.js`", READY, "- Instances: `1` to `2`"
  ]), /Machine setup is the whole Deployment's: put it above the first ### heading/u);
  // Above the services, every service has it.
  const { deployment } = stackOf();
  assert.equal(deployment.machineSetup, "deploy/machine-setup.sh");
  assert.deepEqual(deployment.services.map((service) => service.id), ["web", "workers"]);
});

test("the archive carries the machine setup script at its root byte for byte, each service's mobilynet declaration names it as build.setup, and the stand-in takes it as mobilynet does", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-machine-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const longName = `deploy/${"pinned-tools-".repeat(10)}setup.sh`;
  const exact = `#!/bin/bash\n${"#".repeat(64 * 1024 - 13)}\n`;
  const { git, commit } = await repository(path.join(root, "app"), {
    "package.json": "{}\n",
    "server.js": "// app\n",
    "deploy/machine-setup.sh": SCRIPT,
    [longName]: SCRIPT.replace("1.0.0", "1.0.1"),
    "deploy/exact.sh": exact
  });
  assert.equal(Buffer.byteLength(exact), 64 * 1024);
  let packs = 0;
  const pack = async (machineSetup, scripts, source = { git, commit }) => {
    const scratch = path.join(root, `scratch-${packs += 1}`);
    await mkdir(scratch);
    return packArchive({ ...source, scratch, scripts, machineSetup });
  };

  const { deployment, needs } = stackOf();
  const { declarations, scripts } = servicePackages({ app: "shop", deployment, needs, settings: settingsPerService(needs) });
  // Every service builds with it: mobilynet keeps a layer per service's packages, built once and reused.
  assert.deepEqual(Object.values(declarations).map((declaration) => declaration.build.setup), [MACHINE_SETUP_FILE, MACHINE_SETUP_FILE]);
  assert.equal(MACHINE_SETUP_FILE, "vibe64-machine-setup.sh");
  const plain = stackOf({ setup: false });
  assert.deepEqual(Object.values(servicePackages({ app: "shop", deployment: plain.deployment, needs: plain.needs, settings: settingsPerService(plain.needs) })
    .declarations).map((declaration) => Object.hasOwn(declaration.build, "setup")), [false, false]);

  const archive = await pack(deployment.machineSetup, scripts);
  const entries = entriesOf(archive.bytes);
  assert.equal(entries[MACHINE_SETUP_FILE].toString("utf8"), SCRIPT, "the script again at the archive's root");
  assert.equal(entries["deploy/machine-setup.sh"].toString("utf8"), SCRIPT, "and at its own path, as committed");
  assert.equal((await pack(deployment.machineSetup, scripts)).sha256, archive.sha256, "the same commit packs to the same bytes");
  assert.equal(entries[longName].toString("utf8"), SCRIPT.replace("1.0.0", "1.0.1"));
  // A path past 100 characters (git names it in a pax header) and a script of exactly 64 KiB are taken.
  assert.ok(longName.length > 100);
  assert.equal(entriesOf((await pack(longName, scripts)).bytes)[MACHINE_SETUP_FILE].toString("utf8"), SCRIPT.replace("1.0.0", "1.0.1"));
  assert.equal(entriesOf((await pack("deploy/exact.sh", scripts)).bytes)[MACHINE_SETUP_FILE].toString("utf8"), exact);
  // Without the line nothing is added.
  assert.equal(Object.hasOwn(entriesOf((await pack("", scripts)).bytes), MACHINE_SETUP_FILE), false);

  // mobilynet's stand-in takes each service's upload, its build.setup naming the script at the root.
  const { production } = world();
  for (const [service, declaration] of Object.entries(declarations)) {
    const upload = serviceUpload(archive.bytes, declaration);
    const { release } = await production.createRelease(declaration.name, { archive: upload.bytes, sha256: upload.sha256 });
    assert.match(release.version, /^\d{8}-[0-9a-f]{7}$/u, service);
  }
  // A declaration naming it in an archive packed without it is refused as mobilynet refuses it, never built without.
  const without = serviceUpload((await pack("", scripts)).bytes, declarations.web);
  const missing = await refused(production.createRelease("shop-web", { archive: without.bytes, sha256: without.sha256 }));
  assert.deepEqual(refusal(missing), { status: 422, code: "validation_failed", fields: ["declaration.build.setup"] });
  assert.equal(missing.details.fieldErrors["declaration.build.setup"],
    "The declaration's build.setup names vibe64-machine-setup.sh, which isn't a regular file in the app's folder.");
});

test("a machine setup script no host could run is refused in words before anything is sent, naming the script and the fix", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-machine-setup-refused-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { git, commit } = await repository(path.join(root, "app"), {
    "package.json": "{}\n",
    "deploy/machine-setup.sh": SCRIPT,
    "deploy/link.sh": { link: "machine-setup.sh" },
    "deploy/empty.sh": "",
    "deploy/big.sh": `#!/bin/bash\n${"#".repeat(64 * 1024)}\n`,
    "deploy/nul.sh": "echo a\u0000b\n",
    "deploy/latin1.sh": Buffer.from([0x65, 0x63, 0x68, 0x6f, 0x20, 0xe9, 0x0a])
  });
  const taken = await repository(path.join(root, "taken"), { "deploy/machine-setup.sh": SCRIPT, [MACHINE_SETUP_FILE]: "echo mine\n" });
  let packs = 0;
  const refusedPack = async (machineSetup, source = { git, commit }) => {
    const scratch = path.join(root, `scratch-${packs += 1}`);
    await mkdir(scratch);
    return packArchive({ ...source, scratch, scripts: { "vibe64-app/build.sh": "b\n" }, machineSetup })
      .then(() => assert.fail(`${machineSetup} was packed`), (error) => error);
  };
  const named = (file) => `genesis/stack.md's Deployment names the machine setup script ${file}`;
  const cases = [
    ["deploy/other.sh", "vibe64_production_machine_setup_invalid",
      `${named("deploy/other.sh")}, which the saved work doesn't have. Commit the script there (the coding agent can do this), Save, then deploy to production.`],
    ["deploy/link.sh", "vibe64_production_machine_setup_invalid",
      `${named("deploy/link.sh")}, which is a link in the saved work, not a file. Name the script itself (the coding agent can do this), Save, then deploy to production.`],
    ["deploy", "vibe64_production_machine_setup_invalid",
      `${named("deploy")}, which is a folder in the saved work, not a file. Name the script itself (the coding agent can do this), Save, then deploy to production.`],
    ["deploy/empty.sh", "vibe64_production_machine_setup_invalid",
      "The machine setup script deploy/empty.sh holds 0 bytes, and a host takes 1 byte to 64 KiB. Write the script (the coding agent can do this), Save, then deploy to production."],
    ["deploy/big.sh", "vibe64_production_machine_setup_invalid",
      "The machine setup script deploy/big.sh holds 65,549 bytes, and a host takes 1 byte to 64 KiB. Make it shorter, fetching what it installs "
        + "instead of holding it (the coding agent can do this), Save, then deploy to production."],
    ["deploy/nul.sh", "vibe64_production_machine_setup_invalid",
      "The machine setup script deploy/nul.sh holds a NUL character, which no script holds. Remove it (the coding agent can do this), Save, then deploy to production."],
    ["deploy/latin1.sh", "vibe64_production_machine_setup_invalid",
      "The machine setup script deploy/latin1.sh isn't UTF-8 text, and a host runs it as a script. Write it as UTF-8 text (the coding agent can do this), Save, then deploy to production."]
  ];
  for (const [file, code, message] of cases) {
    const error = await refusedPack(file);
    assert.deepEqual({ code: error.code, message: error.message, status: error.status }, { code, message, status: 422 }, file);
  }
  const clash = await refusedPack("deploy/machine-setup.sh", taken);
  assert.deepEqual({ code: clash.code, message: clash.message }, {
    code: "vibe64_production_machine_setup_taken",
    message: `The saved work has its own ${MACHINE_SETUP_FILE}, where Vibe64 puts the Deployment's machine setup script (deploy/machine-setup.sh) `
      + "in the package it makes. Rename it, Save, then deploy to production."
  });
  // A Deployment naming that very file packs it once, from the commit.
  const scratch = path.join(root, "own");
  await mkdir(scratch);
  const own = await packArchive({ ...taken, scratch, scripts: {}, machineSetup: MACHINE_SETUP_FILE });
  const ownEntry = entriesOf(own.bytes)[MACHINE_SETUP_FILE];
  assert.ok(Buffer.isBuffer(ownEntry), "one entry, not two");
  assert.equal(ownEntry.toString("utf8"), "echo mine\n");
});

test("mobilynet's stand-in checks a release's build.setup as mobilynet does: a plain file name, a regular root file of 1 byte to 64 KiB of UTF-8 text without NUL", async () => {
  const { production } = world();
  const shop = (setup) => ({ ...SHOP, build: { ...SHOP.build, setup } });
  let release = 0;
  const upload = (declaration, files = {}) => {
    release += 1;
    const archive = tarballOf({ "mobilynet.json": JSON.stringify(declaration), "release.txt": String(release), ...files });
    return { archive, sha256: createHash("sha256").update(archive).digest("hex") };
  };
  const taken = await production.createRelease("shop", upload(shop("setup.sh"), { "setup.sh": SCRIPT }));
  assert.match(taken.release.version, /^\d{8}-[0-9a-f]{7}$/u);
  const words = async (declaration, files) => {
    const error = await refused(production.createRelease("shop", upload(declaration, files)));
    assert.deepEqual(refusal(error), { status: 422, code: "validation_failed", fields: ["declaration.build.setup"] });
    return error.details.fieldErrors["declaration.build.setup"];
  };
  const badName = "The name of a file in the app's folder, such as setup.sh: letters, digits, dots, hyphens and underscores, at most 100.";
  for (const name of ["deploy/setup.sh", "../setup.sh", ".setup.sh", "mobilynet.json", "", 7, "a".repeat(101)]) {
    assert.equal(await words(shop(name), { "setup.sh": SCRIPT }), badName, String(name));
  }
  assert.equal(await words(shop("setup.sh"), {}), "The declaration's build.setup names setup.sh, which isn't a regular file in the app's folder.");
  assert.equal(await words(shop("setup.sh"), { "setup.sh": "" }), "setup.sh must hold 1 byte to 64 KiB; it holds 0.");
  assert.equal(await words(shop("setup.sh"), { "setup.sh": "#".repeat(64 * 1024 + 1) }), "setup.sh must hold 1 byte to 64 KiB; it holds 65537.");
  assert.equal(await words(shop("setup.sh"), { "setup.sh": Buffer.from([0xe9, 0x0a]) }), "setup.sh isn't UTF-8 text.");
  assert.equal(await words(shop("setup.sh"), { "setup.sh": "a\u0000b" }), "setup.sh holds a NUL character.");
  // The script is read only once the rest of the declaration holds, as mobilynet reads it.
  const wrongName = await refused(production.createRelease("shop", upload({ ...shop("setup.sh"), name: "other" }, {})));
  assert.deepEqual(refusal(wrongName), { status: 422, code: "validation_failed", fields: ["declaration.name"] });
});

/**
 * The Containerfile a service's image builds from, as an image adapter uploads it, and the lines of it that matter
 * here.
 * @param {{ serviceUpload: (archive: Buffer, declaration: object) => { bytes: Buffer } }} adapter
 */
function containerfileOfAdapter(adapter, { setup = true } = {}) {
  const stack = stackOf({ setup });
  const { declarations } = imagePackages({ app: "shop", deployment: stack.deployment, needs: stack.needs, settings: settingsPerService(stack.needs) });
  const archive = withRootFile(withRootFile(gzipSync(Buffer.alloc(1024)), "server.js", "// the app").bytes, MACHINE_SETUP_FILE, SCRIPT).bytes;
  const entries = entriesOf(adapter.serviceUpload(archive, declarations.workers).bytes);
  return { entries, lines: entries[CONTAINERFILE].toString("utf8").split("\n") };
}

/** Where each step of a Containerfile is: its packages, the script copied and run, the release copied, the user. */
function containerSteps(lines) {
  const at = (pattern) => lines.findIndex((line) => pattern.test(line));
  return {
    packages: at(/^RUN nix .* profile install /u),
    copy: lines.indexOf(`COPY ${MACHINE_SETUP_FILE} /${MACHINE_SETUP_FILE}`),
    run: at(new RegExp(`^RUN chmod 0700 /${MACHINE_SETUP_FILE} && bash -c `, "u")),
    release: at(/^COPY \. \/srv\/app$/u),
    user: at(/^USER /u)
  };
}

test("AWS builds each service's image with the machine setup script run as root, after its packages and before the release", () => {
  const { adapter } = awsWorld();
  const { entries, lines } = containerfileOfAdapter(adapter);
  assert.equal(entries[MACHINE_SETUP_FILE].toString("utf8"), SCRIPT, "the upload carries the script");
  const steps = containerSteps(lines);
  assert.ok(steps.packages >= 0 && steps.packages < steps.copy && steps.copy + 1 === steps.run && steps.run < steps.release && steps.release < steps.user,
    `${JSON.stringify(steps)}\n${lines.join("\n")}`);
  assert.ok(lines.slice(0, steps.run).every((line) => !line.startsWith("USER ")), "nothing before it changes the user: it runs as root");
  assert.ok(lines[steps.run].endsWith(` /${MACHINE_SETUP_FILE} && rm -f /${MACHINE_SETUP_FILE}`), lines[steps.run]);
  const plain = containerSteps(containerfileOfAdapter(adapter, { setup: false }).lines);
  assert.deepEqual([plain.copy, plain.run], [-1, -1], "without the line the image runs none");
});

test("Google Cloud builds each service's image with the machine setup script run as root, after its packages and before the release", () => {
  const { adapter } = googleWorld();
  const { entries, lines } = containerfileOfAdapter(adapter);
  assert.equal(entries[MACHINE_SETUP_FILE].toString("utf8"), SCRIPT, "the upload carries the script");
  const steps = containerSteps(lines);
  assert.ok(steps.packages >= 0 && steps.packages < steps.copy && steps.copy + 1 === steps.run && steps.run < steps.release && steps.release < steps.user,
    `${JSON.stringify(steps)}\n${lines.join("\n")}`);
  assert.ok(lines.slice(0, steps.run).every((line) => !line.startsWith("USER ")), "nothing before it changes the user: it runs as root");
  const plain = containerSteps(containerfileOfAdapter(adapter, { setup: false }).lines);
  assert.deepEqual([plain.copy, plain.run], [-1, -1], "without the line the image runs none");
});

test("an image's build runs the script as mobilynet does: bash -e unless its first line names its interpreter, failing the build when it fails", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-machine-setup-image-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { lines } = containerfileOfAdapter(awsWorld().adapter);
  const command = lines[containerSteps(lines).run].slice("RUN ".length);
  /** Runs the Containerfile's RUN line with the script at `file`, as an image's /bin/sh would. */
  const run = async (text) => {
    const file = path.join(root, MACHINE_SETUP_FILE);
    await writeFile(file, text);
    const marker = path.join(root, "after");
    await rm(marker, { force: true });
    const result = await exec("sh", ["-c", command.replaceAll(`/${MACHINE_SETUP_FILE}`, file)], { env: { PATH: process.env.PATH, MARKER: marker } })
      .then(() => 0, (error) => error.code);
    return { status: result, after: existsSync(marker) ? await readFile(marker, "utf8") : null, kept: existsSync(file) };
  };
  // Without #!, bash -e: a failing command ends the script and the build.
  assert.deepEqual(await run('false\necho ran > "$MARKER"\n'), { status: 1, after: null, kept: true });
  assert.deepEqual(await run('if [ -n "$BASH_VERSION" ]; then echo bash > "$MARKER"; fi\n'), { status: 0, after: "bash\n", kept: false });
  // With #!, its interpreter runs it.
  assert.deepEqual(await run('#!/bin/sh\necho "shebang" > "$MARKER"\nexit 3\n'), { status: 3, after: "shebang\n", kept: true });
});
